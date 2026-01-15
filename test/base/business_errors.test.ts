import { CONFIG, test } from "@/test_context";
import * as millennium from "@/provider_mocks/millennium";
import * as common from "@/common";
import { providers } from "@/settings_builder";
import { describe } from "vitest";
import type { Context } from "@/test_context/context";

function payoutRequest(currency?: string) {
  return {
    ...common.payoutRequest(currency ?? "RUB"),
    card: { pan: common.visaCard },
  };
}

async function setupMerchant(ctx: Context) {
  let merchant = await ctx.create_random_merchant();
  await merchant.set_settings(
    providers("RUB", millennium.MillenniumTransaction.settings(ctx.uuid)),
  );
  ctx.mock_server(millennium.MillenniumTransaction.mock_params(ctx.uuid));

  return merchant;
}

describe.concurrent("errors before processingUrl", () => {
  test.concurrent("fields validation", async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      let merchant = await setupMerchant(ctx);
      let err = await merchant.create_payout_err({
        product: "Tests",
        order_number: "993463668022",
        currency: "RUB",
        card: {
          pan: "4627342642639018",
        },
        customer: {
          ip: "127.0.0.1",
          email: "octo.mail@mail.com",
        },
      });
      err.assert_message(
        "The property '#/' did not contain a required property of 'amount' in schema file:///business/schema/payouts_provider_create.json",
      );
    });
  });

  test.concurrent("payout no balance", async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      let merchant = await setupMerchant(ctx);
      let error = await merchant.create_payout_err(payoutRequest());
      error.assert_error([
        { code: "amount_less_than_balance", kind: "processing_error" },
      ]);
    });
  });

  test.concurrent("payout unexpected currency", async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      let merchant = await ctx.create_random_merchant();
      await merchant.set_settings(
        providers("RUB", millennium.MillenniumTransaction.settings(ctx.uuid)),
      );
      let error = await merchant.create_payout_err(payoutRequest("EUR"));
      error.assert_error([
        {
          code: `absent_keys:Currency EUR is not active for merchant ${merchant.merchant_private_key}`,
          kind: "settings_error",
        },
      ]);
    });
  });
});

describe
  // 8pay shows payform after processingUrl
  .skipIf(CONFIG.project === "8pay")
  .concurrent("errors after processingUrl", () => {
    test.concurrent("payout traffic blocked", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await setupMerchant(ctx);
        await merchant.block_traffic();
        await merchant.cashin("RUB", common.amount / 100);
        let res = await merchant.create_payout(payoutRequest());
        let error = await res
          .followFirstProcessingUrl()
          .then((r) => r.as_error());
        error.assert_error([{ code: "traffic_blocked" }]);
      });
    });

    test.concurrent("payout flexy limit", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await setupMerchant(ctx);
        await merchant.cashin("RUB", (common.amount / 100) * 100);
        await merchant.set_limits(100, 1000);
        let res = await merchant.create_payout(payoutRequest());
        let error = await res
          .followFirstProcessingUrl()
          .then((r) => r.as_error());
        error.assert_error([
          {
            code: "antifraud: mid:card:amount:value=>[100, 1000]=>123456",
          },
        ]);
      });
    });

    test.concurrent("payin traffic blocked", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await setupMerchant(ctx);
        await merchant.block_traffic();
        let res = await merchant.create_payment(common.paymentRequest("RUB"));
        let error = await res
          .followFirstProcessingUrl()
          .then((r) => r.as_error());
        error.assert_error([{ code: "traffic_blocked" }]);
      });
    });

    test.concurrent("payin flexy limit", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await setupMerchant(ctx);
        await merchant.set_limits(100, 1000);
        let res = await merchant.create_payment(common.paymentRequest("RUB"));
        let error = await res
          .followFirstProcessingUrl()
          .then((r) => r.as_error());
        error.assert_error([
          {
            code: "antifraud: mid:card:amount:value=>[100, 1000]=>123456",
          },
        ]);
      });
    });
  });
