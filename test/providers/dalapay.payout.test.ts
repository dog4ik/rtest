import * as vitest from "vitest";
import * as common from "@/common";
import { CONFIG, test } from "@/test_context";
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
  settings.gateways["skip_card_payout_validation"] = true;
  await merchant.set_settings(settings);
  await merchant.cashin(CURRENCY, common.amount / 100);
  let dalapay = ctx.mock_server(DalapayTransaction.mock_params(uuid));
  let payout = new DalapayTransaction();
  return { merchant, dalapay, payout, uuid };
}

const CASES = [
  [OperationStatusMap.FAILED, "declined"],
  [OperationStatusMap.SUCCESS, "approved"],
] as const;

for (let [dalapay_status, rp_status] of CASES) {
  test.concurrent(
    `callback finalization to ${rp_status}`,
    { timeout: 30_000 },
    async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let { merchant, dalapay, payout } = await setupMerchant(ctx);
        dalapay.queue(async (c) => {
          setTimeout(
            () => payout.send_callback(dalapay_status),
            CALLBACK_DELAY,
          );

          return c.json(
            payout.create_response(
              OperationStatusMap.IN_PROGRESS,
              await c.req.json(),
            ),
          );
        });

        dalapay.queue(payout.status_handler(OperationStatusMap.IN_PROGRESS));
        await merchant.create_payout({
          ...common.payoutRequest(CURRENCY),
          customer: {
            email: "test@email.com",
            ip: "8.8.8.8",
            country: "EU",
            first_name: "test",
            last_name: "testov",
            phone: common.phoneNumber,
          },
        });
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

  test.concurrent(`status finalization to ${rp_status}`, async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      let { merchant, dalapay, payout } = await setupMerchant(ctx);
      dalapay.queue(payout.create_handler(OperationStatusMap.IN_PROGRESS));

      dalapay.queue((c) => c.json(payout.status_response(dalapay_status)));

      await merchant.create_payout({
        ...common.payoutRequest(CURRENCY),
        customer: {
          email: "test@email.com",
          ip: "8.8.8.8",
          country: "EU",
          first_name: "test",
          last_name: "testov",
          phone: common.phoneNumber,
        },
      });
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
