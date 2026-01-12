import * as vitest from "vitest";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import type { PrimeBusinessStatus } from "@/db/business";
import { CONFIG, test } from "@/test_context";
import type { PaymentRequest, PayoutRequest } from "@/common";

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

// FIX(8pay): Callback delay is high because routing lock mutex is held for 10 seconds.
// FIX(pcidss): Brusnika does not allow sending callback 5s after creation.
const CALLBACK_DELAY = CONFIG.project == "8pay" ? 11_000 : 7_000;

const CASES: PrimeBusinessStatus[] = ["approved", "declined"];

export function callbackFinalizationSuite<T extends Callback>(
  suiteFactory: () => T,
) {
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
          let response = await merchant.create_payment(
            target.suite_merchant_request(),
          );
          await response.followFirstProcessingUrl();
          await notification;
        });
      });
    }
  });
}

export function statusFinalizationSuite<T extends Status>(
  suite_factory: () => T,
) {
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
          let response = await merchant.create_payment(
            target.suite_merchant_request(),
          );
          await response.followFirstProcessingUrl();
          await notification;
        });
      });
    }
  });
}
