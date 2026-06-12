import * as default_provider from "@/provider_mocks/default";
import * as common from "@/common";
import { test } from "@/test_context";
import { assert } from "vitest";
import { delay } from "@std/async";

test.concurrent("default approved payin", async ({ ctx }) => {
  let merchant = await ctx.create_random_merchant();
  await merchant.set_settings(default_provider.fullSettings("RUB"));
  let response = await merchant.create_payment(
    default_provider.request("RUB", 12345, "pay", true),
  );
  assert(response.payment.status == "approved");
});

test.concurrent("default declined payin", async ({ ctx }) => {
  let merchant = await ctx.create_random_merchant();
  await merchant.set_settings(default_provider.fullSettings("RUB"));
  let response = await merchant.create_payment(
    default_provider.request("RUB", 12345, "pay", false),
  );
  assert(response.payment.status == "declined");
});

test.concurrent("default declined payin (flexy)", async ({ ctx }) => {
  let merchant = await ctx.create_random_merchant();
  await merchant.set_settings(default_provider.fullSettings("RUB"));
  let response = await merchant.create_payment(
    default_provider.request("RUB", 12345, "pay", false),
  );
  assert(response.payment.status == "declined");
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

test.concurrent("default declined payout", async ({ ctx }) => {
  let merchant = await ctx.create_random_merchant();

  await merchant.set_settings(default_provider.fullSettings("RUB"));
  await merchant.cashin("RUB", common.amount / 100);
  let response = await merchant.create_payout(
    default_provider.request("RUB", common.amount, "payout", false),
  );
  assert(response.payout?.status == "declined");
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

  let refund_notifications =
    merchant.queue_refund_or_pay_notifictation("approved");
  await merchant.create_refund({ token: response.token });
  await refund_notifications;
});

test.concurrent(
  "default approved partial refund with commission 2",
  async ({ ctx }) => {
    let merchant = await ctx.create_random_merchant();

    await merchant.set_settings(default_provider.fullSettings("RUB"));
    const COMMISSION_RATE = 0.1;
    let amount = 100_00;
    let partial_amount = amount / 2;
    let commission_amount = (partial_amount / 100) * COMMISSION_RATE;
    let cashin_amount = commission_amount * 3 - 1;
    await merchant.cashin("RUB", cashin_amount);
    await merchant.set_commission({
      self_rate: (COMMISSION_RATE * 100).toString(),
      operation: "RefundRequest",
    });

    let approve_notifiaction = merchant.queue_notification((c) => {
      assert.strictEqual(c.type, "pay");
      assert.strictEqual(c.status, "approved");
    });
    let response = await merchant.create_payment(
      default_provider.request("RUB", amount, "pay", true),
    );
    assert(response.payment?.status == "approved");
    await approve_notifiaction;

    await merchant.create_refund({
      token: response.token,
      amount: partial_amount,
    });

    await ctx.annotate(JSON.stringify(await merchant.wallets()));

    await delay(7_000);
    await merchant.create_refund({
      token: response.token,
      amount: partial_amount,
    });
    await delay(2_000);
    await ctx.annotate(JSON.stringify(await merchant.wallets()));
    let wallet = (await merchant.wallets("RUB"))[0];
    assert.strictEqual(wallet.currency, "RUB");
    assert.strictEqual(
      wallet.available,
      amount / 100 +
        cashin_amount -
        (partial_amount / 100 + commission_amount) * 2,
      "available should be 0 after refund",
    );
    assert.strictEqual(wallet.held, 0, "held should be 0 after refund");
  },
);

test.concurrent(
  "default payin core status change with commission approved -> declined",
  async ({ ctx }) => {
    let merchant = await ctx.create_random_merchant();
    await merchant.set_commission({
      self_rate: (0.1 * 100).toString(),
      operation: "PayinRequest",
    });
    await merchant.set_settings(default_provider.fullSettings("RUB"));
    let approved_notification = merchant.queue_notification((notification) => {
      assert.strictEqual(notification.status, "approved");
    });
    let response = await merchant.create_payment(
      default_provider.request("RUB", common.amount, "pay", true),
    );
    assert.strictEqual(response.payment.status, "approved");
    await approved_notification;
    let declined_notification = merchant.queue_notification((notification) => {
      assert.strictEqual(notification.status, "declined");
    });

    let feed = await ctx.get_feed(response.token);
    ctx.shared_state().core_harness.change_status(feed.id, "declined");
    await declined_notification;
    let wallet = (await merchant.wallets())[0];
    assert.strictEqual(wallet.available, 0);
    assert.strictEqual(wallet.held, 0);
  },
);

test.concurrent(
  "default payin core status change with commission declined -> approved",
  async ({ ctx }) => {
    let merchant = await ctx.create_random_merchant();
    await merchant.set_commission({
      self_rate: (0.1 * 100).toString(),
      operation: "PayinRequest",
    });
    await merchant.set_settings(default_provider.fullSettings("RUB"));
    let declined_notification = merchant.queue_notification((notification) => {
      assert.strictEqual(notification.status, "declined");
    });
    let response = await merchant.create_payment(
      default_provider.request("RUB", common.amount, "pay", false),
    );
    assert.strictEqual(response.payment.status, "declined");
    await declined_notification;
    let approved_notification = merchant.queue_notification((notification) => {
      assert.strictEqual(notification.status, "approved");
    });

    let feed = await ctx.get_feed(response.token);
    ctx.shared_state().core_harness.change_status(feed.id, "approved");
    await approved_notification;
    let wallet = (await merchant.wallets())[0];
    assert.strictEqual(
      wallet.available,
      common.amount / 100 - (common.amount / 100) * 0.1,
    );
    assert.strictEqual(wallet.held, 0);
  },
);
