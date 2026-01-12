import * as vitest from "vitest";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import type { PrimeBusinessStatus } from "@/db/business";
import { CONFIG, test } from "@/test_context";
import type { PaymentRequest, PayoutRequest } from "@/common";
import { SettingsBuilder } from "@/settings_builder";
import { RoutingBuilder } from "@/flexy_guard_builder";

export interface ProviderBase {
  mock_options: (unique_secret: string) => MockProviderParams;
  suite_merchant_request: () => PaymentRequest | PayoutRequest;
  suite_merchant_settings: (unique_secret: string) => {};
}

export interface Callback extends ProviderBase {
  suite_send_callback: (
    status: PrimeBusinessStatus,
    unique_secret: string,
  ) => Promise<unknown>;
  suite_create_handler: (status: PrimeBusinessStatus) => Handler;
}

export interface Status extends ProviderBase {
  suite_status_handler: (status: PrimeBusinessStatus) => Handler;
  suite_create_handler: (status: PrimeBusinessStatus) => Handler;
}

export interface Routing extends ProviderBase {
  suite_create_handler: (status: PrimeBusinessStatus) => Handler;
  suite_no_requisites_handler: () => Handler;
}

// FIX(8pay): Callback delay is high because routing lock mutex is held for 10 seconds.
// FIX(pcidss): Brusnika does not allow sending callback 5s after creation.
const CALLBACK_DELAY = CONFIG.project == "8pay" ? 11_000 : 7_000;
// const CALLBACK_DELAY = 1_500;

const CASES: PrimeBusinessStatus[] = ["approved", "declined"];

export function callbackFinalizationSuite(suiteFactory: () => Callback) {
  vitest.describe.concurrent("callback finalization", () => {
    for (let target_status of CASES) {
      let target = suiteFactory();
      test.concurrent(`finalization to ${target_status}`, async ({ ctx }) => {
        await ctx.track_bg_rejections(async () => {
          let merchant = await ctx.create_random_merchant();
          await merchant.set_settings(target.suite_merchant_settings(ctx.uuid));
          let provider = ctx.mock_server(target.mock_options(ctx.uuid));
          provider.queue((c) => {
            setTimeout(() => {
              target.suite_send_callback(target_status, ctx.uuid);
            }, CALLBACK_DELAY);
            return target.suite_create_handler("pending")(c);
          });

          let notification = merchant.notification_handler((callback) => {
            vitest.assert.strictEqual(
              callback.status,
              target_status,
              `merchant should get ${target_status} notification`,
            );
          });
          let create_response = await merchant.create_payment(
            target.suite_merchant_request(),
          );
          let processingUrlResponse =
            await create_response.followFirstProcessingUrl();
          if (CONFIG.project === "8pay") {
            await processingUrlResponse.as_8pay_requisite();
          }
          await notification;
        });
      });
    }
  });
}

export function statusFinalizationSuite(suite_factory: () => Status) {
  vitest.describe.concurrent("status finalization", () => {
    for (let target_status of CASES) {
      let target = suite_factory();
      test.concurrent(`finalization to ${target_status}`, async ({ ctx }) => {
        await ctx.track_bg_rejections(async () => {
          let merchant = await ctx.create_random_merchant();
          await merchant.set_settings(target.suite_merchant_settings(ctx.uuid));
          let provider = ctx.mock_server(target.mock_options(ctx.uuid));
          provider.queue(target.suite_create_handler("pending"));
          provider.queue(target.suite_status_handler(target_status));

          let notification = merchant.notification_handler((callback) => {
            vitest.assert.strictEqual(
              callback.status,
              target_status,
              `merchant should get ${target_status} notification`,
            );
          });
          let create_response = await merchant.create_payment(
            target.suite_merchant_request(),
          );
          console.log(create_response);
          let processingUrlResponse =
            await create_response.followFirstProcessingUrl();
          if (CONFIG.project === "8pay") {
            await processingUrlResponse.as_8pay_requisite();
          }
          await notification;
        });
      });
    }
  });
}

export function routingFinalizationSuite(chain: Routing[], last: Callback) {
  vitest.describe.concurrent("routing", () => {
    test.concurrent("routing chain", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        vitest.assert(
          chain.length > 0,
          "Routing chain should have more than 1 gateway",
        );
        let uuid = crypto.randomUUID();
        let merchant = await ctx.create_random_merchant();
        let settings = new SettingsBuilder();
        let flexy_rule = ctx.routing_builder(merchant.id, "gateway");
        for (let link of chain) {
          let gw = ctx.mock_server(link.mock_options(uuid));
          gw.queue(link.suite_no_requisites_handler());
          settings.withGateway(link.suite_merchant_settings(uuid));
        }
        await merchant.set_settings(settings.build());
        let last_gw = ctx.mock_server(last.mock_options(uuid));
        last_gw.queue(async (c) => {
          setTimeout(
            () => last.suite_send_callback("approved", uuid),
            CALLBACK_DELAY,
          );
          return await last.suite_create_handler("pending")(c);
        });

        let notification = merchant.notification_handler((callback) => {
          vitest.assert.strictEqual(
            callback.status,
            "approved",
            `merchant should get approved notification`,
          );
        });
        let create_response = await merchant.create_payment(
          chain[0].suite_merchant_request(),
        );
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
