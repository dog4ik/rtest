import { assert, describe } from "vitest";
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
import type { Context } from "@/test_context/context";

function payoutRequest(currency?: string) {
  return {
    ...common.payoutRequest(currency ?? "RUB"),
    card: { pan: common.visaCard },
  };
}

async function merchantGet(ctx: Context, path: string, private_key?: string) {
  let headers: Record<string, string> = { "content-type": "application/json" };
  if (private_key !== undefined) {
    headers.authorization = `Bearer ${private_key}`;
  }
  let res = await fetch(`${ctx.shared_state().business_url}${path}`, {
    method: "GET",
    headers,
  });
  let json = (await res.json()) as Record<string, any>;
  ctx.story.add_chapter(`GET ${path}`, json);
  return new ErrorResponse(res, json).as_common_error();
}

function randomToken() {
  return crypto.randomUUID().replaceAll("-", "");
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
    test.concurrent("fields validation", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
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
      }));

    test.concurrent("payout traffic blocked", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let adapter = await ProviderAdapter.create(ctx, payoutSuite("RUB"));
        await adapter.merchant.block_traffic();
        await adapter.merchant.cashin("RUB", common.amount / 100);
        let res = await adapter.merchant.create_payout(payoutRequest());
        let error = await res
          .followFirstProcessingUrl()
          .then((r) => r.as_error());
        error.assert_error([{ code: "traffic_blocked" }]);
      }));

    test.concurrent("payout flexy limit", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
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
      }));

    test.concurrent("payin traffic blocked", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let adapter = await ProviderAdapter.create(ctx, payinSuite("RUB"));
        await adapter.merchant.block_traffic();
        let res = await adapter.merchant.create_payment(
          common.paymentRequest("RUB"),
        );
        let error = await res
          .followFirstProcessingUrl()
          .then((r) => r.as_error());
        error.assert_error([{ code: "traffic_blocked", kind: "api_error" }]);
      }));

    test.concurrent("payin flexy limit", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
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
      }));

    test.concurrent("payout no balance", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let adapter = await ProviderAdapter.create(ctx, payoutSuite("RUB"));
        let error = await adapter.merchant.create_payout_err(payoutRequest());
        error.assert_error([
          { code: "amount_less_than_balance", kind: "processing_error" },
        ]);
      }));

    test.concurrent("payout unexpected currency", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
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
      }));
  });

describe.runIf(CONFIG.in_project(["8pay"])).concurrent("strict errors", () => {
  test.concurrent("invalid json", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
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
    }));

  test.concurrent("balance wallet validation", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let merchant = await ctx.create_random_merchant();
      let res = await fetch(
        `${ctx.shared_state().business_url}/api/v1/balance?wrong_param=RUB`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${merchant.merchant_private_key}`,
          },
        },
      ).then(async (r) => {
        let json = (await r.json()) as Record<string, any>;
        ctx.story.add_chapter("Balance response", json);
        return new ErrorResponse(r, json).as_common_error();
      });

      res.assert_strict_error([
        { code: "invalid_param", kind: "invalid_request_error" },
      ]);
    }));

  test.concurrent("settings for currency are not set", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let merchant = await ctx.create_random_merchant();
      await merchant.set_settings(default_provider.fullSettings("RUB"));
      let err = await merchant.create_payment_err(common.paymentRequest("KRW"));

      err.assert_strict_error([
        {
          code: "settings_for_currency_are_absent",
          kind: "settings_error",
        },
      ]);
    }));

  test.concurrent("merchant private key is missing", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
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
    }));

  test.concurrent("merchant private key is invalid", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
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
    }));

  test.concurrent("payout no balance", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(ctx, payoutSuite("RUB"));
      let error = await adapter.merchant.create_payout_err(payoutRequest());
      error.assert_strict_error([
        { code: "balance_less_than_amount", kind: "processing_error" },
      ]);
    }));

  test.concurrent("fields validation", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
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
    }));

  test.concurrent("fields validation > 1 fields", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
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
    }));

  test.concurrent("flexy guard decline", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
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
    }));

  test.concurrent("endpoint is not found", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
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
    }));

  test.concurrent("status: not found payment", ({ ctx, merchant }) =>
    ctx.track_bg_rejections(async () => {
      let err = await merchant.fetch_status_err("cool_token");

      err.assert_strict_error([
        {
          code: "payment_not_found",
          kind: "processing_error",
        },
      ]);
    }));

  test.concurrent("transaction status for different merchant", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
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
    }));

  test.concurrent("traffic blocked (h2h)", ({ ctx, merchant }) =>
    ctx.track_bg_rejections(async () => {
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
    }));

  test.concurrent("gateway error reaches merchant", ({ ctx, merchant }) =>
    ctx.track_bg_rejections(async () => {
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
    }));

  test.concurrent("unique order number: payin", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(
        ctx,
        payinSuite("RUB"),
        undefined,
        { unique_order_number: true },
      );
      let order_number = crypto.randomUUID();
      await adapter.merchant.create_payment({
        ...common.paymentRequest("RUB"),
        order_number,
      });
      let err = await adapter.merchant.create_payment_err({
        ...common.paymentRequest("RUB"),
        order_number,
      });

      err.assert_strict_error([
        { code: "order_number_already_exists", kind: "processing_error" },
      ]);
    }));

  test.concurrent("unique order number: payout", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(
        ctx,
        payoutSuite("RUB"),
        undefined,
        { unique_order_number: true },
      );
      await adapter.merchant.cashin("RUB", (common.amount / 100) * 10);
      let request = payoutRequest();
      adapter.queue_create("pending");
      await adapter.merchant.create_payout(request);
      let err = await adapter.merchant.create_payout_err({
        ...payoutRequest(),
        order_number: request.order_number,
      });

      err.assert_strict_error([
        { code: "order_number_already_exists", kind: "processing_error" },
      ]);
    }));

  test.concurrent("unique order number disabled: duplicate is allowed", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(ctx, payinSuite("RUB"));
      let order_number = crypto.randomUUID();
      await adapter.merchant.create_payment({
        ...common.paymentRequest("RUB"),
        order_number,
      });
      await adapter.merchant.create_payment({
        ...common.paymentRequest("RUB"),
        order_number,
      });
    }));

  test.concurrent("payin zero amount", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(ctx, payinSuite("RUB"));
      let err = await adapter.merchant.create_payment_err({
        ...common.paymentRequest("RUB"),
        amount: 0,
      });

      err.assert_strict_error([
        { code: "incorrect_amount", kind: "invalid_request_error" },
      ]);
    }));

  const invalidAmounts = [
    ["negative", -100],
    ["string", "abc"],
    ["float", 12.5],
  ] as const;

  describe.concurrent("payin invalid amount", () => {
    for (let [name, amount] of invalidAmounts) {
      test.concurrent(name, ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let adapter = await ProviderAdapter.create(ctx, payinSuite("RUB"));
          let err = await adapter.merchant.create_payment_err({
            ...common.paymentRequest("RUB"),
            amount,
          });

          err.assert_strict_error([
            { code: "invalid_param", kind: "invalid_request_error" },
          ]);
        }),
      );
    }
  });

  describe.concurrent("payout invalid amount", () => {
    for (let [name, amount] of invalidAmounts) {
      test.concurrent(name, ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let adapter = await ProviderAdapter.create(ctx, payoutSuite("RUB"));
          await adapter.merchant.cashin("RUB", common.amount / 100);
          let err = await adapter.merchant.create_payout_err({
            ...payoutRequest(),
            amount,
          });

          err.assert_strict_error([
            { code: "invalid_param", kind: "invalid_request_error" },
          ]);
        }),
      );
    }
  });

  test.concurrent("payout zero amount", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(ctx, payoutSuite("RUB"));
      await adapter.merchant.cashin("RUB", common.amount / 100);
      let err = await adapter.merchant.create_payout_err({
        ...payoutRequest(),
        amount: 0,
      });

      err.assert_strict_error([
        { code: "amount_less_than_minimum", kind: "invalid_request_error" },
      ]);
    }));

  test.concurrent("order lookup: unknown order number", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(ctx, payinSuite("RUB"));
      let err = await merchantGet(
        ctx,
        `/api/v1/payments/order/${crypto.randomUUID()}`,
        adapter.merchant.merchant_private_key,
      );

      err.assert_strict_error([
        { code: "payment_not_found", kind: "processing_error" },
      ]);
    }));

  test.concurrent("order lookup: order number of different merchant", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
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
      let order_number = crypto.randomUUID();
      await merchant1.create_payment({
        ...common.paymentRequest("RUB"),
        order_number,
      });
      let err = await merchantGet(
        ctx,
        `/api/v1/payments/order/${order_number}`,
        merchant2.merchant_private_key,
      );

      err.assert_strict_error([
        { code: "payment_not_found", kind: "processing_error" },
      ]);
    }));

  describe.concurrent("payments list invalid params", () => {
    for (let [name, query] of [
      ["zero page", "page=0"],
      ["date_from after date_to", "date_from=2026-02-01&date_to=2026-01-01"],
      ["unknown operation_type", "operation_type=foo"],
    ] as const) {
      test.concurrent(name, ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let adapter = await ProviderAdapter.create(ctx, payinSuite("RUB"));
          let err = await merchantGet(
            ctx,
            `/api/v1/payments?${query}`,
            adapter.merchant.merchant_private_key,
          );

          err.assert_strict_error([
            { code: "invalid_param", kind: "invalid_request_error" },
          ]);
        }),
      );
    }
  });

  test.concurrent("status: merchant private key is missing", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(ctx, payinSuite("RUB"));
      let payment = await adapter.merchant.create_payment(
        common.paymentRequest("RUB"),
      );
      let err = await merchantGet(ctx, `/api/v1/payments/${payment.token}`);

      err.assert_strict_error([
        { code: "incorrect_private_key", kind: "authentication_error" },
      ]);
    }));

  test.concurrent("status: merchant private key is invalid", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(ctx, payinSuite("RUB"));
      let payment = await adapter.merchant.create_payment(
        common.paymentRequest("RUB"),
      );
      let err = await merchantGet(
        ctx,
        `/api/v1/payments/${payment.token}`,
        "privet",
      );

      err.assert_strict_error([
        { code: "incorrect_private_key", kind: "authentication_error" },
      ]);
    }));

  // Business always returns OK regardless of specified currency
  test.todo("balance: unknown currency", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let merchant = await ctx.create_random_merchant();
      let err = await merchantGet(
        ctx,
        "/api/v1/balance?currency=ZZZ",
        merchant.merchant_private_key,
      );

      err.assert_strict_error([
        { code: "incorrect_currency", kind: "invalid_request_error" },
      ]);
    }));

  test.concurrent("refund: unknown payment", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(ctx, payinSuite("RUB"));
      let err = await adapter.merchant
        .create_refund_err({ token: randomToken() })
        .then((e) => e.as_common_error());

      err.assert_strict_error([
        { code: "payment_not_found", kind: "processing_error" },
      ]);
    }));

  test.concurrent("refund: payment of different merchant", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
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
      let err = await merchant2
        .create_refund_err({ token: payment.token })
        .then((e) => e.as_common_error());

      err.assert_strict_error([
        { code: "payment_not_found", kind: "processing_error" },
      ]);
    }));

  test.concurrent("refund: payment is not approved", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(ctx, payinSuite("RUB"));
      let payment = await adapter.merchant.create_payment(
        common.paymentRequest("RUB"),
      );
      let err = await adapter.merchant
        .create_refund_err({ token: payment.token })
        .then((e) => e.as_common_error());

      // TODO: assert exact code once engine documents one for "payment is not approved"
      assert.lengthOf(err.errors, 1);
      let [error] = err.errors as { code: string; kind: string }[];
      assert.notStrictEqual(error.code, "internal_error");
      assert.strictEqual(error.kind, "processing_error");
    }));

  test.concurrent("refund: string amount", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let adapter = await ProviderAdapter.create(ctx, payinSuite("RUB"));
      let payment = await adapter.merchant.create_payment(
        common.paymentRequest("RUB"),
      );
      let err = await adapter.merchant
        .create_refund_err({ token: payment.token, amount: "100" as any })
        .then((e) => e.as_common_error());

      err.assert_strict_error([
        { code: "invalid_param", kind: "invalid_request_error" },
      ]);
    }));

  describe.concurrent("refund invalid token", () => {
    for (let [name, token] of [
      ["short token", "bad-token!!"],
      ["long token", "a".repeat(40)],
      // passes json schema (32 chars, ends with alnum), rejected by use case
      ["token with unsupported characters", `${"!".repeat(31)}a`],
    ] as const) {
      test.concurrent(name, ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let adapter = await ProviderAdapter.create(ctx, payinSuite("RUB"));
          let err = await adapter.merchant
            .create_refund_err({ token })
            .then((e) => e.as_common_error());

          err.assert_strict_error([
            { code: "invalid_param", kind: "invalid_request_error" },
          ]);
        }),
      );
    }
  });
});
