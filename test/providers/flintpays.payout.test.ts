import * as vitest from "vitest";
import * as common from "@/common";
import { CONFIG, test } from "@/test_context";
import { providers } from "@/settings_builder";
import { FlintpayOperation } from "@/provider_mocks/flintpays";
import type { Context } from "@/test_context/context";
import type { FlintpayStatus } from "@/provider_mocks/flintpays";
import { delay } from "@std/async";

const CURRENCY = "TJS";
const CALLBACK_DELAY = CONFIG.project == "8pay" ? 11_000 : 4_000;

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

// FIX(pcidss): frequent requests with the same card triggers 500 error.
function randomCard() {
  return (Math.random() * Math.pow(10, 16)).toString().padStart(16, "1");
}

function payoutRequest() {
  return {
    ...common.payoutRequest(CURRENCY),
    card: {
      pan: randomCard(),
    },
  };
}

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
        flintpays.queue(async (c) => {
          setTimeout(() => {
            payout.send_callback(flintpay_status);
          }, CALLBACK_DELAY);
          return c.json(payout.create_response("created", await c.req.json()));
        });

        flintpays.queue(async (c) => {
          return c.json(payout.status_response("created"));
        });
        let res = await merchant.create_payout(payoutRequest());
        await res.followFirstProcessingUrl();
        await merchant.notification_handler(async (notification) => {
          vitest.assert(
            notification.status === rp_status,
            "merchant notification status",
          );
        });
      });
    },
  );

  test.concurrent(`status finalization to ${rp_status}`, async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      let { merchant, flintpays, payout } = await setupMerchant(ctx);
      flintpays.queue(async (c) => {
        return c.json(payout.create_response("created", await c.req.json()));
      });

      flintpays.queue((c) => c.json(payout.status_response(flintpay_status)));

        let res = await merchant.create_payout(payoutRequest());
      await res.followFirstProcessingUrl();
      await merchant.notification_handler(async (notification) => {
        vitest.assert(
          notification.status === rp_status,
          "merchant notification status",
        );
      });
    });
  });
}

test.concurrent("payout declined if no balance", async ({ ctx }) => {
  let { merchant, flintpays } = await setupMerchant(ctx);

  flintpays.queue(FlintpayOperation.no_balance_response_handler());
  let res = await merchant.create_payout(payoutRequest());
  console.log(res);
  let processingUrlRespnose = await res
    .followFirstProcessingUrl()
    .then((r) => r.json());
  console.log(processingUrlRespnose);
  let businessPayment = await ctx.get_payment(res.token);
  vitest.assert(
    businessPayment.status === "declined",
    "payout should be insta declined",
  );
  merchant.notification_handler((notifciation) => {
    vitest.assert(
      notifciation.status === "declined",
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
  vitest.assert(
    processingUrlResponse.status !== 500,
    "merchant should see a proper error",
  );
  let json = await processingUrlResponse.json();
  console.log("processing url response: ", json);
  let businessPayment = await ctx.get_payment(res.token);
  vitest.assert(
    businessPayment.status === "pending",
    "payout should stay in pending",
  );
});

test.concurrent("payout pending if timed out", async ({ ctx }) => {
  let { merchant, flintpays, payout } = await setupMerchant(ctx);

  flintpays.queue(async (c) => {
    console.log("waiting for rp to timeout request");
    await delay(60_000);
    return c.json(payout.create_response("created", await c.req.json()));
  });
  let res = await merchant.create_payout(payoutRequest());
  console.log(res);
  let processingUrlResponse = await res.followFirstProcessingUrl();
  vitest.assert(
    processingUrlResponse.status !== 500,
    "merchant should see a proper error",
  );
  let businessPayment = await ctx.get_payment(res.token);
  vitest.assert(
    businessPayment.status === "pending",
    "payout should stay in pending",
  );
});
