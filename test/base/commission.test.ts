import * as default_provider from "@/provider_mocks/default";
import * as common from "@/common";
import { assert, describe } from "vitest";
import { test } from "@/test_context";
import { BrusnikaPayment } from "@/provider_mocks/brusnika";
import { providers } from "@/settings_builder";
import { delay } from "@std/async";
import { CONFIG } from "@/config";

const CURRENCY = "RUB";
let AMOUNT = 1000_00;

describe.concurrent("basic commission", () => {
  for (let success of [true, false]) {
    test.concurrent(
      `payout(${success ? "approve" : "decline"}) with commission`,
      async ({ ctx }) => {
        let merchant = await ctx.create_random_merchant();
        let amount_with_commission = AMOUNT / 100 + (AMOUNT / 100) * 0.1;
        await merchant.cashin(CURRENCY, amount_with_commission);
        await merchant.set_settings(default_provider.fullSettings(CURRENCY));
        await merchant.set_commission({
          operation: "PayoutRequest",
          currency: CURRENCY,
          status: "1",
        });
        await merchant.create_payout(
          default_provider.request(CURRENCY, AMOUNT, "payout", success),
        );
        let wallet = (await merchant.wallets())[0];
        assert.strictEqual(
          wallet.currency,
          CURRENCY,
          "created wallet should be in RUB",
        );
        assert.strictEqual(
          wallet.available,
          success ? 0 : amount_with_commission,
          "merchant wallet amount",
        );
        assert.strictEqual(wallet.held, 0);
      },
    );

    test.concurrent(
      `payin(${success ? "approve" : "decline"}) with commission`,
      async ({ ctx }) => {
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(default_provider.fullSettings(CURRENCY));
        await merchant.set_commission({
          operation: "PayinRequest",
          currency: CURRENCY,
          status: "1",
        });
        await merchant.create_payment(
          default_provider.request(CURRENCY, AMOUNT, "pay", success),
        );
        let wallet = (await merchant.wallets())[0];
        assert.strictEqual(
          wallet.currency,
          CURRENCY,
          "created wallet should be in RUB",
        );
        assert.strictEqual(
          wallet.available,
          success ? AMOUNT / 100 - (AMOUNT / 100) * 0.1 : 0,
          "merchant wallet amount",
        );
        assert.strictEqual(wallet.held, 0);
      },
    );
  }
});

test.concurrent("brusnika(p2p) payin commission", async ({ ctx, brusnika }) => {
  let merchant = await ctx.create_random_merchant();
  let payment = new BrusnikaPayment();
  brusnika.queue(payment.create_handler("in_progress")).then(async () => {
    await delay(11_000);
    await payment.send_callback("success");
  });
  let approved_notification = merchant.queue_notification((notification) => {
    assert.strictEqual(notification.status, "approved");
  });
  let amount_with_commission = AMOUNT / 100 - (AMOUNT / 100) * 0.1;
  await merchant.set_settings(
    providers(CURRENCY, {
      ...BrusnikaPayment.settings(ctx.uuid),
    }),
  );
  await merchant.set_commission({
    operation: "PayinRequest",
    currency: CURRENCY,
    status: "1",
    source: "brusnikapay",
  });
  await merchant
    .create_payment({
      ...common.p2pPaymentRequest(CURRENCY, "card"),
      amount: AMOUNT,
    })
    .then((p) => p.followFirstProcessingUrl());

  await approved_notification;

  let wallet = (await merchant.wallets())[0];
  assert.strictEqual(
    wallet.currency,
    CURRENCY,
    "created wallet should be in RUB",
  );
  assert.strictEqual(
    wallet.available,
    amount_with_commission,
    "merchant wallet amount",
  );
  assert.strictEqual(wallet.held, 0);
});

test
  .skipIf(CONFIG.in_project("8pay"))
  .concurrent("default refund commission", async ({ ctx }) => {
    let merchant = await ctx.create_random_merchant();
    await merchant.set_settings(default_provider.fullSettings("RUB"));
    let commission_amount = (common.amount / 100) * 0.1;
    await merchant.cashin("RUB", commission_amount);
    await merchant.set_commission({
      operation: "RefundRequest",
      self_rate: "10",
      currency: "RUB",
    });

    // merchant should get 3 notifications
    let approveNotifiaction = merchant.queue_notification((n) => {
      assert.strictEqual(n.status, "approved");
    });
    let refundNotification = merchant.queue_notification((n) => {
      assert.strictEqual(n.status, "refunded");
    });
    let refundApprovedNotificication = merchant.queue_notification((n) => {
      assert.strictEqual(n.status, "approved");
      assert.strictEqual(n.type, "refund");
    });

    let res = await merchant.create_payment(
      default_provider.request("RUB", common.amount, "pay", true),
    );
    assert.strictEqual(res.payment.status, "approved");

    let refundRes = await merchant.create_refund({ token: res.token });
    await approveNotifiaction;
    await refundNotification;
    await refundApprovedNotificication;

    let originalFeed = await ctx.get_feed(res.token);
    assert.strictEqual(originalFeed.status, 4);
    assert.strictEqual(originalFeed.commission_amount, 0);
    let refundFeed = await ctx.get_feed(refundRes.refund.token);
    assert.strictEqual(refundFeed.type, "RefundRequest");
    assert.strictEqual(refundFeed.status, 1);
    assert.strictEqual(refundFeed.commission_amount, commission_amount);
    let wallet = (await merchant.wallets())[0];
    assert.strictEqual(wallet.currency, CURRENCY);
    assert.strictEqual(wallet.available, 0);
    assert.strictEqual(wallet.held, 0);
  });

test.concurrent("refund commission with convert_to", async ({ ctx }) => {
  let merchant = await ctx.create_random_merchant();
  let settings = default_provider.fullSettings("EUR") as Record<string, any>;
  settings["convert_to"] = "EUR";
  await merchant.set_settings(settings);
  let commission_amount = (common.amount / 100) * 0.1;
  let cashin_amount = 150;
  await merchant.cashin("EUR", cashin_amount);
  ctx.annotate(`Commission amount: ${commission_amount}`);
  await merchant.set_commission({
    operation: "RefundRequest",
    self_rate: "10",
    currency: "RUB",
  });

  // merchant should get 3 notifications
  let approveNotifiaction = merchant.queue_notification((n) => {
    assert.strictEqual(n.status, "approved");
  });
  let refundNotification = merchant.queue_notification((n) => {
    assert.strictEqual(n.status, "refunded");
  });
  let refundApprovedNotificication = merchant.queue_notification((n) => {
    assert.strictEqual(n.status, "approved");
    assert.strictEqual(n.type, "refund");
  });

  let res = await merchant.create_payment(
    default_provider.request("RUB", common.amount, "pay", true),
  );
  assert.strictEqual(res.payment.status, "approved");

  let refundRes = await merchant.create_refund({ token: res.token });
  await approveNotifiaction;
  await refundNotification;
  await refundApprovedNotificication;

  let originalFeed = await ctx.get_feed(res.token);
  assert.strictEqual(originalFeed.status, 4);
  assert(originalFeed.target_amount);
  assert.strictEqual(originalFeed.commission_amount, 0);
  let refundFeed = await ctx.get_feed(refundRes.refund.token);

  assert.strictEqual(refundFeed.status, 1);
  assert.isNotNull(refundFeed.target_currency_rate);
  assert.notStrictEqual(refundFeed.target_currency_rate, 1);
  assert.notStrictEqual(refundFeed.target_currency_rate, 0);

  assert.strictEqual(
    refundFeed.commission_amount,
    originalFeed.target_amount * 0.1,
  );

  let wallet = (await merchant.wallets("EUR"))[0];
  assert.strictEqual(wallet.currency, "EUR");
  assert.approximately(
    wallet.available,
    cashin_amount - originalFeed.target_amount * 0.1,
    0.01,
  );

  assert.strictEqual(wallet.held, 0);
});

test.concurrent("commission with convert_to", async ({ ctx }) => {
  let merchant = await ctx.create_random_merchant();
  let settings = default_provider.fullSettings("EUR") as Record<string, any>;
  settings["convert_to"] = "EUR";
  await merchant.set_settings(settings);
  let commission_amount = (common.amount / 100) * 0.1;
  ctx.annotate(`Commission amount: ${commission_amount}`);
  await merchant.set_commission({
    operation: "PayinRequest",
    self_rate: "10",
    currency: "RUB",
  });

  // merchant should get 3 notifications
  let approveNotifiaction = merchant.queue_notification((n) => {
    assert.strictEqual(n.status, "approved");
  });

  let res = await merchant.create_payment(
    default_provider.request("RUB", common.amount, "pay", true),
  );
  assert.strictEqual(res.payment.status, "approved");

  let feed = await ctx.get_feed(res.token);
  assert.strictEqual(feed.status, 1);
  assert.isNotNull(feed.target_currency_rate);
  assert.notStrictEqual(feed.target_currency_rate, 1);
  assert.notStrictEqual(feed.target_currency_rate, 0);

  assert.approximately(
    feed.commission_amount!,
    commission_amount / feed.target_currency_rate,
    0.01,
  );
  assert.approximately(
    feed.target_amount!,
    common.amount / 100 / feed.target_currency_rate,
    0.01,
  );
  let wallet = (await merchant.wallets())[0];
  assert.strictEqual(wallet.currency, "EUR");
  assert.approximately(
    wallet.available,
    (common.amount / 100 - commission_amount) / feed.target_currency_rate,
    0.01,
  );

  assert.strictEqual(wallet.held, 0);

  await approveNotifiaction;
});
