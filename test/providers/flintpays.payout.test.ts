import * as vitest from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { test } from "@/test_context";
import { providers } from "@/settings_builder";
import { FlintpayOperation } from "@/provider_mocks/flintpays";
import type { Context } from "@/test_context/context";
import type { FlintpayStatus } from "@/provider_mocks/flintpays";
import { delay } from "@std/async";
import { CALLBACK_DELAY } from "@/suite_interfaces";

const CURRENCY = "TJS";

async function setupMerchant(ctx: Context) {
  let uuid = crypto.randomUUID();
  let merchant = await ctx.create_random_merchant();
  let settings = providers(CURRENCY, FlintpayOperation.settings(uuid));
  settings.gateways["skip_card_payout_validation"] = true;
  await merchant.set_settings(settings);
  await merchant.cashin(CURRENCY, 1234.56);
  let flintpays = ctx.mock_server(FlintpayOperation.mock_params(uuid));
  let payout = new FlintpayOperation("withdrawal");
  return { merchant, flintpays, payout, uuid };
}

function payoutRequest() {
  return {
    ...common.payoutRequest(CURRENCY),
    card: {
      pan: common.visaCard,
    },
  };
}

vitest.describe
  .runIf(CONFIG.in_project(["8pay", "reactivepay"]))
  .concurrent("flintpays payout gateway", () => {
    const CASES = [
      ["rejected" as FlintpayStatus, "declined"],
      ["confirmed" as FlintpayStatus, "approved"],
    ] as const;

    for (let [flintpay_status, rp_status] of CASES) {
      test.concurrent(
        `callback finalization to ${rp_status}`,
        { timeout: 30_000 },
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, flintpays, payout } = await setupMerchant(ctx);
            flintpays
              .queue(payout.create_response_handler("created"))
              .then(async () => {
                await delay(CALLBACK_DELAY);
                await payout.send_callback(flintpay_status);
              });

            flintpays.queue(async (c) => {
              return c.json(payout.status_response("created"));
            });
            let res = await merchant.create_payout(payoutRequest());
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
            let { merchant, flintpays, payout } = await setupMerchant(ctx);
            flintpays.queue(async (c) => {
              return c.json(
                payout.create_response("created", await c.req.json()),
              );
            });

            flintpays.queue((c) =>
              c.json(payout.status_response(flintpay_status)),
            );

            let res = await merchant.create_payout(payoutRequest());
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

    test.concurrent("payout declined if no balance", async ({ ctx }) => {
      let { merchant, flintpays } = await setupMerchant(ctx);

      flintpays.queue(FlintpayOperation.no_balance_response_handler());
      let res = await merchant.create_payout(payoutRequest());
      console.log(res);
      let processingUrlRespnose = await res
        .followFirstProcessingUrl()
        .then((r) => r.as_raw_json());
      console.log(processingUrlRespnose);
      let businessPayment = await ctx.get_payment(res.token);
      vitest.assert.strictEqual(
        businessPayment.status,
        "declined",
        "payout should be insta declined",
      );
      merchant.queue_notification((notifciation) => {
        vitest.assert.strictEqual(
          notifciation.status,
          "declined",
          "merchant should get declined callback",
        );
      });
    });

    test.concurrent("payout pending if 500 response", async ({ ctx }) => {
      let { merchant, flintpays } = await setupMerchant(ctx);

      flintpays.queue(common.nginx500);
      let res = await merchant.create_payout(payoutRequest());
      console.log(res);
      let processingUrlResponse = await res.followFirstProcessingUrl();
      let json = await processingUrlResponse.as_raw_json();
      console.log("processing url response: ", json);
      let businessPayment = await ctx.get_payment(res.token);
      vitest.assert.strictEqual(
        businessPayment.status,
        "pending",
        "payout should stay in pending",
      );
    });

    test.concurrent(
      "payout pending if timed out",
      { timeout: 80_000 },
      async ({ ctx }) => {
        let { merchant, flintpays, payout } = await setupMerchant(ctx);

        flintpays.queue(async (c) => {
          console.log("waiting for rp to timeout request");
          await delay(60_000);
          return c.json(payout.create_response("created", await c.req.json()));
        });
        let res = await merchant.create_payout(payoutRequest());
        console.log(res);
        await res.followFirstProcessingUrl();
        let businessPayment = await ctx.get_payment(res.token);
        vitest.assert.strictEqual(
          businessPayment.status,
          "pending",
          "payout should stay in pending",
        );
      },
    );
  });
