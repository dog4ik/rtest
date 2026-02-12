import * as vitest from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { test } from "@/test_context";
import { providers } from "@/settings_builder";
import { FlintpayOperation } from "@/provider_mocks/flintpays";
import type { Context } from "@/test_context/context";
import type { FlintpayStatus } from "@/provider_mocks/flintpays";

const CURRENCY = "TJS";
const CALLBACK_DELAY = CONFIG.project == "8pay" ? 11_000 : 4_000;

async function setupMerchant(ctx: Context) {
  let uuid = crypto.randomUUID();
  let merchant = await ctx.create_random_merchant();
  let settings = providers(CURRENCY, FlintpayOperation.settings(uuid));
  await merchant.set_settings(settings);
  let flintpays = ctx.mock_server(FlintpayOperation.mock_params(uuid));
  let payment = new FlintpayOperation("deposit");
  return { merchant, flintpays, payment, uuid };
}

function paymentRequest() {
  return {
    ...common.paymentRequest(CURRENCY),
    bank_account: {
      requisite_type: "card",
    },
  };
}
vitest.describe
  .skipIf(CONFIG.project === "8pay")
  .concurrent("flintpays payin gateway", () => {
    const CASES = [
      ["confirmed" as FlintpayStatus, "approved"],
      ["rejected" as FlintpayStatus, "declined"],
    ] as const;

    for (let [flintpay_status, rp_status] of CASES) {
      test.concurrent(
        `callback finalization to ${rp_status}`,
        { timeout: 30_000 },
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, flintpays, payment } = await setupMerchant(ctx);
            flintpays.queue(async (c) => {
              setTimeout(() => {
                payment.send_callback(flintpay_status);
              }, CALLBACK_DELAY);
              return c.json(
                payment.create_response("created", await c.req.json()),
              );
            });

            flintpays.queue(async (c) => {
              return c.json(payment.status_response("created"));
            });
            let res = await merchant.create_payment(paymentRequest());
            await res.followFirstProcessingUrl();
            await merchant.queue_notification(async (notification) => {
              vitest.assert.strictEqual(
                notification.status,
                rp_status,
                "merchant notification status",
              );
            });
          });
        },
      );

      test.concurrent(
        `status finalization to ${rp_status}`,
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, flintpays, payment } = await setupMerchant(ctx);
            flintpays.queue(async (c) => {
              return c.json(
                payment.create_response("created", await c.req.json()),
              );
            });

            flintpays.queue((c) =>
              c.json(payment.status_response(flintpay_status)),
            );

            let res = await merchant.create_payment(paymentRequest());
            await res.followFirstProcessingUrl();
            await merchant.queue_notification(async (notification) => {
              vitest.assert.strictEqual(
                notification.status,
                rp_status,
                "merchant notification status",
              );
            });
          });
        },
      );
    }
  });
