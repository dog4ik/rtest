import * as playwright from "playwright";
import { assert, describe } from "vitest";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import type { PrimeBusinessStatus } from "@/db/business";
import { CONFIG } from "@/config";
import { test } from "@/test_context";
import type { PaymentRequest, PayoutRequest } from "@/common";
import {
  defaultSettings,
  providers,
  SettingsBuilder,
} from "@/settings_builder";
import type { Context } from "@/test_context/context";
import type { ProviderInstance } from "@/mock_server/instance";
import { delay } from "@std/async";
import type { ProcessingUrlResponse } from "@/entities/payment/processing_url_response";

export type TestCaseOptions = {
  skip_if?: boolean;
  tag?: string;
};

export type TestCaseContext = {
  provider: ProviderInstance;
  ctx: Context;
};

export interface TestCaseBase<G = unknown> {
  gw: G;
  type: "payin" | "payout";
  mock_options: (unique_secret: string) => MockProviderParams;
  request: () => PaymentRequest | PayoutRequest;
  settings: (unique_secret: string) => Record<string, any>;
  create_handler: (
    status: PrimeBusinessStatus,
    ctx: TestCaseContext,
  ) => Handler;
}

export interface Callback<G = unknown> extends TestCaseBase<G> {
  send_callback: (
    status: PrimeBusinessStatus,
    unique_secret: string,
  ) => Promise<unknown>;
}

export interface Status<G = unknown> extends TestCaseBase<G> {
  status_handler: (status: PrimeBusinessStatus) => Handler;
}

export type P2PSuite<G = unknown> = Callback<G> & Status<G> & Routable;

export interface DataFlow extends TestCaseBase {
  after_create_check?: () => unknown;
  check_merchant_response?: (data: CreateTransactionReturn) => unknown;
}

export interface PayformDataFlow extends TestCaseBase {
  browser_context?: (
    browser: playwright.Browser,
  ) => Promise<playwright.BrowserContext>;
  after_create_check?: () => unknown;
  check_pf_page?: (page: playwright.Page) => unknown;
}

export interface Routable extends TestCaseBase {
  no_requisites_handler: (
    instance: ProviderInstance,
    secret: string,
  ) => Handler;
}

// FIX(8pay): Callback delay is high because routing lock mutex is held for 10 seconds.
// FIX(pcidss): Brusnika does not allow sending callback 5s after creation.
export const CALLBACK_DELAY = CONFIG.project == "8pay" ? 11_000 : 500;
// const CALLBACK_DELAY = 1_500;

const CASES: PrimeBusinessStatus[] = ["approved", "declined"];

type CreateTransactionReturn = Awaited<
  ReturnType<Awaited<ReturnType<typeof create_suite>>["create_transaction"]>
>;

async function create_suite(ctx: Context, target: TestCaseBase) {
  let merchant = await ctx.create_random_merchant();
  let settings = target.settings(ctx.uuid);
  await merchant.set_settings(settings);
  let mock_options = target.mock_options(ctx.uuid);
  let provider = ctx.mock_server(mock_options);
  let init_transaction = async () => {
    if (target.type === "payin") {
      return await merchant.create_payment(target.request());
    } else if (target.type === "payout") {
      let request = target.request();
      await merchant.cashin(request.currency, request.amount / 100);
      return await merchant.create_payout(request);
    } else {
      assert.fail("unsupported operation type");
    }
  };
  return {
    merchant,
    provider,
    provider_alias: mock_options.alias,
    suite_ctx: { ctx, provider } as TestCaseContext,
    init_transaction,
    async create_transaction() {
      let create_response = await init_transaction();
      if (Array.isArray(create_response.processingUrl)) {
        return {
          create_response,
          processing_response: await create_response.followFirstProcessingUrl(),
        };
      }
      return { create_response };
    },
  };
}

function callbackFinalizationTest<T>(
  target: Callback<T>,
  target_status: PrimeBusinessStatus,
  opts?: TestCaseOptions,
) {
  let alias = target.mock_options("").alias;
  test
    .skipIf(opts?.skip_if)
    .concurrent(
      `${alias} callback finalization to ${target_status}${opts?.tag ? ` (${opts.tag})` : ""}`,
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let { create_transaction, merchant, provider, suite_ctx } =
            await create_suite(ctx, target);
          provider
            .queue(target.create_handler("pending", suite_ctx))
            .then(async () => {
              await delay(CALLBACK_DELAY);
              await target.send_callback(target_status, ctx.uuid);
            });

          let notification = merchant.queue_notification((callback) => {
            assert.strictEqual(
              callback.status,
              target_status,
              `merchant should get ${target_status} notification`,
            );
          });
          await create_transaction();
          await notification;
        }),
    );
}

export function callbackFinalizationSuite<T>(
  createTarget: () => Callback<T>,
  opts?: TestCaseOptions,
) {
  for (let status of CASES) {
    callbackFinalizationTest(createTarget(), status, opts);
  }
}

function statusFinalizationTest<T>(
  target: Status<T>,
  target_status: PrimeBusinessStatus,
  opts?: TestCaseOptions,
) {
  let alias = target.mock_options("").alias;
  test
    .skipIf(opts?.skip_if)
    .concurrent(
      `${alias} status finalization to ${target_status}${opts?.tag ? ` (${opts.tag})` : ""}`,
      async ({ ctx }) => {
        await ctx.track_bg_rejections(async () => {
          let { provider, merchant, create_transaction, suite_ctx } =
            await create_suite(ctx, target);
          provider.queue(target.create_handler("pending", suite_ctx));
          provider.queue(target.status_handler(target_status));

          let notification = merchant.queue_notification((callback) => {
            assert.strictEqual(
              callback.status,
              target_status,
              `merchant should get ${target_status} notification`,
            );
          });
          await create_transaction();
          await notification;
        });
      },
    );
}

export function statusFinalizationSuite<T>(
  suite_factory: () => Status<T>,
  opts?: TestCaseOptions,
) {
  for (let target_status of CASES) {
    statusFinalizationTest(suite_factory(), target_status, opts);
  }
}

export function dataFlowTest<T extends DataFlow>(
  title: string,
  target: T,
  opts?: TestCaseOptions,
) {
  let alias = target.mock_options("").alias;
  test
    .skipIf(opts?.skip_if)
    .concurrent(`${alias} ${title} data flow`, ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { create_transaction, provider, suite_ctx } = await create_suite(
          ctx,
          target,
        );
        let provider_request = provider
          .queue(target.create_handler("pending", suite_ctx))
          .then(() => target.after_create_check?.());
        let response = await create_transaction();
        await provider_request;
        await target.check_merchant_response?.(response);
      }),
    );
}

export function payformDataFlowTest<T extends PayformDataFlow>(
  title: string,
  target: T,
  opts?: TestCaseOptions,
) {
  let alias = target.mock_options("").alias;
  test
    .skipIf(opts?.skip_if)
    .concurrent(`${alias} ${title} payform data flow`, ({ ctx, chrome }) =>
      ctx.track_bg_rejections(async () => {
        let { init_transaction, provider, suite_ctx } = await create_suite(
          ctx,
          target,
        );
        let provider_request = provider
          .queue(target.create_handler("pending", suite_ctx))
          .then(() => target.after_create_check?.());

        let response = await init_transaction();

        let browser_context: playwright.BrowserContext;
        if (target.browser_context) {
          browser_context = await target.browser_context(chrome);
        } else {
          browser_context = await chrome.newContext();
        }
        let page = await browser_context.newPage();
        await page.setViewportSize({ width: 720, height: 1024 });

        await page.goto(response.firstProcessingUrl());
        await ctx.annotate("Payform screenshot", {
          contentType: "image/png",
          body: await page.screenshot(),
        });
        await target.check_pf_page?.(page);
        await provider_request;
      }),
    );
}

type ConcurrentTestStatuses = {
  callback: PrimeBusinessStatus;
  status: PrimeBusinessStatus;
  expected: PrimeBusinessStatus;
};

export function concurrentCallbackTest<T>(
  target: Callback<T> & Status<T>,
  { callback, status, expected }: ConcurrentTestStatuses,
  opts?: TestCaseOptions,
) {
  let alias = target.mock_options("").alias;
  test
    .skipIf(opts?.skip_if)
    .concurrent(
      `${alias} concurrent callback(${callback}) & status(${status})`,
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let { create_transaction, provider, suite_ctx, merchant } =
            await create_suite(ctx, target);

          provider.queue(target.create_handler("pending", suite_ctx));
          let merchant_notification = merchant.queue_notification((n) => {
            assert.strictEqual(n.status, expected);
          });
          let provider_actions = provider
            .queue(target.status_handler(status))
            .then(() => target.send_callback(callback, ctx.uuid));
          let response = await create_transaction();
          await provider_actions;
          if (expected === "pending") {
            await delay(4_000);
          } else {
            await merchant_notification;
            await delay(2_000);
          }
          let payment = await ctx.get_payment(response.create_response.token);
          assert.strictEqual(payment.status, expected);
          await ctx.healthcheck(response.create_response.token);
        }),
    );
}

export function concurrentCallbackSuite<T>(
  target: () => Callback<T> & Status<T>,
) {
  concurrentCallbackTest(target(), {
    expected: "approved",
    callback: "approved",
    status: "approved",
  });

  concurrentCallbackTest(target(), {
    expected: "declined",
    callback: "declined",
    status: "declined",
  });

  concurrentCallbackTest(target(), {
    expected: "declined",
    callback: "approved",
    status: "declined",
  });

  concurrentCallbackTest(target(), {
    expected: "approved",
    callback: "declined",
    status: "approved",
  });

  concurrentCallbackTest(target(), {
    expected: "declined",
    callback: "declined",
    status: "pending",
  });

  concurrentCallbackTest(target(), {
    expected: "declined",
    callback: "pending",
    status: "declined",
  });

  concurrentCallbackTest(target(), {
    expected: "approved",
    callback: "approved",
    status: "pending",
  });

  concurrentCallbackTest(target(), {
    expected: "approved",
    callback: "pending",
    status: "approved",
  });

  concurrentCallbackTest(target(), {
    expected: "pending",
    callback: "pending",
    status: "pending",
  });
}

function gateway_key(index: number) {
  return `link_${index}`;
}

async function setupRoutingChain(
  ctx: Context,
  currency: string,
  gateways: Routable[],
) {
  assert(
    gateways.length > 1,
    "routing chain should contain more than 1 gateway",
  );

  let merchant = await ctx.create_random_merchant();

  let first_link = gateways[0];
  let last_link = gateways[gateways.length - 1];

  let settings_builder = new SettingsBuilder();
  settings_builder.addP2P(currency, gateway_key(0), gateway_key(0));
  settings_builder.withGateway(first_link.settings(ctx.uuid), gateway_key(0));
  let rule_builder = ctx.routing_builder(merchant.id, gateway_key(0));

  let queue_no_requisites = (routable: Routable) => {
    let mock_server = ctx.mock_server(routable.mock_options(ctx.uuid));
    return mock_server.queue(
      routable.no_requisites_handler(mock_server, ctx.uuid),
    );
  };

  let chain: Promise<unknown>[] = [queue_no_requisites(first_link)];
  rule_builder.addStatusRoute(gateway_key(1));

  for (let i = 1; i < gateways.length - 1; ++i) {
    let routable = gateways[i];
    settings_builder.withGateway(routable.settings(ctx.uuid), gateway_key(i));
    queue_no_requisites(routable);
    rule_builder.addStatusRoute(gateway_key(i + 1));
  }
  settings_builder.withGateway(
    last_link.settings(ctx.uuid),
    gateway_key(gateways.length - 1),
  );

  let last_mock_server = ctx.mock_server(last_link.mock_options(ctx.uuid));
  chain.push(
    last_mock_server.queue(
      last_link.create_handler("pending", {
        ctx,
        provider: last_mock_server,
      }),
    ),
  );

  await merchant.set_settings(settings_builder.build());
  await rule_builder.save();

  return { merchant, chain };
}

export function routingFinalizationSuite(
  links: [...Routable[], Routable & Callback],
  request: PaymentRequest,
  check_merchant_response?: (
    response: ProcessingUrlResponse,
  ) => Promise<unknown>,
  is_masked = false,
) {
  let currency = request.currency;
  let chain_descriptor = links
    .map((l) => l.mock_options("").alias)
    .join(" -> ");

  test.concurrent(
    `Routing: ${chain_descriptor}${is_masked ? "(masked)" : ""}`,
    { timeout: 45_000 },
    ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { merchant, chain } = await setupRoutingChain(ctx, currency, links);
        console.log({ merchant, chain_descriptor, type: "before" });
        let approved_notification = merchant.queue_notification((n) => {
          assert.strictEqual(n.status, "approved");
        });
        let last_link = links[links.length - 1] as Routable & Callback;
        console.log({ merchant, chain_descriptor, type: "after", request });
        let res = await merchant
          .create_payment(request)
          .then((p) => p.followFirstProcessingUrl());
        if (check_merchant_response) {
          await check_merchant_response(res);
        }
        await Promise.all(chain);
        await delay(11_000);
        await last_link.send_callback("approved", ctx.uuid);
        await approved_notification;
      }),
  );
}

/**
 * Factory for creating suite that uses full default settings
 * FIX: This is stupid, find a better way to decide what settings type should be used with the suite
 */
export function defaultSuite<
  T extends { settings: (secret: string) => Record<string, any> },
>(currency: string, suite: T): T {
  return {
    ...suite,
    settings: (secret: string) =>
      defaultSettings(currency, suite.settings(secret)),
  };
}

/**
 * Factory for creating suite that uses full providers settings
 */
export function providersSuite<
  T extends { settings: (secret: string) => Record<string, any> },
>(currency: string, suite: T): T {
  return {
    ...suite,
    settings: (secret: string) => providers(currency, suite.settings(secret)),
  };
}

/**
 * Factory for creating suite that has masked_provider setting
 */
export function maskedSuite<
  T extends { settings: (secret: string) => Record<string, any> },
>(suite: T): T {
  return {
    ...suite,
    settings: (secret: string) => ({
      ...suite.settings(secret),
      masked_provider: true,
    }),
  };
}
