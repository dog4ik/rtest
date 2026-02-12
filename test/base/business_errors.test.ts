import { CONFIG, PROJECT } from "@/config";
import { test } from "@/test_context";
import * as common from "@/common";
import { describe } from "vitest";
import { ProviderAdapter } from "@/suite_interfaces/provider_adapter";
import * as millennium from "@/provider_mocks/millennium";
import * as flintpays from "@/provider_mocks/flintpays";
import {
  defaultSuite,
  providersSuite,
  type P2PSuite,
} from "@/suite_interfaces";

function payoutRequest(currency?: string) {
  return {
    ...common.payoutRequest(currency ?? "RUB"),
    card: { pan: common.visaCard },
  };
}

function payoutSuite(curr: string): P2PSuite<unknown> {
  if (PROJECT === "spinpay") {
    return providersSuite(curr, flintpays.payoutSuite);
  } else {
    return defaultSuite(curr, millennium.payoutSuite);
  }
}

function payinSuite(curr: string): P2PSuite<unknown> {
  if (PROJECT === "spinpay") {
    return providersSuite(curr, flintpays.payinSuite);
  } else {
    return providersSuite(curr, millennium.payinSuite);
  }
}

describe.concurrent("errors before processingUrl", () => {
  test.concurrent("fields validation", async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(ctx, payoutSuite("RUB"));
      let err = await adapter.merchant.create_payout_err({
        product: "Tests",
        order_number: "993463668022",
        currency: "RUB",
        card: {
          pan: common.visaCard,
        },
        customer: {
          ip: "127.0.0.1",
          email: "octo.mail@mail.com",
        },
      });
      err.assert_message(
        "The property '#/' did not contain a required property of 'amount' in schema file:///business/schema/payouts_create.json",
      );
    });
  });

  test.concurrent("payout no balance", async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      if (PROJECT === "spinpay") {
        let adapter = await ProviderAdapter.create(ctx, payoutSuite("RUB"));
        let res = await adapter.merchant.create_payout(payoutRequest());
        let error = await res
          .followFirstProcessingUrl()
          .then((r) => r.as_error());
        error.assert_error([
          { code: "amount_not_enough_money", kind: "amount" },
        ]);
      } else {
        let adapter = await ProviderAdapter.create(ctx, payoutSuite("RUB"));
        let error = await adapter.merchant.create_payout_err(payoutRequest());
        error.assert_error([
          { code: "amount_less_than_balance", kind: "processing_error" },
        ]);
      }
    });
  });

  test.concurrent("payout unexpected currency", async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(ctx, payoutSuite("RUB"));
      let error = await adapter.merchant.create_payout_err(
        payoutRequest("EUR"),
      );
      error.assert_error([
        {
          code: `absent_keys:Currency EUR is not active for merchant ${adapter.merchant.merchant_private_key}`,
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
        let adapter = await ProviderAdapter.create(ctx, payoutSuite("RUB"));
        await adapter.merchant.block_traffic();
        await adapter.merchant.cashin("RUB", common.amount / 100);
        let res = await adapter.merchant.create_payout(payoutRequest());
        let error = await res
          .followFirstProcessingUrl()
          .then((r) => r.as_error());
        error.assert_error([{ code: "traffic_blocked" }]);
      });
    });

    test.concurrent("payout flexy limit", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let adapter = await ProviderAdapter.create(ctx, payoutSuite("RUB"));
        await adapter.merchant.cashin("RUB", (common.amount / 100) * 100);
        await adapter.merchant.set_limits(100, 1000);
        let res = await adapter.merchant.create_payout(payoutRequest());
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
        let adapter = await ProviderAdapter.create(ctx, payinSuite("RUB"));
        await adapter.merchant.block_traffic();
        let res = await adapter.merchant.create_payment(
          common.paymentRequest("RUB"),
        );
        let error = await res
          .followFirstProcessingUrl()
          .then((r) => r.as_error());
        error.assert_error([{ code: "traffic_blocked", kind: "api_error" }]);
      });
    });

    test.concurrent("payin flexy limit", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let adapter = await ProviderAdapter.create(ctx, payinSuite("RUB"));
        await adapter.merchant.set_limits(100, 1000);
        let res = await adapter.merchant.create_payment(
          common.paymentRequest("RUB"),
        );
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
