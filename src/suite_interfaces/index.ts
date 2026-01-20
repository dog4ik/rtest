import * as playwright from "playwright";
import * as vitest from "vitest";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import type { PrimeBusinessStatus } from "@/db/business";
import { CONFIG, test } from "@/test_context";
import type { PaymentRequest, PayoutRequest } from "@/common";
import { SettingsBuilder } from "@/settings_builder";
import type { Context } from "@/test_context/context";

export type TestCaseOptions = {
  skip_if?: boolean;
};

export interface TestCaseBase {
  type: "payin" | "payout";
  mock_options: (unique_secret: string) => MockProviderParams;
  request: () => PaymentRequest | PayoutRequest;
  settings: (unique_secret: string) => Record<string, any>;
}

export interface Callback extends TestCaseBase {
  send_callback: (
    status: PrimeBusinessStatus,
    unique_secret: string,
  ) => Promise<unknown>;
  create_handler: (status: PrimeBusinessStatus) => Handler;
}

export interface Status extends TestCaseBase {
  status_handler: (status: PrimeBusinessStatus) => Handler;
  create_handler: (status: PrimeBusinessStatus) => Handler;
}

export interface Routing extends TestCaseBase {
  create_handler: (status: PrimeBusinessStatus) => Handler;
  no_requisites_handler: () => Handler;
}

export interface DataFlow extends TestCaseBase {
  create_handler: (status: PrimeBusinessStatus) => Handler;
  after_create_check?: () => unknown;
  check_merchant_response?: (data: CreateTransactionReturn) => unknown;
}

export interface PayformDataFlow extends TestCaseBase {
  create_handler: (status: PrimeBusinessStatus) => Handler;
  after_create_check?: () => unknown;
  check_pf_page?: (page: playwright.Page) => unknown;
}

// FIX(8pay): Callback delay is high because routing lock mutex is held for 10 seconds.
// FIX(pcidss): Brusnika does not allow sending callback 5s after creation.
const CALLBACK_DELAY = CONFIG.project == "8pay" ? 11_000 : 7_000;
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
      vitest.assert.fail("unsupported operation type");
    }
  };
  return {
    merchant,
    provider,
    provider_alias: mock_options.alias,
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

function callbackFinalizationTest(
  target: Callback,
  target_status: PrimeBusinessStatus,
  opts?: TestCaseOptions,
) {
  let alias = target.mock_options("").alias;
  test
    .skipIf(opts?.skip_if)
    .concurrent(
      `${alias} callback finalization to ${target_status}`,
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let { create_transaction, merchant, provider } = await create_suite(
            ctx,
            target,
          );
          provider.queue((c) => {
            setTimeout(() => {
              target.send_callback(target_status, ctx.uuid);
            }, CALLBACK_DELAY);
            return target.create_handler("pending")(c);
          });

          let notification = merchant.queue_notification((callback) => {
            vitest.assert.strictEqual(
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

export function callbackFinalizationSuite(
  createTarget: () => Callback,
  opts?: TestCaseOptions,
) {
  for (let status of CASES) {
    callbackFinalizationTest(createTarget(), status, opts);
  }
}

function statusFinalizationTest(
  target: Status,
  target_status: PrimeBusinessStatus,
  opts?: TestCaseOptions,
) {
  let alias = target.mock_options("").alias;
  test
    .skipIf(opts?.skip_if)
    .concurrent(
      `${alias} status finalization to ${target_status}`,
      async ({ ctx }) => {
        await ctx.track_bg_rejections(async () => {
          let { provider, merchant, create_transaction } = await create_suite(
            ctx,
            target,
          );
          provider.queue(target.create_handler("pending"));
          provider.queue(target.status_handler(target_status));

          let notification = merchant.queue_notification((callback) => {
            vitest.assert.strictEqual(
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

export function statusFinalizationSuite(
  suite_factory: () => Status,
  opts?: TestCaseOptions,
) {
  for (let target_status of CASES) {
    statusFinalizationTest(suite_factory(), target_status, opts);
  }
}

export function routingFinalizationSuite(chain: Routing[], last: Callback) {
  vitest.describe.concurrent("routing", () => {
    test.concurrent("routing chain", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        vitest.assert.isNotEmpty(
          chain,
          "Routing chain should have more than 1 gateway",
        );
        let uuid = crypto.randomUUID();
        let merchant = await ctx.create_random_merchant();
        let settings = new SettingsBuilder();
        let flexy_rule = ctx.routing_builder(merchant.id, "gateway");
        for (let link of chain) {
          let gw = ctx.mock_server(link.mock_options(uuid));
          gw.queue(link.no_requisites_handler());
          settings.withGateway(link.settings(uuid));
        }
        await merchant.set_settings(settings.build());
        let last_gw = ctx.mock_server(last.mock_options(uuid));
        last_gw.queue(async (c) => {
          setTimeout(
            () => last.send_callback("approved", uuid),
            CALLBACK_DELAY,
          );
          return await last.create_handler("pending")(c);
        });

        let notification = merchant.queue_notification((callback) => {
          vitest.assert.strictEqual(
            callback.status,
            "approved",
            `merchant should get approved notification`,
          );
        });
        let create_response = await merchant.create_payment(chain[0].request());
        let processingUrlResponse =
          await create_response.followFirstProcessingUrl();
        if (CONFIG.project === "8pay") {
          await processingUrlResponse.as_8pay_requisite();
        }
        await notification;
      });
    });
  });
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
        let { create_transaction, provider } = await create_suite(ctx, target);
        let provider_request = provider
          .queue(target.create_handler("pending"))
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
    .concurrent(`${alias} ${title} payform data flow`, ({ ctx, browser }) =>
      ctx.track_bg_rejections(async () => {
        let { init_transaction, provider } = await create_suite(ctx, target);
        let provider_request = provider
          .queue(target.create_handler("pending"))
          .then(() => target.after_create_check?.());
        let response = await init_transaction();
        let page = await browser.newPage();
        await page.setViewportSize({ width: 720, height: 900 });
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
