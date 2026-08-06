import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as assets from "@/assets";
import * as common from "@/common";
import type { CreateTraderOptions } from "@/driver/core";
import { traderNoConvertSettings } from "@/driver/trader";
import type { ExtendedMerchant } from "@/entities/merchant";
import * as default_provider from "@/provider_mocks/default";
import { test } from "@/test_context";
import type { Context } from "@/test_context/context";

const AMOUNT = 100_000;
const AMOUNT_RUB = AMOUNT / 100;
const SELF_RATE = 0.1;
const PROVIDER_RATE = 0.05;
const COMMISSION_RUB = AMOUNT_RUB * SELF_RATE;
const PROVIDER_COMMISSION_RUB = AMOUNT_RUB * PROVIDER_RATE;
const NET_RUB = AMOUNT_RUB - COMMISSION_RUB;
const MERCHANT_CASHIN_RUB = AMOUNT_RUB + COMMISSION_RUB;

describe.skip("admin payin state changes", () => {
  async function setup(ctx: Context): Promise<ExtendedMerchant> {
    let merchant = await ctx.create_random_merchant();
    await merchant.set_commission({ operation: "PayinRequest" });
    await merchant.set_settings(default_provider.fullSettings("RUB"));
    return merchant;
  }

  async function setupApproved(ctx: Context) {
    let merchant = await setup(ctx);
    let approved_notification = merchant.queue_notification((n) => {
      assert.strictEqual(n.type, "pay");
      assert.strictEqual(n.status, "approved");
    });
    let response = await merchant.create_payment(
      default_provider.request("RUB", AMOUNT, "pay", true),
    );
    assert.strictEqual(response.payment.status, "approved");
    await approved_notification;
    let feed = await ctx.get_feed(response.token);
    return { merchant, response, feed };
  }

  test.concurrent("accepted -> declined", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, response, feed } = await setupApproved(ctx);

      assert.strictEqual(feed.status, 1, "feed: accepted");
      assert.strictEqual(feed.commission_amount, COMMISSION_RUB);
      assert.strictEqual(
        feed.commission_provider_amount,
        PROVIDER_COMMISSION_RUB,
      );

      let declined_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "pay");
        assert.strictEqual(n.status, "declined");
      });

      await delay(2_000);
      await ctx.admin_change_status("payin_request", feed.id, 2);
      await declined_notification;

      await ctx.healthcheck(response.token, {
        expect: {
          status: 2,
          target_amount: AMOUNT_RUB,
          commission_amount: 0,
          commission_provider_amount: 0,
        },
      });
    }));

  test.concurrent("declined -> accepted", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let merchant = await setup(ctx);

      let declined_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "pay");
        assert.strictEqual(n.status, "declined");
      });
      let response = await merchant.create_payment(
        default_provider.request("RUB", AMOUNT, "pay", false),
      );
      assert.strictEqual(response.payment.status, "declined");
      await declined_notification;

      let feed = await ctx.get_feed(response.token);

      let approved_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "pay");
        assert.strictEqual(n.status, "approved");
      });

      await delay(2_000);
      await ctx.admin_change_status("payin_request", feed.id, 1);
      await approved_notification;

      await ctx.healthcheck(response.token, {
        expect: {
          status: 1,
          target_amount: AMOUNT_RUB,
          commission_amount: COMMISSION_RUB,
          commission_provider_amount: PROVIDER_COMMISSION_RUB,
        },
      });
    }));

  test.concurrent("accepted -> declined: no change — merchant balance is zero", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, response, feed } = await setupApproved(ctx);

      // Drain all funds credited by the payin
      await merchant.cashout("RUB", NET_RUB);

      assert.strictEqual(
        feed.status,
        1,
        "feed: accepted before reversal attempt",
      );

      await delay(2_000);
      await ctx.admin_change_status("payin_request", feed.id, 2);

      await ctx.healthcheck(response.token, { expect: { status: 1 } });
    }));

  test.concurrent("accepted -> declined: no change — merchant balance missing commission amount", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, response, feed } = await setupApproved(ctx);

      // Cashout exactly COMMISSION_RUB, leaving NET_RUB - COMMISSION_RUB.
      // Reversal needs NET_RUB, so it will be short by COMMISSION_RUB.
      await merchant.cashout("RUB", COMMISSION_RUB);

      assert.strictEqual(
        feed.status,
        1,
        "feed: accepted before reversal attempt",
      );

      await delay(2_000);
      await ctx.admin_change_status("payin_request", feed.id, 2);

      await ctx.healthcheck(response.token, { expect: { status: 1 } });
    }));

  test.concurrent("accepted -> pending", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { response, feed } = await setupApproved(ctx);

      await delay(2_000);
      await ctx.admin_change_status("payin_request", feed.id, 0);

      await ctx.healthcheck(response.token, {
        expect: {
          status: 0,
          target_amount: AMOUNT_RUB,
          commission_amount: COMMISSION_RUB,
          commission_provider_amount: PROVIDER_COMMISSION_RUB,
        },
      });
    }));

  test.concurrent("declined -> pending", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let merchant = await setup(ctx);

      let declined_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "pay");
        assert.strictEqual(n.status, "declined");
      });
      let response = await merchant.create_payment(
        default_provider.request("RUB", AMOUNT, "pay", false),
      );
      assert.strictEqual(response.payment.status, "declined");
      await declined_notification;

      let feed = await ctx.get_feed(response.token);

      await delay(2_000);
      await ctx.admin_change_status("payin_request", feed.id, 0);

      await ctx.healthcheck(response.token, {
        expect: {
          status: 0,
          target_amount: AMOUNT_RUB,
          commission_amount: COMMISSION_RUB,
          commission_provider_amount: PROVIDER_COMMISSION_RUB,
        },
      });
    }));
});

describe.skip("admin payout state changes", () => {
  function payoutRequest(success: boolean) {
    return {
      ...default_provider.request("RUB", AMOUNT, "payout", success),
      order_number: crypto.randomUUID(),
    };
  }

  async function setup(ctx: Context): Promise<ExtendedMerchant> {
    let merchant = await ctx.create_random_merchant();
    await merchant.set_commission({ operation: "PayoutRequest" });
    await merchant.cashin("RUB", MERCHANT_CASHIN_RUB);
    await merchant.set_settings(default_provider.fullSettings("RUB"));
    return merchant;
  }

  // Creates a declined payout and waits for its notification.
  // After this call the merchant has MERCHANT_CASHIN_RUB available again (hold released).
  async function setupDeclined(ctx: Context) {
    let merchant = await setup(ctx);
    let declined_notification = merchant.queue_notification((n) => {
      assert.strictEqual(n.type, "payout");
      assert.strictEqual(n.status, "declined");
    });
    let response = await merchant.create_payout(payoutRequest(false));
    assert.strictEqual(response.payout?.status, "declined");
    await declined_notification;
    let feed = await ctx.get_feed(response.token);
    return { merchant, response, feed };
  }

  test.concurrent("accepted -> declined", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let merchant = await setup(ctx);

      let approved_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "payout");
        assert.strictEqual(n.status, "approved");
      });
      let response = await merchant.create_payout(payoutRequest(true));
      assert.strictEqual(response.payout?.status, "approved");
      await approved_notification;

      let feed = await ctx.get_feed(response.token);
      assert.strictEqual(feed.status, 1, "feed: accepted");
      assert.strictEqual(feed.commission_amount, COMMISSION_RUB);
      assert.strictEqual(
        feed.commission_provider_amount,
        PROVIDER_COMMISSION_RUB,
      );

      let declined_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "payout");
        assert.strictEqual(n.status, "declined");
      });

      await delay(2_000);
      await ctx.admin_change_status("payout_request", feed.id, 2);
      await declined_notification;

      await ctx.healthcheck(response.token, {
        expect: {
          status: 2,
          target_amount: AMOUNT_RUB,
          commission_amount: 0,
          commission_provider_amount: 0,
        },
      });
    }));

  test.concurrent("declined -> accepted", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let merchant = await setup(ctx);

      let declined_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "payout");
        assert.strictEqual(n.status, "declined");
      });
      let response = await merchant.create_payout(payoutRequest(false));
      assert.strictEqual(response.payout?.status, "declined");
      await declined_notification;

      let feed = await ctx.get_feed(response.token);

      let approved_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "payout");
        assert.strictEqual(n.status, "approved");
      });

      await delay(2_000);
      await ctx.admin_change_status("payout_request", feed.id, 1);
      await approved_notification;

      await ctx.healthcheck(response.token, {
        expect: {
          status: 1,
          target_amount: AMOUNT_RUB,
          commission_amount: COMMISSION_RUB,
          commission_provider_amount: PROVIDER_COMMISSION_RUB,
        },
      });
    }));

  test.concurrent("declined -> accepted: no change — merchant balance is zero", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, response, feed } = await setupDeclined(ctx);

      // Drain all released funds — merchant now has zero balance
      await merchant.cashout("RUB", MERCHANT_CASHIN_RUB);

      assert.strictEqual(
        feed.status,
        2,
        "feed: declined before acceptance attempt",
      );

      await delay(2_000);
      await ctx.admin_change_status("payout_request", feed.id, 1);

      await ctx.healthcheck(response.token, { expect: { status: 2 } });
    }));

  test.concurrent("declined -> accepted: no change — merchant balance missing commission amount", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, response, feed } = await setupDeclined(ctx);

      // Cashout COMMISSION_RUB, leaving AMOUNT_RUB.
      // Acceptance needs AMOUNT_RUB + COMMISSION_RUB, so it will be short by COMMISSION_RUB.
      await merchant.cashout("RUB", COMMISSION_RUB);

      assert.strictEqual(
        feed.status,
        2,
        "feed: declined before acceptance attempt",
      );

      await delay(2_000);
      await ctx.admin_change_status("payout_request", feed.id, 1);

      await ctx.healthcheck(response.token, { expect: { status: 2 } });
    }));

  test.concurrent("accepted -> pending", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let merchant = await setup(ctx);

      let approved_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "payout");
        assert.strictEqual(n.status, "approved");
      });
      let response = await merchant.create_payout(payoutRequest(true));
      assert.strictEqual(response.payout?.status, "approved");
      await approved_notification;

      let feed = await ctx.get_feed(response.token);

      await delay(2_000);
      await ctx.admin_change_status("payout_request", feed.id, 0);

      await ctx.healthcheck(response.token, {
        expect: {
          status: 0,
          target_amount: AMOUNT_RUB,
          commission_amount: 0,
          commission_provider_amount: 0,
        },
      });
    }));

  test.concurrent("declined -> pending", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { response, feed } = await setupDeclined(ctx);

      await delay(2_000);
      await ctx.admin_change_status("payout_request", feed.id, 0);

      await ctx.healthcheck(response.token, {
        expect: {
          status: 0,
          target_amount: AMOUNT_RUB,
          commission_amount: 0,
          commission_provider_amount: 0,
        },
      });
    }));
});

const TRADER_OPTS: CreateTraderOptions = { usdt: false, payout_hold_period: 0 };
const TRADER_DELAY = 5_000;

describe.skip("admin trader payin state changes", () => {
  async function setup(ctx: Context) {
    let merchant = await ctx.create_random_merchant();
    let trader = await ctx.create_random_trader(TRADER_OPTS);
    await trader.setup({ card: true, bank: "sberbank" });
    await trader.cashin("main", "RUB", AMOUNT_RUB);
    await merchant.set_commission({
      operation: "PayinRequest",
      currency: "RUB",
    });
    await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));
    return { merchant, trader };
  }

  async function setupApproved(ctx: Context) {
    let { merchant, trader } = await setup(ctx);
    let res = await merchant
      .create_payment({
        ...common.traderPaymentRequest("RUB", "card"),
        amount: AMOUNT,
      })
      .then((r) => r.followFirstProcessingUrl())
      .then((r) => r.as_trader_requisites());
    await delay(TRADER_DELAY);
    let feed = await ctx.get_feed(res.token);
    let approved_notification = merchant.queue_notification((n) => {
      assert.strictEqual(n.type, "pay");
      assert.strictEqual(n.status, "approved");
    });
    await delay(2_000);
    await ctx.admin_change_status("payin_request", feed.id, 1);
    await approved_notification;
    let approved_feed = await ctx.get_feed(res.token);
    return { merchant, trader, res, feed: approved_feed };
  }

  test.concurrent("accepted -> declined", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, res, feed } = await setupApproved(ctx);

      assert.strictEqual(feed.status, 1, "feed: accepted");
      assert.strictEqual(feed.commission_amount, COMMISSION_RUB);
      assert.strictEqual(
        feed.commission_provider_amount,
        PROVIDER_COMMISSION_RUB,
      );

      let declined_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "pay");
        assert.strictEqual(n.status, "declined");
      });

      await delay(2_000);
      await ctx.admin_change_status("payin_request", feed.id, 2);
      await declined_notification;

      await ctx.healthcheck(res.token, {
        expect: {
          status: 2,
          target_amount: AMOUNT_RUB,
          commission_amount: 0,
          commission_provider_amount: 0,
        },
      });
    }));

  test.concurrent("declined -> accepted", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant } = await setup(ctx);

      let res = await merchant
        .create_payment({
          ...common.traderPaymentRequest("RUB", "card"),
          amount: AMOUNT,
        })
        .then((r) => r.followFirstProcessingUrl())
        .then((r) => r.as_trader_requisites());
      await delay(TRADER_DELAY);
      let feed = await ctx.get_feed(res.token);

      let declined_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "pay");
        assert.strictEqual(n.status, "declined");
      });
      await delay(2_000);
      await ctx.admin_change_status("payin_request", feed.id, 2);
      await declined_notification;

      let approved_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "pay");
        assert.strictEqual(n.status, "approved");
      });

      await delay(2_000);
      await ctx.admin_change_status("payin_request", feed.id, 1);
      await approved_notification;

      await ctx.healthcheck(res.token, {
        expect: {
          status: 1,
          target_amount: AMOUNT_RUB,
          commission_amount: COMMISSION_RUB,
          commission_provider_amount: PROVIDER_COMMISSION_RUB,
        },
      });
    }));

  test.concurrent("accepted -> declined: no change — merchant balance is zero", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, res, feed } = await setupApproved(ctx);
      await merchant.cashout("RUB", NET_RUB);

      await delay(2_000);
      await ctx.admin_change_status("payin_request", feed.id, 2);
      await ctx.healthcheck(res.token, { expect: { status: 1 } });
    }));

  test.concurrent("accepted -> declined: no change — merchant balance missing commission amount", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, res, feed } = await setupApproved(ctx);
      await merchant.cashout("RUB", COMMISSION_RUB);

      await delay(2_000);
      await ctx.admin_change_status("payin_request", feed.id, 2);
      await ctx.healthcheck(res.token, { expect: { status: 1 } });
    }));

  test.concurrent("accepted -> pending", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { res, feed } = await setupApproved(ctx);

      await delay(2_000);
      await ctx.admin_change_status("payin_request", feed.id, 0);

      await ctx.healthcheck(res.token, {
        expect: {
          status: 0,
          target_amount: AMOUNT_RUB,
          commission_amount: 0,
          commission_provider_amount: 0,
        },
      });
    }));

  test.concurrent("declined -> pending", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant } = await setup(ctx);

      let res = await merchant
        .create_payment({
          ...common.traderPaymentRequest("RUB", "card"),
          amount: AMOUNT,
        })
        .then((r) => r.followFirstProcessingUrl())
        .then((r) => r.as_trader_requisites());
      await delay(TRADER_DELAY);
      let feed = await ctx.get_feed(res.token);

      let declined_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "pay");
        assert.strictEqual(n.status, "declined");
      });
      await delay(2_000);
      await ctx.admin_change_status("payin_request", feed.id, 2);
      await declined_notification;

      await delay(2_000);
      await ctx.admin_change_status("payin_request", feed.id, 0);

      await ctx.healthcheck(res.token, {
        expect: {
          status: 0,
          target_amount: AMOUNT_RUB,
          commission_amount: 0,
          commission_provider_amount: 0,
        },
      });
    }));
});

describe.skip("admin trader payout state changes", () => {
  function payoutRequest() {
    return {
      ...common.payoutRequest("RUB"),
      amount: AMOUNT,
      bank_account: { requisite_type: "card" as const },
      customer: {
        email: common.email,
        ip: common.ip,
        first_name: "test",
        last_name: "test",
      },
      card: { pan: common.visaCard },
    };
  }

  async function setup(ctx: Context) {
    let merchant = await ctx.create_random_merchant();
    let trader = await ctx.create_random_trader(TRADER_OPTS);
    await trader.setup({ card: true, bank: "sberbank" });
    await merchant.cashin("RUB", MERCHANT_CASHIN_RUB);
    await merchant.set_commission({
      operation: "PayoutRequest",
      currency: "RUB",
    });
    await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));
    return { merchant, trader };
  }

  async function setupAccepted(ctx: Context) {
    let { merchant, trader } = await setup(ctx);
    let payout = await merchant
      .create_payout(payoutRequest())
      .then((r) => r.followFirstProcessingUrl())
      .then((r) => r.as_payout_response());
    let feed = await ctx.get_feed(payout.token);
    let approved_notification = merchant.queue_notification((n) => {
      assert.strictEqual(n.type, "payout");
      assert.strictEqual(n.status, "approved");
    });
    await delay(2_000);
    await ctx.admin_change_status("payout_request", feed.id, 1);
    await approved_notification;
    let approved_feed = await ctx.get_feed(payout.token);
    return { merchant, trader, payout, feed: approved_feed };
  }

  async function setupDeclined(ctx: Context) {
    let { merchant, trader } = await setup(ctx);
    let payout = await merchant
      .create_payout(payoutRequest())
      .then((r) => r.followFirstProcessingUrl())
      .then((r) => r.as_payout_response());
    let feed = await ctx.get_feed(payout.token);
    let declined_notification = merchant.queue_notification((n) => {
      assert.strictEqual(n.type, "payout");
      assert.strictEqual(n.status, "declined");
    });
    await delay(2_000);
    await ctx.admin_change_status("payout_request", feed.id, 2);
    await declined_notification;
    let declined_feed = await ctx.get_feed(payout.token);
    return { merchant, trader, payout, feed: declined_feed };
  }

  test.concurrent("accepted -> declined", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, payout, feed } = await setupAccepted(ctx);

      assert.strictEqual(feed.status, 1, "feed: accepted");
      assert.strictEqual(feed.commission_amount, COMMISSION_RUB);
      assert.strictEqual(
        feed.commission_provider_amount,
        PROVIDER_COMMISSION_RUB,
      );

      let declined_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "payout");
        assert.strictEqual(n.status, "declined");
      });

      await delay(2_000);
      await ctx.admin_change_status("payout_request", feed.id, 2);
      await declined_notification;

      await ctx.healthcheck(payout.token, {
        expect: {
          status: 2,
          target_amount: AMOUNT_RUB,
          commission_amount: 0,
          commission_provider_amount: 0,
        },
      });
    }));

  test.concurrent("declined -> accepted", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, payout, feed } = await setupDeclined(ctx);

      await delay(2_000);
      let approved_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "payout");
        assert.strictEqual(n.status, "approved");
      });

      await ctx.admin_change_status("payout_request", feed.id, 1);
      await approved_notification;

      await ctx.healthcheck(payout.token, {
        expect: {
          status: 1,
          target_amount: AMOUNT_RUB,
          commission_amount: COMMISSION_RUB,
          commission_provider_amount: PROVIDER_COMMISSION_RUB,
        },
      });
    }));

  test.concurrent("declined -> accepted: no change — merchant balance is zero", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, payout, feed } = await setupDeclined(ctx);
      await merchant.cashout("RUB", MERCHANT_CASHIN_RUB);

      await delay(2_000);
      await ctx.admin_change_status("payout_request", feed.id, 1);
      await ctx.healthcheck(payout.token, { expect: { status: 2 } });
    }));

  test.concurrent("declined -> accepted: no change — merchant balance missing commission amount", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, payout, feed } = await setupDeclined(ctx);
      await merchant.cashout("RUB", COMMISSION_RUB);

      await delay(2_000);
      await ctx.admin_change_status("payout_request", feed.id, 1);
      await ctx.healthcheck(payout.token, { expect: { status: 2 } });
    }));

  test.concurrent("accepted -> pending", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { payout, feed } = await setupAccepted(ctx);

      await delay(2_000);
      await ctx.admin_change_status("payout_request", feed.id, 0);

      await ctx.healthcheck(payout.token, {
        expect: {
          status: 0,
          target_amount: AMOUNT_RUB,
          commission_amount: 0,
          commission_provider_amount: 0,
        },
      });
    }));

  test.concurrent("declined -> pending", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { payout, feed } = await setupDeclined(ctx);

      await delay(2_000);
      await ctx.admin_change_status("payout_request", feed.id, 0);

      await ctx.healthcheck(payout.token, {
        expect: {
          status: 0,
          target_amount: AMOUNT_RUB,
          commission_amount: 0,
          commission_provider_amount: 0,
        },
      });
    }));
});

describe.skip("admin dispute state changes", () => {
  // Creates a trader-backed declined payin and opens a dispute against it.
  // Disputes require a trader so that DisputeRequestBuilder can populate trader_id.
  async function setupDispute(ctx: Context) {
    let merchant = await ctx.create_random_merchant();
    let trader = await ctx.create_random_trader(TRADER_OPTS);
    await trader.setup({ card: true, bank: "sberbank" });
    await trader.cashin("main", "RUB", AMOUNT_RUB);
    await merchant.set_commission({
      operation: "DisputeRequest",
      currency: "RUB",
    });
    await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

    let res = await merchant
      .create_payment({
        ...common.traderPaymentRequest("RUB", "card"),
        amount: AMOUNT,
      })
      .then((r) => r.followFirstProcessingUrl())
      .then((r) => r.as_trader_requisites());
    await delay(TRADER_DELAY);
    let payin_feed = await ctx.get_feed(res.token);
    let declined_notification = merchant.queue_notification((n) => {
      assert.strictEqual(n.type, "pay");
      assert.strictEqual(n.status, "declined");
    });
    await delay(2_000);
    await ctx.admin_change_status("payin_request", payin_feed.id, 2);
    await declined_notification;

    await merchant.create_dispute({
      token: res.token,
      description: "test",
      file_path: assets.PngImgPath,
    });

    let [dispute] = await ctx.get_disputes(res.token);
    assert.isNotNull(dispute.api_payment_token, "dispute api payment token");
    let payment_token = dispute.api_payment_token;
    return { merchant, trader, dispute, payment_token };
  }

  // Accepts the dispute via admin and returns the updated dispute feed.
  async function setupAcceptedDispute(ctx: Context) {
    let { merchant, dispute, payment_token } = await setupDispute(ctx);
    let accepted_notification = merchant.queue_notification((n) => {
      assert.strictEqual(n.type, "dispute");
      assert.strictEqual(n.status, "approved");
    });
    await delay(2_000);
    await ctx.admin_change_status("dispute_request", dispute.id, 1);
    await accepted_notification;
    return { merchant, dispute, payment_token };
  }

  test.concurrent("pending -> accepted", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, dispute, payment_token } = await setupDispute(ctx);

      let approved_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "dispute");
        assert.strictEqual(n.status, "approved");
      });

      await delay(2_000);
      await ctx.admin_change_status("dispute_request", dispute.id, 1);
      await approved_notification;

      await ctx.healthcheck(payment_token, {
        expect: {
          status: 1,
          target_amount: AMOUNT_RUB,
          commission_amount: COMMISSION_RUB,
          commission_provider_amount: PROVIDER_COMMISSION_RUB,
        },
      });
    }));

  test.concurrent("pending -> declined", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, dispute, payment_token } = await setupDispute(ctx);

      let declined_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "dispute");
        assert.strictEqual(n.status, "declined");
      });

      await delay(2_000);
      await ctx.admin_change_status("dispute_request", dispute.id, 2);
      await declined_notification;

      await ctx.healthcheck(payment_token, {
        expect: {
          status: 2,
          target_amount: AMOUNT_RUB,
          commission_amount: 0,
          commission_provider_amount: 0,
        },
      });
    }));

  test.concurrent("accepted -> declined", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, dispute, payment_token } =
        await setupAcceptedDispute(ctx);

      let declined_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "dispute");
        assert.strictEqual(n.status, "declined");
      });

      await delay(2_000);
      await ctx.admin_change_status("dispute_request", dispute.id, 2);
      await declined_notification;

      await ctx.healthcheck(payment_token, {
        expect: {
          status: 2,
          target_amount: AMOUNT_RUB,
          commission_amount: 0,
          commission_provider_amount: 0,
        },
      });
    }));

  test.concurrent("declined -> accepted", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, dispute, payment_token } = await setupDispute(ctx);

      let declined_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "dispute");
        assert.strictEqual(n.status, "declined");
      });
      await delay(2_000);
      await ctx.admin_change_status("dispute_request", dispute.id, 2);
      await declined_notification;

      let approved_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "dispute");
        assert.strictEqual(n.status, "approved");
      });

      await delay(2_000);
      await ctx.admin_change_status("dispute_request", dispute.id, 1);
      await approved_notification;

      await ctx.healthcheck(payment_token, {
        expect: {
          status: 1,
          target_amount: AMOUNT_RUB,
          commission_amount: COMMISSION_RUB,
          commission_provider_amount: PROVIDER_COMMISSION_RUB,
        },
      });
    }));

  test.concurrent("accepted -> declined: no change — merchant balance is zero", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, dispute, payment_token } =
        await setupAcceptedDispute(ctx);
      await merchant.cashout("RUB", NET_RUB);

      await delay(2_000);
      await ctx.admin_change_status("dispute_request", dispute.id, 2);
      await ctx.healthcheck(payment_token, {
        expect: { status: 1 },
      });
    }));

  test.concurrent("accepted -> declined: no change — merchant balance missing commission amount", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, dispute, payment_token } =
        await setupAcceptedDispute(ctx);
      await merchant.cashout("RUB", COMMISSION_RUB);

      await delay(2_000);
      await ctx.admin_change_status("dispute_request", dispute.id, 2);
      await ctx.healthcheck(payment_token, {
        expect: { status: 1 },
      });
    }));

  test.concurrent("accepted -> pending", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { dispute, payment_token } = await setupAcceptedDispute(ctx);

      await delay(2_000);
      await ctx.admin_change_status("dispute_request", dispute.id, 0);

      await ctx.healthcheck(payment_token, {
        expect: {
          status: 0,
          target_amount: AMOUNT_RUB,
          commission_amount: 0,
          commission_provider_amount: 0,
        },
      });
    }));

  test.concurrent("declined -> pending", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { merchant, dispute, payment_token } = await setupDispute(ctx);

      let declined_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "dispute");
        assert.strictEqual(n.status, "declined");
      });
      await delay(2_000);
      await ctx.admin_change_status("dispute_request", dispute.id, 2);
      await declined_notification;

      await delay(2_000);
      await ctx.admin_change_status("dispute_request", dispute.id, 0);

      await ctx.healthcheck(payment_token, {
        expect: {
          status: 0,
          target_amount: AMOUNT_RUB,
          commission_amount: 0,
          commission_provider_amount: 0,
        },
      });
    }));
});
