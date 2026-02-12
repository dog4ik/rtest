import * as vitest from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { test } from "@/test_context";
import { defaultSettings } from "@/settings_builder";
import {
  DalapayTransaction,
  OperationStatusMap,
} from "@/provider_mocks/dalapay";
import type { Context } from "@/test_context/context";

const CURRENCY = "CDF";
const CALLBACK_DELAY = CONFIG.project == "8pay" ? 11_000 : 4_000;

async function setupMerchant(ctx: Context) {
  let uuid = crypto.randomUUID();
  let merchant = await ctx.create_random_merchant();
  let settings = defaultSettings(CURRENCY, DalapayTransaction.settings(uuid));
  settings.gateways["allow_h2h_payin_without_card"] = true;
  await merchant.set_settings(settings);
  let dalapay = ctx.mock_server(DalapayTransaction.mock_params(uuid));
  let payment = new DalapayTransaction();
  return { merchant, dalapay, payment, uuid };
}

const CASES = [
  [OperationStatusMap.SUCCESS, "approved"],
  [OperationStatusMap.FAILED, "declined"],
] as const;

for (let [dalapay_status, rp_status] of CASES) {
  test
    .runIf(CONFIG.in_project(["reactivepay", "8pay"]))
    .concurrent(
      `callback finalization to ${rp_status}`,
      { timeout: 30_000 },
      async ({ ctx }) => {
        await ctx.track_bg_rejections(async () => {
          let { merchant, dalapay, payment } = await setupMerchant(ctx);
          dalapay.queue(async (c) => {
            setTimeout(() => {
              payment.send_callback(dalapay_status);
            }, CALLBACK_DELAY);
            return c.json(
              payment.create_response(
                OperationStatusMap.IN_PROGRESS,
                await c.req.json(),
              ),
            );
          });
          dalapay.queue(payment.status_handler(OperationStatusMap.IN_PROGRESS));
          let result = await merchant.create_payment({
            ...common.paymentRequest(CURRENCY),
            customer: {
              email: "test@email.com",
              country: "EU",
              first_name: "test",
              last_name: "testov",
              phone: common.phoneNumber,
            },
          });
          vitest.assert.strictEqual(
            result.payment.status,
            "pending",
            "merchant response payment status",
          );
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

  test
    .runIf(CONFIG.in_project(["reactivepay", "8pay"]))
    .concurrent(`status finalization to ${rp_status}`, async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let { merchant, dalapay, payment } = await setupMerchant(ctx);
        dalapay.queue(payment.create_handler(OperationStatusMap.IN_PROGRESS));

        dalapay.queue(payment.status_handler(dalapay_status));

        let result = await merchant.create_payment({
          ...common.paymentRequest(CURRENCY),
          customer: {
            email: "test@email.com",
            country: "EU",
            first_name: "test",
            last_name: "testov",
            phone: common.phoneNumber,
          },
        });
        vitest.assert.strictEqual(
          result.payment.status,
          "pending",
          "merchant response payment status",
        );
        await merchant.queue_notification(async (notification) => {
          vitest.assert.strictEqual(
            notification.status,
            rp_status,
            "merchant notification status",
          );
        });
      });
    });
}
