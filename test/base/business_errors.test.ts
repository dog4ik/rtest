import { describe } from "vitest";
import * as common from "@/common";
import { CONFIG, PROJECT } from "@/config";
import { ErrorResponse } from "@/entities/payment/error_response";
import * as default_provider from "@/provider_mocks/default";
import * as flintpays from "@/provider_mocks/flintpays";
import * as gc from "@/provider_mocks/gateway_connect";
import * as millennium from "@/provider_mocks/millennium";
import {
  defaultSuite,
  type P2PSuite,
  providersSuite,
} from "@/suite_interfaces";
import { ProviderAdapter } from "@/suite_interfaces/provider_adapter";
import { test } from "@/test_context";

function payoutRequest(currency?: string) {
  return {
    ...common.payoutRequest(currency ?? "RUB"),
    card: { pan: common.visaCard },
  };
}

function payoutSuite(curr: string): P2PSuite<unknown> {
  if (PROJECT === "spinpay") {
    return providersSuite(curr, flintpays.payoutSuite());
  } else {
    return defaultSuite(curr, millennium.payoutSuite());
  }
}

function payinSuite(curr: string): P2PSuite<unknown> {
  if (PROJECT === "spinpay") {
    return providersSuite(curr, flintpays.payinSuite());
  } else {
    return providersSuite(curr, millennium.payinSuite());
  }
}

describe
  .runIf(CONFIG.in_project(["reactivepay", "spinpay"]))
  .concurrent("loosy errors", () => {
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
        if (CONFIG.in_project(["spinpay"])) {
          err.assert_message(
            "The property '#/' did not contain a required property of 'amount' in schema file:///business/schema/payouts_provider_create.json",
          );
        } else {
          err.assert_message(
            "The property '#/' did not contain a required property of 'amount' in schema file:///business/schema/payouts_create.json",
          );
        }
      });
    });

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

    test.concurrent("payout no balance", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let adapter = await ProviderAdapter.create(ctx, payoutSuite("RUB"));
        let error = await adapter.merchant.create_payout_err(payoutRequest());
        error.assert_error([
          { code: "amount_less_than_balance", kind: "processing_error" },
        ]);
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

describe.runIf(CONFIG.in_project(["8pay"])).concurrent("strict errors", () => {
  test.concurrent("invalid json", async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(ctx, payoutSuite("RUB"));
      let res = await fetch(
        `${ctx.shared_state().business_url}/api/v1/payments`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${adapter.merchant.merchant_private_key}`,
          },
          body: "hello my friend",
        },
      ).then(async (r) =>
        new ErrorResponse(r, await r.json()).as_common_error(),
      );
      res.assert_strict_error([
        { code: "invalid_json", kind: "invalid_request_error" },
      ]);
    });
  });

  test.concurrent("settings for currency are not set", async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      let merchant = await ctx.create_random_merchant();
      await merchant.set_settings(default_provider.fullSettings("RUB"));
      let err = await merchant.create_payment_err(common.paymentRequest("KRW"));

      err.assert_strict_error([
        {
          code: "settings_for_currency_are_absent",
          kind: "settings_error",
        },
      ]);
    });
  });

  test.concurrent("merchant private key is missing", async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      let err = await fetch(
        `${ctx.shared_state().business_url}/api/v1/payments`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(common.paymentRequest("RUB")),
        },
      ).then(async (r) =>
        new ErrorResponse(r, await r.json()).as_common_error(),
      );
      err.assert_strict_error([
        { code: "incorrect_private_key", kind: "authentication_error" },
      ]);
    });
  });

  test.concurrent("merchant private key is invalid", async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      let err = await fetch(
        `${ctx.shared_state().business_url}/api/v1/payments`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer privet",
          },
          body: JSON.stringify(common.paymentRequest("RUB")),
        },
      ).then(async (r) =>
        new ErrorResponse(r, await r.json()).as_common_error(),
      );
      err.assert_strict_error([
        { code: "incorrect_private_key", kind: "authentication_error" },
      ]);
    });
  });

  test.concurrent("payout no balance", async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(ctx, payoutSuite("RUB"));
      let error = await adapter.merchant.create_payout_err(payoutRequest());
      error.assert_strict_error([
        { code: "balance_less_than_amount", kind: "processing_error" },
      ]);
    });
  });

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
      err.assert_strict_error([
        // TODO: assert message when implemented
        { code: "invalid_param", kind: "invalid_request_error" },
      ]);
    });
  });

  test.concurrent("fields validation > 1 fields", async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(ctx, payoutSuite("RUB"));
      let err = await adapter.merchant.create_payout_err({
        product: "Tests",
        order_number: "993463668022",
        card: {
          pan: common.visaCard,
        },
        customer: {
          ip: "127.0.0.1",
          email: "octo.mail@mail.com",
        },
      });
      err.assert_strict_error([
        // TODO: assert messages when implemented
        { code: "invalid_param", kind: "invalid_request_error" },
        { code: "invalid_param", kind: "invalid_request_error" },
      ]);
    });
  });

  test.concurrent("flexy guard decline", async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(ctx, payinSuite("RUB"));
      await adapter.merchant.set_limits(100, 200);
      let err = await adapter.merchant
        .create_payment(common.paymentRequest("RUB"))
        .then((r) => r.followFirstProcessingUrl())
        .then((r) => r.as_error());
      err.assert_strict_error([
        // TODO: need to find better code
        {
          code: "fetch_processing_url_error",
          kind: "api_fraud_error",
          message: "antifraud: mid:card:amount:value=>[100, 200]=>123456",
        },
      ]);
    });
  });

  test.concurrent("endpoint is not found", async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(ctx, payinSuite("RUB"));
      let err = await fetch(
        `${ctx.shared_state().business_url}/api/v2/payments`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${adapter.merchant.merchant_private_key}`,
          },
          body: JSON.stringify(common.paymentRequest("RUB")),
        },
      ).then(async (r) =>
        new ErrorResponse(r, await r.json()).as_common_error(),
      );
      err.assert_strict_error([
        {
          code: "no_route_match",
          kind: "api_error",
        },
      ]);
    });
  });

  test.concurrent("status: not found payment", async ({ ctx, merchant }) => {
    await ctx.track_bg_rejections(async () => {
      let err = await merchant.fetch_status_err("cool_token");

      err.assert_strict_error([
        {
          code: "payment_not_found",
          kind: "processing_error",
        },
      ]);
    });
  });

  test.concurrent("transaction status for different merchant", async ({
    ctx,
  }) => {
    await ctx.track_bg_rejections(async () => {
      let suite = payinSuite("RUB");
      let [merchant1, merchant2] = await Promise.all([
        ctx
          .create_random_merchant()
          .then(
            async (m) => (await m.set_settings(suite.settings(ctx.uuid)), m),
          ),
        ctx
          .create_random_merchant()
          .then(
            async (m) => (await m.set_settings(suite.settings(ctx.uuid)), m),
          ),
      ]);
      let payment = await merchant1.create_payment(
        common.paymentRequest("RUB"),
      );

      await merchant1.fetch_status(payment.token);
      let err = await merchant2.fetch_status_err(payment.token);

      err.assert_strict_error([
        {
          code: "payment_not_found",
          kind: "processing_error",
        },
      ]);
    });
  });

  test.concurrent("traffic blocked (h2h)", async ({ ctx, merchant }) => {
    await ctx.track_bg_rejections(async () => {
      await merchant.set_settings(default_provider.fullSettings("RUB"));
      await merchant.block_traffic(true);
      let err = await merchant.create_payment_err(
        default_provider.request("RUB", common.amount, "pay", true),
      );

      err.assert_strict_error([
        {
          // TODO: proper error code for blocked traffic
          code: "internal_error",
          kind: "processing_error",
        },
      ]);
    });
  });

  test.concurrent("gateway error reaches merchant", async ({
    ctx,
    merchant,
  }) => {
    await ctx.track_bg_rejections(async () => {
      let suite = providersSuite("RUB", gc.payinSuite("RUB"));
      let gw = suite.gw;
      let server = ctx.mock_server(suite.mock_options(ctx.uuid));
      let message = "No available requisites";
      server.queue(gw.error_handler(message));
      await merchant.set_settings(suite.settings(ctx.uuid));
      let err = await merchant
        .create_payment(suite.request())
        .then((r) => r.followFirstProcessingUrl())
        .then((r) => r.as_error());

      err.assert_strict_error([
        {
          // TODO: proper error code for blocked traffic
          message: `error: ${message}`,
          code: "gateway_response_error",
          kind: "gateway_error",
        },
      ]);
    });
  });

  test.concurrent("unique order number", async ({ ctx, merchant }) => {
    await ctx.track_bg_rejections(async () => {
      let suite = providersSuite("RUB", gc.payinSuite("RUB"));
      let gw = suite.gw;
      let server = ctx.mock_server(suite.mock_options(ctx.uuid));
      let message = "No available requisites";
      server.queue(gw.error_handler(message));
      await merchant.set_settings(suite.settings(ctx.uuid));
      let err = await merchant
        .create_payment(suite.request())
        .then((r) => r.followFirstProcessingUrl())
        .then((r) => r.as_error());

      err.assert_strict_error([
        {
          // TODO: proper error code for blocked traffic
          message: `error: ${message}`,
          code: "gateway_response_error",
          kind: "gateway_error",
        },
      ]);
    });
  });
});
