import * as common from "@/common";
import { CONFIG } from "@/config";
import type { CreateTraderOptions } from "@/driver/core";
import { traderNoConvertSettings, traderSetttings } from "@/driver/trader";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { Context } from "@/test_context/context";
import { test } from "@/test_context";
import { delay } from "@std/async";
import { assert } from "vitest";
import { describe } from "vitest";

let opts: CreateTraderOptions = { usdt: false, payout_hold_period: 0 };

const TRADER_DELAY = 5_000;

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent(`trader core manage payin change status`, () => {
    const AMOUNT = 10_000; // 100 RUB in kopeyki
    const AMOUNT_RUB = AMOUNT / 100; // 100 RUB
    const SELF_RATE = 0.1; // 10%
    const PROVIDER_RATE = 0.05; // 5%
    const COMMISSION_RUB = AMOUNT_RUB * SELF_RATE; // 10 RUB taken from merchant
    const TRADER_PROFIT_RUB = AMOUNT_RUB * PROVIDER_RATE; // 5 RUB earned by trader
    const MERCHANT_NET_RUB = AMOUNT_RUB - COMMISSION_RUB; // 90 RUB credited to merchant

    async function merchantWallet(merchant: ExtendedMerchant) {
      let ws = await merchant.wallets("RUB");
      let w = ws.find((w) => w.currency === "RUB");
      return { available: w?.available ?? 0, held: w?.held ?? 0 };
    }

    async function setup(ctx: Context, merchant: ExtendedMerchant) {
      let trader = await ctx.create_random_trader(opts);
      await trader.setup({ card: true, bank: "sberbank" });
      await trader.cashin("main", "RUB", AMOUNT_RUB);
      await merchant.set_commission({
        operation: "PayinRequest",
        self_rate: "10",
        provider_rate: "5",
        currency: "RUB",
        comment: "trader with commission",
      });
      await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));
      return trader;
    }

    test.concurrent("payin approved -> declined", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await setup(ctx, merchant);

        let approved_cb = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "pay");
          assert.strictEqual(n.status, "approved");
        });
        let res = await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: AMOUNT,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        await delay(TRADER_DELAY);
        await trader.finalizeTransaction(res.token, "approved");
        await approved_cb;

        // after approval: trader paid out, merchant received net amount
        let trader_wallets = await trader.wallets();
        assert.strictEqual(trader_wallets.main.available, 0, "trader main: fully paid out");
        assert.strictEqual(trader_wallets.main.held, 0, "trader main: nothing held");
        assert.strictEqual(
          trader_wallets.profit.available,
          TRADER_PROFIT_RUB,
          "trader profit: earned provider commission",
        );
        assert.strictEqual(trader_wallets.profit.held, 0, "trader profit: nothing held");
        assert.deepEqual(
          await merchantWallet(merchant),
          { available: MERCHANT_NET_RUB, held: 0 },
          "merchant: received net amount after commission",
        );

        let core = ctx.shared_state().core_harness;
        let feed = await ctx.get_feed(res.token);
        assert.strictEqual(feed.status, 1, "feed should be approved");

        let declined_callback = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "pay");
          assert.strictEqual(n.status, "declined");
        });

        await delay(2_000);
        await core.change_status(feed.id, "declined");
        await declined_callback;

        // after reversal: merchant funds clawed back, trader refunded
        trader_wallets = await trader.wallets();
        assert.strictEqual(
          trader_wallets.main.available,
          AMOUNT_RUB,
          "trader main: refunded after reversal",
        );
        assert.strictEqual(trader_wallets.main.held, 0, "trader main: nothing held");
        assert.strictEqual(
          trader_wallets.profit.available,
          0,
          "trader profit: commission reversed",
        );
        assert.strictEqual(trader_wallets.profit.held, 0, "trader profit: nothing held");
        assert.deepEqual(
          await merchantWallet(merchant),
          { available: 0, held: 0 },
          "merchant: funds reversed after decline",
        );

        let updated_feed = await ctx.get_feed(res.token);
        assert.strictEqual(updated_feed.status, 2, "feed should be changed to declined");
        await ctx.healthcheck(res.token);
      }));

    test.concurrent("payin declined -> approved", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await setup(ctx, merchant);

        let decline_cb = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "pay");
          assert.strictEqual(n.status, "declined");
        });
        let res = await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: AMOUNT,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        await delay(TRADER_DELAY);
        await trader.finalizeTransaction(res.token, "declined");
        await decline_cb;

        // after decline: trader keeps their funds, merchant receives nothing
        let trader_wallets = await trader.wallets();
        assert.strictEqual(
          trader_wallets.main.available,
          AMOUNT_RUB,
          "trader main: returned after decline",
        );
        assert.strictEqual(trader_wallets.main.held, 0, "trader main: nothing held");
        assert.strictEqual(
          trader_wallets.profit.available,
          0,
          "trader profit: empty after decline",
        );
        assert.strictEqual(trader_wallets.profit.held, 0, "trader profit: nothing held");
        assert.deepEqual(
          await merchantWallet(merchant),
          { available: 0, held: 0 },
          "merchant: nothing received after decline",
        );

        let core = ctx.shared_state().core_harness;
        let feed = await ctx.get_feed(res.token);
        assert.strictEqual(feed.status, 2, "feed should be declined");

        let approved_callback = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "pay");
          assert.strictEqual(n.status, "approved");
        });

        await delay(2_000);
        await core.change_status(feed.id, "approved");
        await approved_callback;

        // after manual approval: trader pays out, merchant receives net amount
        trader_wallets = await trader.wallets();
        assert.strictEqual(
          trader_wallets.main.available,
          0,
          "trader main: paid out after manual approval",
        );
        assert.strictEqual(trader_wallets.main.held, 0, "trader main: nothing held");
        assert.strictEqual(
          trader_wallets.profit.available,
          TRADER_PROFIT_RUB,
          "trader profit: earned commission after approval",
        );
        assert.strictEqual(trader_wallets.profit.held, 0, "trader profit: nothing held");
        assert.deepEqual(
          await merchantWallet(merchant),
          { available: MERCHANT_NET_RUB, held: 0 },
          "merchant: received net amount after manual approval",
        );

        let updated_feed = await ctx.get_feed(res.token);
        assert.strictEqual(updated_feed.status, 1, "feed should be changed to approved");
        await ctx.healthcheck(res.token);
      }));

    test.concurrent("payin pending -> approved", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await setup(ctx, merchant);

        let res = await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: AMOUNT,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        await delay(TRADER_DELAY);

        // in pending state: trader funds locked, merchant has nothing yet
        let trader_wallets = await trader.wallets();
        assert.strictEqual(trader_wallets.main.available, 0, "trader main: locked while pending");
        assert.strictEqual(
          trader_wallets.main.held,
          AMOUNT_RUB,
          "trader main: held for pending payment",
        );
        assert.strictEqual(
          trader_wallets.profit.available,
          0,
          "trader profit: empty while pending",
        );
        assert.strictEqual(trader_wallets.profit.held, 0, "trader profit: nothing held");
        assert.deepEqual(
          await merchantWallet(merchant),
          { available: 0, held: 0 },
          "merchant: nothing while pending",
        );

        let core = ctx.shared_state().core_harness;
        let feed = await ctx.get_feed(res.token);
        assert.strictEqual(feed.status, 0, "feed should be pending");

        let approved_callback = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "pay");
          assert.strictEqual(n.status, "approved");
        });

        await core.change_status(feed.id, "approved");
        await approved_callback;

        // after manual approval: trader pays out, merchant receives net amount
        trader_wallets = await trader.wallets();
        assert.strictEqual(trader_wallets.main.available, 0, "trader main: paid out");
        assert.strictEqual(trader_wallets.main.held, 0, "trader main: nothing held");
        assert.strictEqual(
          trader_wallets.profit.available,
          TRADER_PROFIT_RUB,
          "trader profit: earned commission",
        );
        assert.strictEqual(trader_wallets.profit.held, 0, "trader profit: nothing held");
        assert.deepEqual(
          await merchantWallet(merchant),
          { available: MERCHANT_NET_RUB, held: 0 },
          "merchant: received net amount",
        );

        let updated_feed = await ctx.get_feed(res.token);
        assert.strictEqual(updated_feed.status, 1, "feed should be approved");
        await ctx.healthcheck(res.token);
      }));

    test.concurrent("payin pending -> declined", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await setup(ctx, merchant);

        let res = await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: AMOUNT,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        await delay(TRADER_DELAY);

        // in pending state: trader funds locked, merchant has nothing yet
        let trader_wallets = await trader.wallets();
        assert.strictEqual(trader_wallets.main.available, 0, "trader main: locked while pending");
        assert.strictEqual(
          trader_wallets.main.held,
          AMOUNT_RUB,
          "trader main: held for pending payment",
        );
        assert.strictEqual(
          trader_wallets.profit.available,
          0,
          "trader profit: empty while pending",
        );
        assert.strictEqual(trader_wallets.profit.held, 0, "trader profit: nothing held");
        assert.deepEqual(
          await merchantWallet(merchant),
          { available: 0, held: 0 },
          "merchant: nothing while pending",
        );

        let core = ctx.shared_state().core_harness;
        let feed = await ctx.get_feed(res.token);
        assert.strictEqual(feed.status, 0, "feed should be pending");

        let declined_callback = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "pay");
          assert.strictEqual(n.status, "declined");
        });

        await core.change_status(feed.id, "declined");
        await declined_callback;

        // after manual decline: trader funds returned, merchant gets nothing
        trader_wallets = await trader.wallets();
        assert.strictEqual(
          trader_wallets.main.available,
          AMOUNT_RUB,
          "trader main: returned after decline",
        );
        assert.strictEqual(trader_wallets.main.held, 0, "trader main: nothing held");
        assert.strictEqual(
          trader_wallets.profit.available,
          0,
          "trader profit: empty after decline",
        );
        assert.strictEqual(trader_wallets.profit.held, 0, "trader profit: nothing held");
        assert.deepEqual(
          await merchantWallet(merchant),
          { available: 0, held: 0 },
          "merchant: nothing after decline",
        );

        let updated_feed = await ctx.get_feed(res.token);
        assert.strictEqual(updated_feed.status, 2, "feed should be declined");
        await ctx.healthcheck(res.token);
      }));
  });

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent(`trader core manage payout change status`, () => {
    const AMOUNT = 10_000; // 100 RUB in kopeyki
    const AMOUNT_RUB = AMOUNT / 100; // 100 RUB
    const SELF_RATE = 0.1; // 10%
    const PROVIDER_RATE = 0.05; // 5%
    const COMMISSION_RUB = AMOUNT_RUB * SELF_RATE; // 10 RUB taken from merchant
    const TRADER_PROFIT_RUB = AMOUNT_RUB * PROVIDER_RATE; // 5 RUB earned by trader
    const MERCHANT_CASHIN_RUB = AMOUNT_RUB + COMMISSION_RUB; // 110 RUB

    async function merchantWallet(merchant: ExtendedMerchant) {
      let ws = await merchant.wallets("RUB");
      let w = ws.find((w) => w.currency === "RUB");
      return { available: w?.available ?? 0, held: w?.held ?? 0 };
    }

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

    async function setup(ctx: Context, merchant: ExtendedMerchant) {
      let trader = await ctx.create_random_trader(opts);
      await trader.setup({ card: true, bank: "sberbank" });
      await merchant.cashin("RUB", MERCHANT_CASHIN_RUB);
      await merchant.set_commission({
        operation: "PayoutRequest",
        self_rate: "10",
        provider_rate: "5",
        currency: "RUB",
        comment: "trader with commission",
      });
      await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));
      return trader;
    }

    test.concurrent("payout approved -> declined", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await setup(ctx, merchant);

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;

        // in pending state: merchant funds held, trader unaffected
        assert.deepEqual(
          await merchantWallet(merchant),
          { available: 0, held: MERCHANT_CASHIN_RUB },
          "merchant: amount and commission held while pending",
        );
        let trader_wallets = await trader.wallets();
        assert.deepEqual(
          {
            available: trader_wallets.main.available,
            held: trader_wallets.main.held,
          },
          { available: 0, held: 0 },
          "trader main: unaffected while pending",
        );

        let feed = await trader.finalizeTransaction(token, "approved");
        await delay(5_000);

        let core = ctx.shared_state().core_harness;
        let approved_callback = merchant.queue_notification(
          (n) => {
            assert.strictEqual(n.type, "payout");
            assert.strictEqual(n.status, "approved");
          },
          { timeout: 5_000 },
        );

        await core.approve_payout(feed.id);
        await approved_callback;
        let finalized_feed = await ctx.get_feed(token);

        // after approval: merchant charged, trader receives payout funds and commission
        assert.deepEqual(
          await merchantWallet(merchant),
          { available: 0, held: 0 },
          "merchant: fully charged after approval",
        );
        trader_wallets = await trader.wallets();
        assert.deepEqual(
          {
            available: trader_wallets.main.available,
            held: trader_wallets.main.held,
          },
          { available: AMOUNT_RUB, held: 0 },
          "trader main: received payout funds",
        );
        assert.strictEqual(
          trader_wallets.profit.available,
          TRADER_PROFIT_RUB,
          "trader profit: earned provider commission",
        );
        assert.strictEqual(trader_wallets.profit.held, 0, "trader profit: nothing held");

        let approved_feed = await ctx.get_feed(token);
        assert.strictEqual(approved_feed.status, 1, "feed should be approved");

        let declined_callback = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "declined");
        });

        await delay(2_000);
        await core.change_status(finalized_feed.id, "declined");
        await declined_callback;

        // after reversal: merchant refunded, trader funds clawed back
        assert.deepEqual(
          await merchantWallet(merchant),
          { available: MERCHANT_CASHIN_RUB, held: 0 },
          "merchant: fully refunded after reversal",
        );
        trader_wallets = await trader.wallets();
        assert.deepEqual(
          {
            available: trader_wallets.main.available,
            held: trader_wallets.main.held,
          },
          { available: 0, held: 0 },
          "trader main: funds reversed",
        );
        assert.strictEqual(
          trader_wallets.profit.available,
          0,
          "trader profit: commission reversed",
        );

        let updated_feed = await ctx.get_feed(token);
        assert.strictEqual(updated_feed.status, 2, "feed should be changed to declined");
        await ctx.healthcheck(token);
      }));

    test.concurrent("payout declined -> approved", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await setup(ctx, merchant);

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;

        // in pending state: merchant funds held, trader unaffected
        assert.deepEqual(
          await merchantWallet(merchant),
          { available: 0, held: MERCHANT_CASHIN_RUB },
          "merchant: amount and commission held while pending",
        );
        let trader_wallets = await trader.wallets();
        assert.deepEqual(
          {
            available: trader_wallets.main.available,
            held: trader_wallets.main.held,
          },
          { available: 0, held: 0 },
          "trader main: unaffected while pending",
        );

        let declined_callback = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "declined");
        });

        await trader.finalizeTransaction(token, "declined");
        await declined_callback;
        let finalized_feed = await ctx.get_feed(token);

        // after decline: merchant fully refunded, trader unaffected
        assert.deepEqual(
          await merchantWallet(merchant),
          { available: MERCHANT_CASHIN_RUB, held: 0 },
          "merchant: fully refunded after decline",
        );
        trader_wallets = await trader.wallets();
        assert.deepEqual(
          {
            available: trader_wallets.main.available,
            held: trader_wallets.main.held,
          },
          { available: 0, held: 0 },
          "trader main: untouched after decline",
        );
        assert.deepEqual(
          {
            available: trader_wallets.profit.available,
            held: trader_wallets.profit.held,
          },
          { available: 0, held: 0 },
          "trader profit: empty after decline",
        );

        assert.strictEqual(finalized_feed.status, 2, "feed should be declined");

        let core = ctx.shared_state().core_harness;
        let approved_callback = merchant.queue_notification(
          (n) => {
            assert.strictEqual(n.type, "payout");
            assert.strictEqual(n.status, "approved");
          },
          { timeout: 5_000 },
        );

        await delay(2_000);
        await core.change_status(finalized_feed.id, "approved");
        await approved_callback;

        // after manual approval: merchant charged, trader receives payout funds and commission
        assert.deepEqual(
          await merchantWallet(merchant),
          { available: 0, held: 0 },
          "merchant: fully charged after manual approval",
        );
        trader_wallets = await trader.wallets();
        assert.deepEqual(
          {
            available: trader_wallets.main.available,
            held: trader_wallets.main.held,
          },
          { available: AMOUNT_RUB, held: 0 },
          "trader main: received payout funds",
        );
        assert.strictEqual(
          trader_wallets.profit.available,
          TRADER_PROFIT_RUB,
          "trader profit: earned commission after manual approval",
        );
        assert.strictEqual(trader_wallets.profit.held, 0, "trader profit: nothing held");

        let updated_feed = await ctx.get_feed(token);
        assert.strictEqual(updated_feed.status, 1, "feed should be changed to approved");
        await ctx.healthcheck(token);
      }));

    test.concurrent("payout approved -> declined with agent", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({ usdt: true });
        let agent = await ctx.create_random_agent({
          traders_ids: [trader.id],
          merchant_id: merchant.id,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        await merchant.cashin("USDT", MERCHANT_CASHIN_RUB);
        await merchant.set_commission({
          operation: "PayoutRequest",
          self_rate: "10",
          provider_rate: "5",
          currency: "RUB",
          agent_id: agent.id.toString(),
          agent_rate: "2".toString(),
          comment: "trader with commission",
        });
        await merchant.set_settings(traderSetttings([trader.id]));

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;

        await ctx.healthcheck(token, { expect: { status: 0 } });
        let approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "approved");
        });

        let core = ctx.shared_state().core_harness;
        let feed = await trader.finalizeTransaction(token, "approved");

        await ctx.healthcheck(token, { expect: { status: 0 } });

        core.approve_payout(feed.id);
        await approved;
        await ctx.healthcheck(token, { expect: { status: 1 } });
        let finalized_feed = await ctx.get_feed(token);

        let declined = merchant.queue_notification(
          (n) => {
            assert.strictEqual(n.type, "payout");
            assert.strictEqual(n.status, "declined");
          },
          { timeout: 5_000 },
        );

        await delay(2_000);
        await core.change_status(finalized_feed.id, "declined");
        await declined;
        await ctx.healthcheck(token, { expect: { status: 2 } });
      }));
  });

const PAYOUT_AMOUNT = 10_000; // 100 RUB in kopeyki
const PAYOUT_AMOUNT_RUB = PAYOUT_AMOUNT / 100; // 100 RUB
// Over-fund the merchant: the healthcheck validates per-transaction entries, not
// absolute wallet balances, so extra balance is harmless and avoids
// insufficient-funds errors on payout creation.
const MERCHANT_CASHIN = PAYOUT_AMOUNT_RUB * 3;

function payoutRequest() {
  return {
    ...common.payoutRequest("RUB"),
    amount: PAYOUT_AMOUNT,
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

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("payout cancellation without commission", () => {
    test.concurrent("approved -> declined (usdt)", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          payout_hold_period: 0,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        await merchant.cashin("USDT", MERCHANT_CASHIN);
        await merchant.set_commission({
          operation: "PayoutRequest",
          currency: "RUB",
          self_rate: "0",
          provider_rate: "0",
        });
        await merchant.set_settings(traderSetttings([trader.id]));

        let core = ctx.shared_state().core_harness;

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;
        await ctx.healthcheck(token, { expect: { status: 0 } });

        let approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "approved");
        });
        let feed = await trader.finalizeTransaction(token, "approved");
        // receipt uploaded, transaction is on verification (treat as status 0)
        await ctx.healthcheck(token, { expect: { status: 0 } });

        core.approve_payout(feed.id);
        await approved;
        await ctx.healthcheck(token, { expect: { status: 1 } });

        let declined = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "declined");
        });
        await delay(2_000);
        await core.change_status(feed.id, "declined");
        await declined;
        await ctx.healthcheck(token, { expect: { status: 2 } });
      }));

    test.concurrent("approved -> declined (rub)", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: false,
          payout_hold_period: 0,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        await merchant.cashin("RUB", MERCHANT_CASHIN);
        await merchant.set_commission({
          operation: "PayoutRequest",
          currency: "RUB",
          self_rate: "0",
          provider_rate: "0",
        });
        await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

        let core = ctx.shared_state().core_harness;

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;
        await ctx.healthcheck(token, { expect: { status: 0 } });

        let approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "approved");
        });
        let feed = await trader.finalizeTransaction(token, "approved");
        // receipt uploaded, transaction is on verification (treat as status 0)
        await ctx.healthcheck(token, { expect: { status: 0 } });

        core.approve_payout(feed.id);
        await approved;
        await ctx.healthcheck(token, { expect: { status: 1 } });

        let declined = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "declined");
        });
        await delay(2_000);
        await core.change_status(feed.id, "declined");
        await declined;
        await ctx.healthcheck(token, { expect: { status: 2 } });
      }));
  });

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("payout cancellation with merchant commission", () => {
    test.concurrent("approved -> declined (usdt)", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          payout_hold_period: 0,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        await merchant.cashin("USDT", MERCHANT_CASHIN);
        await merchant.set_commission({
          operation: "PayoutRequest",
          currency: "RUB",
          self_rate: "10",
          provider_rate: "0",
        });
        await merchant.set_settings(traderSetttings([trader.id]));

        let core = ctx.shared_state().core_harness;

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;
        await ctx.healthcheck(token, { expect: { status: 0 } });

        let approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "approved");
        });
        let feed = await trader.finalizeTransaction(token, "approved");
        // receipt uploaded, transaction is on verification (treat as status 0)
        await ctx.healthcheck(token, { expect: { status: 0 } });

        core.approve_payout(feed.id);
        await approved;
        await ctx.healthcheck(token, { expect: { status: 1 } });

        let declined = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "declined");
        });
        await delay(2_000);
        await core.change_status(feed.id, "declined");
        await declined;
        await ctx.healthcheck(token, { expect: { status: 2 } });
      }));

    test.concurrent("approved -> declined (rub)", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: false,
          payout_hold_period: 0,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        await merchant.cashin("RUB", MERCHANT_CASHIN);
        await merchant.set_commission({
          operation: "PayoutRequest",
          currency: "RUB",
          self_rate: "10",
          provider_rate: "0",
        });
        await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

        let core = ctx.shared_state().core_harness;

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;
        await ctx.healthcheck(token, { expect: { status: 0 } });

        let approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "approved");
        });
        let feed = await trader.finalizeTransaction(token, "approved");
        // receipt uploaded, transaction is on verification (treat as status 0)
        await ctx.healthcheck(token, { expect: { status: 0 } });

        core.approve_payout(feed.id);
        await approved;
        await ctx.healthcheck(token, { expect: { status: 1 } });

        let declined = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "declined");
        });
        await delay(2_000);
        await core.change_status(feed.id, "declined");
        await declined;
        await ctx.healthcheck(token, { expect: { status: 2 } });
      }));
  });

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("payout cancellation with trader + merchant commission", () => {
    test.concurrent("approved -> declined (usdt)", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          payout_hold_period: 0,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        await merchant.cashin("USDT", MERCHANT_CASHIN);
        await merchant.set_commission({
          operation: "PayoutRequest",
          currency: "RUB",
          self_rate: "10",
          provider_rate: "5",
        });
        await merchant.set_settings(traderSetttings([trader.id]));

        let core = ctx.shared_state().core_harness;

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;
        await ctx.healthcheck(token, { expect: { status: 0 } });

        let approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "approved");
        });
        let feed = await trader.finalizeTransaction(token, "approved");
        // receipt uploaded, transaction is on verification (treat as status 0)
        await ctx.healthcheck(token, { expect: { status: 0 } });

        core.approve_payout(feed.id);
        await approved;
        await ctx.healthcheck(token, { expect: { status: 1 } });

        let declined = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "declined");
        });
        await delay(2_000);
        await core.change_status(feed.id, "declined");
        await declined;
        await ctx.healthcheck(token, { expect: { status: 2 } });
      }));

    test.concurrent("approved -> declined (rub)", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: false,
          payout_hold_period: 0,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        await merchant.cashin("RUB", MERCHANT_CASHIN);
        await merchant.set_commission({
          operation: "PayoutRequest",
          currency: "RUB",
          self_rate: "10",
          provider_rate: "5",
        });
        await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

        let core = ctx.shared_state().core_harness;

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;
        await ctx.healthcheck(token, { expect: { status: 0 } });

        let approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "approved");
        });
        let feed = await trader.finalizeTransaction(token, "approved");
        // receipt uploaded, transaction is on verification (treat as status 0)
        await ctx.healthcheck(token, { expect: { status: 0 } });

        core.approve_payout(feed.id);
        await approved;
        await ctx.healthcheck(token, { expect: { status: 1 } });

        let declined = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "declined");
        });
        await delay(2_000);
        await core.change_status(feed.id, "declined");
        await declined;
        await ctx.healthcheck(token, { expect: { status: 2 } });
      }));
  });

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("payout cancellation with trader + merchant + agent commission", () => {
    // Agent commission is supported with USDT settings only.
    test.concurrent("approved -> declined (usdt)", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          payout_hold_period: 0,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        let agent = await ctx.create_random_agent({
          traders_ids: [trader.id],
          merchant_id: merchant.id,
        });
        await merchant.cashin("USDT", MERCHANT_CASHIN);
        await merchant.set_commission({
          operation: "PayoutRequest",
          currency: "RUB",
          self_rate: "10",
          provider_rate: "5",
          agent_id: agent.id.toString(),
          agent_rate: "2",
        });
        await merchant.set_settings(traderSetttings([trader.id]));

        let core = ctx.shared_state().core_harness;

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;
        await ctx.healthcheck(token, { expect: { status: 0 } });

        let approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "approved");
        });
        let feed = await trader.finalizeTransaction(token, "approved");
        // receipt uploaded, transaction is on verification (treat as status 0)
        await ctx.healthcheck(token, { expect: { status: 0 } });

        core.approve_payout(feed.id);
        await approved;
        await ctx.healthcheck(token, { expect: { status: 1 } });

        let declined = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "declined");
        });
        await delay(2_000);
        await core.change_status(feed.id, "declined");
        await declined;
        await ctx.healthcheck(token, { expect: { status: 2 } });
      }));
  });

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("payout cancellation with insufficient trader balance (main)", () => {
    test.concurrent("approved -> declined (usdt)", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          payout_hold_period: 0,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        await merchant.cashin("USDT", MERCHANT_CASHIN);
        await merchant.set_commission({
          operation: "PayoutRequest",
          currency: "RUB",
          self_rate: "10",
          provider_rate: "5",
        });
        await merchant.set_settings(traderSetttings([trader.id]));

        let core = ctx.shared_state().core_harness;

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;
        await ctx.healthcheck(token, { expect: { status: 0 } });

        let approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "approved");
        });
        let feed = await trader.finalizeTransaction(token, "approved");
        // receipt uploaded, transaction is on verification (treat as status 0)
        await ctx.healthcheck(token, { expect: { status: 0 } });

        core.approve_payout(feed.id);
        await approved;
        await ctx.healthcheck(token, { expect: { status: 1 } });

        // drain the trader main wallet so it can not cover the reversal
        let wallets = await trader.wallets();
        await trader.cashout("main", "USDT", wallets.main.available);

        await core.change_status(feed.id, "declined");
        await ctx.healthcheck(token, { expect: { status: 1 } });
      }));

    test.concurrent("approved -> declined (rub)", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: false,
          payout_hold_period: 0,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        await merchant.cashin("RUB", MERCHANT_CASHIN);
        await merchant.set_commission({
          operation: "PayoutRequest",
          currency: "RUB",
          self_rate: "10",
          provider_rate: "5",
        });
        await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

        let core = ctx.shared_state().core_harness;

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;
        await ctx.healthcheck(token, { expect: { status: 0 } });

        let approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "approved");
        });
        let feed = await trader.finalizeTransaction(token, "approved");
        // receipt uploaded, transaction is on verification (treat as status 0)
        await ctx.healthcheck(token, { expect: { status: 0 } });

        core.approve_payout(feed.id);
        await approved;
        await ctx.healthcheck(token, { expect: { status: 1 } });

        // drain the trader main wallet so it can not cover the reversal
        let wallets = await trader.wallets();
        await trader.cashout("main", "RUB", wallets.main.available);

        await delay(2_000);
        await core.change_status(feed.id, "declined");
        await delay(2_000);
        await ctx.healthcheck(token, { expect: { status: 1 } });
      }));
  });

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("payout cancellation with insufficient trader balance (deposit)", () => {
    test.concurrent("approved -> declined (usdt)", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          payout_hold_period: 0,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        // give the trader a deposit balance, it is the reversal fallback
        await trader.cashin("deposit", "USDT", PAYOUT_AMOUNT_RUB);
        await merchant.cashin("USDT", MERCHANT_CASHIN);
        await merchant.set_commission({
          operation: "PayoutRequest",
          currency: "RUB",
          self_rate: "10",
          provider_rate: "5",
        });
        await merchant.set_settings(traderSetttings([trader.id]));

        let core = ctx.shared_state().core_harness;

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;
        await ctx.healthcheck(token, { expect: { status: 0 } });

        let approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "approved");
        });
        let feed = await trader.finalizeTransaction(token, "approved");
        // receipt uploaded, transaction is on verification (treat as status 0)
        await ctx.healthcheck(token, { expect: { status: 0 } });

        core.approve_payout(feed.id);
        await approved;
        await ctx.healthcheck(token, { expect: { status: 1 } });

        // drain main and deposit so neither can cover the reversal
        let wallets = await trader.wallets();
        await trader.cashout("main", "USDT", wallets.main.available);
        await trader.cashout("deposit", "USDT", wallets.deposit.available);

        await delay(2_000);
        await core.change_status(feed.id, "declined");
        await delay(2_000);
        await ctx.healthcheck(token, { expect: { status: 1 } });
      }));

    test.concurrent("approved -> declined (rub)", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: false,
          payout_hold_period: 0,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        // give the trader a deposit balance, it is the reversal fallback
        await trader.cashin("deposit", "RUB", PAYOUT_AMOUNT_RUB);
        await merchant.cashin("RUB", MERCHANT_CASHIN);
        await merchant.set_commission({
          operation: "PayoutRequest",
          currency: "RUB",
          self_rate: "10",
          provider_rate: "5",
        });
        await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

        let core = ctx.shared_state().core_harness;

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;
        await ctx.healthcheck(token, { expect: { status: 0 } });

        let approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "approved");
        });
        let feed = await trader.finalizeTransaction(token, "approved");
        // receipt uploaded, transaction is on verification (treat as status 0)
        await ctx.healthcheck(token, { expect: { status: 0 } });

        core.approve_payout(feed.id);
        await approved;
        await ctx.healthcheck(token, { expect: { status: 1 } });

        // drain main and deposit so neither can cover the reversal
        let wallets = await trader.wallets();
        await trader.cashout("main", "RUB", wallets.main.available);
        await trader.cashout("deposit", "RUB", wallets.deposit.available);

        await delay(2_000);
        await core.change_status(feed.id, "declined");
        await delay(2_000);
        await ctx.healthcheck(token, { expect: { status: 1 } });
      }));
  });

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("payout cancellation with insufficient trader balance (profit)", () => {
    test.concurrent("approved -> declined (usdt)", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          payout_hold_period: 0,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        await merchant.set_commission({
          operation: "PayoutRequest",
          currency: "RUB",
          self_rate: "10",
          provider_rate: "5",
        });
        await merchant.set_settings(traderSetttings([trader.id]));

        let core = ctx.shared_state().core_harness;

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;
        await ctx.healthcheck(token, { expect: { status: 0 } });

        let approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "approved");
        });
        let feed = await trader.finalizeTransaction(token, "approved");
        // receipt uploaded, transaction is on verification (treat as status 0)
        await ctx.healthcheck(token, { expect: { status: 0 } });

        core.approve_payout(feed.id);
        await approved;
        await ctx.healthcheck(token, { expect: { status: 1 } });

        // drain wallets so neither can cover the reversal
        let wallets = await trader.wallets();
        await trader.cashout("main", "USDT", wallets.main.available);
        await trader.cashout("deposit", "USDT", wallets.deposit.available);
        await trader.cashout("income", "USDT", wallets.profit.available);

        await delay(2_000);
        await core.change_status(feed.id, "declined");
        await delay(2_000);
        await ctx.healthcheck(token, { expect: { status: 1 } });
      }));

    test.concurrent("approved -> declined (rub)", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: false,
          payout_hold_period: 0,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        await merchant.cashin("RUB", MERCHANT_CASHIN);
        await merchant.set_commission({
          operation: "PayoutRequest",
          currency: "RUB",
          self_rate: "10",
          provider_rate: "5",
        });
        await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

        let core = ctx.shared_state().core_harness;

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;
        await ctx.healthcheck(token, { expect: { status: 0 } });

        let approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "approved");
        });
        let feed = await trader.finalizeTransaction(token, "approved");
        // receipt uploaded, transaction is on verification (treat as status 0)
        await ctx.healthcheck(token, { expect: { status: 0 } });

        core.approve_payout(feed.id);
        await approved;
        await ctx.healthcheck(token, { expect: { status: 1 } });

        // drain main and deposit so neither can cover the reversal
        let wallets = await trader.wallets();
        await trader.cashout("main", "RUB", wallets.main.available);
        await trader.cashout("deposit", "RUB", wallets.deposit.available);
        await trader.cashout("income", "RUB", wallets.profit.available);

        await delay(2_000);
        await core.change_status(feed.id, "declined");
        await delay(2_000);
        await ctx.healthcheck(token, { expect: { status: 1 } });
      }));
  });

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("payout cancellation with insufficient agent balance", () => {
    // Agent commission is supported with USDT settings only.
    test.concurrent("approved -> declined (usdt)", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          payout_hold_period: 0,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        let agent = await ctx.create_random_agent({
          traders_ids: [trader.id],
          merchant_id: merchant.id,
        });
        await merchant.cashin("USDT", MERCHANT_CASHIN);
        await merchant.set_commission({
          operation: "PayoutRequest",
          currency: "RUB",
          self_rate: "10",
          provider_rate: "5",
          agent_id: agent.id.toString(),
          agent_rate: "2",
        });
        await merchant.set_settings(traderSetttings([trader.id]));

        let core = ctx.shared_state().core_harness;

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;
        await ctx.healthcheck(token, { expect: { status: 0 } });

        let approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "approved");
        });
        let feed = await trader.finalizeTransaction(token, "approved");
        // receipt uploaded, transaction is on verification (treat as status 0)
        await ctx.healthcheck(token, { expect: { status: 0 } });

        core.approve_payout(feed.id);
        await approved;
        await ctx.healthcheck(token, { expect: { status: 1 } });

        // drain the agent wallet so it can not cover the reversal of the
        // agent commission
        let agent_wallets = await ctx.shared_state().core_db.profileWallets(agent.id, "USDT");
        let agent_available = agent_wallets.find((w) => w.currency === "USDT")?.available!;
        await core.cashout(agent.id, "USDT", agent_available);

        await delay(2_000);
        await core.change_status(feed.id, "declined");
        await delay(2_000);
        await ctx.healthcheck(token, { expect: { status: 1 } });
      }));
  });

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("payout cancellation with payout hold period", () => {
    test.concurrent("approved -> declined (usdt)", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          payout_hold_period: 1,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        await merchant.cashin("USDT", MERCHANT_CASHIN);
        await merchant.set_commission({
          operation: "PayoutRequest",
          currency: "RUB",
          self_rate: "10",
          provider_rate: "5",
        });
        await merchant.set_settings(traderSetttings([trader.id]));

        let core = ctx.shared_state().core_harness;

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;
        await ctx.healthcheck(token, { expect: { status: 0 } });

        let approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "approved");
        });
        let feed = await trader.finalizeTransaction(token, "approved");
        // receipt uploaded, transaction is on verification (treat as status 0)
        await ctx.healthcheck(token, { expect: { status: 0 } });

        core.approve_payout(feed.id);
        await approved;
        // approved with an active hold period: payout funds are held
        await ctx.healthcheck(token, { expect: { status: 1 } });

        let declined = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "declined");
        });
        await delay(2_000);
        await core.change_status(feed.id, "declined");
        await declined;
        await ctx.healthcheck(token, { expect: { status: 2 } });
      }));

    test.concurrent("approved -> declined (rub)", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: false,
          payout_hold_period: 1,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        await merchant.cashin("RUB", MERCHANT_CASHIN);
        await merchant.set_commission({
          operation: "PayoutRequest",
          currency: "RUB",
          self_rate: "10",
          provider_rate: "5",
        });
        await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

        let core = ctx.shared_state().core_harness;

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;
        await ctx.healthcheck(token, { expect: { status: 0 } });

        let approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "approved");
        });
        let feed = await trader.finalizeTransaction(token, "approved");
        // receipt uploaded, transaction is on verification (treat as status 0)
        await ctx.healthcheck(token, { expect: { status: 0 } });

        core.approve_payout(feed.id);
        await approved;
        // approved with an active hold period: payout funds are held
        await ctx.healthcheck(token, { expect: { status: 1 } });

        let declined = merchant.queue_notification((n) => {
          assert.strictEqual(n.type, "payout");
          assert.strictEqual(n.status, "declined");
        });
        await delay(2_000);
        await core.change_status(feed.id, "declined");
        await declined;
        await ctx.healthcheck(token, { expect: { status: 2 } });
      }));
  });
