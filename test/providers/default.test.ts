import * as default_provider from "@/provider_mocks/default";
import * as common from "@/common";
import { test } from "@/test_context";
import { assert } from "vitest";

test.concurrent("default approved payin", async ({ ctx }) => {
  let merchant = await ctx.create_random_merchant();
  await merchant.set_settings(default_provider.fullSettings("RUB"));
  let response = await merchant.create_payment(
    default_provider.request("RUB", 12345, "pay", true),
  );
  assert(response.payment.status == "approved");
});

test.concurrent("default approved payout", async ({ ctx }) => {
  let merchant = await ctx.create_random_merchant();

  await merchant.set_settings(default_provider.fullSettings("RUB"));
  await merchant.cashin("RUB", common.amount / 100);
  let response = await merchant.create_payout(
    default_provider.request("RUB", common.amount, "payout", true),
  );
  assert(response.payout?.status == "approved");
});

test.concurrent("default approved refund", async ({ ctx }) => {
  let merchant = await ctx.create_random_merchant();

  await merchant.set_settings(default_provider.fullSettings("RUB"));
  await merchant.cashin("RUB", common.amount / 100);
  let approve_notifiaction = merchant.queue_notification((c) => {
    assert.strictEqual(c.type, "pay");
    assert.strictEqual(c.status, "approved");
  });
  let response = await merchant.create_payment(
    default_provider.request("RUB", common.amount, "pay", true),
  );
  assert(response.payment?.status == "approved");
  await approve_notifiaction;

  let approve_refund = merchant.queue_notification((c) => {
    assert.strictEqual(c.type, "refund");
    assert.strictEqual(c.status, "approved");
  });
  let payment_refunded = merchant.queue_notification((c) => {
    assert.strictEqual(c.type, "pay");
    assert.strictEqual(c.status, "refunded");
  });
  await merchant.create_refund({ token: response.token });
  await approve_refund;
  await payment_refunded;
});
