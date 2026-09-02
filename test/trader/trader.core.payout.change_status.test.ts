import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { traderNoConvertSettings, traderSettings } from "@/driver/trader";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { ExtendedTrader } from "@/entities/trader";
import type { HealthcheckOpts } from "@/healthcheck";
import { STATIC_RATE } from "@/provider_mocks/rate";
import { test } from "@/test_context";
import type { Context } from "@/test_context/context";

const PAYOUT_AMOUNT = 10_000; // 100 RUB in kopeyki
const PAYOUT_AMOUNT_MAJOR = PAYOUT_AMOUNT / 100; // 100
const SELF_RATE = 0.1; // 10%
const PROVIDER_RATE = 0.05; // 5%
const COMMISSION = PAYOUT_AMOUNT_MAJOR * SELF_RATE; // 10 taken from the merchant
const TRADER_PROFIT = PAYOUT_AMOUNT_MAJOR * PROVIDER_RATE; // 5 earned by the trader
const MERCHANT_CASHIN = PAYOUT_AMOUNT_MAJOR + COMMISSION; // 110

function payoutRequest(usdt: boolean) {
  return {
    ...common.payoutRequest("RUB"),
    amount: usdt ? PAYOUT_AMOUNT * STATIC_RATE : PAYOUT_AMOUNT,
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

async function merchantWallet(merchant: ExtendedMerchant, currency: string) {
  let ws = await merchant.wallets(currency);
  let w = ws.find((w) => w.currency === currency);
  return { available: w?.available ?? 0, held: w?.held ?? 0 };
}

type PayoutSetupOpts = {
  usdt: boolean;
  payout_hold_period?: number;
  /** Merchant funding, one payout worth (`MERCHANT_CASHIN`) by default. */
  cashin?: number;
  commission?: Partial<Parameters<ExtendedMerchant["set_commission"]>[0]>;
};

async function setup_payout(
  ctx: Context,
  merchant: ExtendedMerchant,
  opts: PayoutSetupOpts,
) {
  let currency = opts.usdt ? "USDT" : "RUB";
  let trader = await ctx.create_random_trader({
    usdt: opts.usdt,
    payout_hold_period: opts.payout_hold_period ?? 0,
  });
  await trader.setup({ card: true, bank: "sberbank" });
  await merchant.cashin(currency, opts.cashin ?? MERCHANT_CASHIN);
  await merchant.set_commission({
    operation: "PayoutRequest",
    currency: "RUB",
    self_rate: "10",
    provider_rate: "5",
    ...opts.commission,
  });
  await merchant.set_settings(
    opts.usdt
      ? traderSettings([trader.id])
      : traderNoConvertSettings("RUB", [trader.id]),
  );
  return trader;
}

type ApprovedPayoutOpts = {
  /** Extra feed expectations merged into every healthcheck of the run. */
  expect?: HealthcheckOpts["expect"];
  /** Skip the healthcheck the approved notification runs on its own. */
  skip_notification_healthcheck?: boolean;
};

/**
 * Runs a payout up to the approved state and returns its feed and token.
 */
async function approved_payout(
  ctx: Context,
  merchant: ExtendedMerchant,
  trader: ExtendedTrader,
  usdt: boolean,
  opts?: ApprovedPayoutOpts,
) {
  let core = ctx.shared_state().core_harness;
  let expect = opts?.expect;

  let payout = await merchant
    .create_payout(payoutRequest(usdt))
    .then((r) => r.followFirstProcessingUrl())
    .then((r) => r.as_payout_response());
  let token = payout.token;
  await ctx.healthcheck(token, { expect: { status: 0, ...expect } });

  let approved = merchant.queue_notification(
    (n) => {
      assert.strictEqual(n.type, "payout");
      assert.strictEqual(n.status, "approved");
    },
    { skip_healthcheck: opts?.skip_notification_healthcheck },
  );
  let feed = await trader.finalizeTransaction(token, "approved");
  // receipt uploaded, transaction is on verification (treat as status 0)
  await ctx.healthcheck(token, { expect: { status: 0, ...expect } });

  core.approve_payout(feed.id);
  await approved;
  await ctx.healthcheck(token, { expect: { status: 1, ...expect } });

  return { feed, token };
}

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent(`trader core manage payout change status`, () => {
    for (let usdt of [true, false]) {
      let variant = usdt ? "usdt" : "rub";
      let currency = usdt ? "USDT" : "RUB";

      test.concurrent(`payout approved -> declined (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await setup_payout(ctx, merchant, { usdt });

          let payout = await merchant
            .create_payout(payoutRequest(usdt))
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_payout_response());
          let token = payout.token;

          // in pending state: merchant funds held, trader unaffected
          assert.deepEqual(
            await merchantWallet(merchant, currency),
            { available: 0, held: MERCHANT_CASHIN },
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
            await merchantWallet(merchant, currency),
            { available: 0, held: 0 },
            "merchant: fully charged after approval",
          );
          trader_wallets = await trader.wallets();
          assert.deepEqual(
            {
              available: trader_wallets.main.available,
              held: trader_wallets.main.held,
            },
            { available: PAYOUT_AMOUNT_MAJOR, held: 0 },
            "trader main: received payout funds",
          );
          assert.strictEqual(
            trader_wallets.income.available,
            TRADER_PROFIT,
            "trader profit: earned provider commission",
          );
          assert.strictEqual(
            trader_wallets.income.held,
            0,
            "trader profit: nothing held",
          );

          let approved_feed = await ctx.get_feed(token);
          assert.strictEqual(
            approved_feed.status,
            1,
            "feed should be approved",
          );

          let declined_callback = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "payout");
            assert.strictEqual(n.status, "declined");
          });

          await delay(2_000);
          await core.change_status(finalized_feed.id, "declined");
          await declined_callback;

          // after reversal: merchant refunded, trader funds clawed back
          assert.deepEqual(
            await merchantWallet(merchant, currency),
            { available: MERCHANT_CASHIN, held: 0 },
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
            trader_wallets.income.available,
            0,
            "trader profit: commission reversed",
          );

          let updated_feed = await ctx.get_feed(token);
          assert.strictEqual(
            updated_feed.status,
            2,
            "feed should be changed to declined",
          );
          await ctx.healthcheck(token);
        }));

      test.skip(`payout declined -> approved (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await setup_payout(ctx, merchant, { usdt });

          let payout = await merchant
            .create_payout(payoutRequest(usdt))
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_payout_response());
          let token = payout.token;

          // in pending state: merchant funds held, trader unaffected
          assert.deepEqual(
            await merchantWallet(merchant, currency),
            { available: 0, held: MERCHANT_CASHIN },
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
            await merchantWallet(merchant, currency),
            { available: MERCHANT_CASHIN, held: 0 },
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
              available: trader_wallets.income.available,
              held: trader_wallets.income.held,
            },
            { available: 0, held: 0 },
            "trader profit: empty after decline",
          );

          assert.strictEqual(
            finalized_feed.status,
            2,
            "feed should be declined",
          );

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
            await merchantWallet(merchant, currency),
            { available: 0, held: 0 },
            "merchant: fully charged after manual approval",
          );
          trader_wallets = await trader.wallets();
          assert.deepEqual(
            {
              available: trader_wallets.main.available,
              held: trader_wallets.main.held,
            },
            { available: PAYOUT_AMOUNT_MAJOR, held: 0 },
            "trader main: received payout funds",
          );
          assert.strictEqual(
            trader_wallets.income.available,
            TRADER_PROFIT,
            "trader profit: earned commission after manual approval",
          );
          assert.strictEqual(
            trader_wallets.income.held,
            0,
            "trader profit: nothing held",
          );

          let updated_feed = await ctx.get_feed(token);
          assert.strictEqual(
            updated_feed.status,
            1,
            "feed should be changed to approved",
          );
          await ctx.healthcheck(token);
        }));
    }

    // Agent commission is supported with USDT settings only.
    test.concurrent("payout approved -> declined with agent (usdt)", ({
      ctx,
      merchant,
    }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({ usdt: true });
        let agent = await ctx.create_random_agent({
          traders_ids: [trader.id],
          merchant_id: merchant.id,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        await merchant.cashin("USDT", MERCHANT_CASHIN);
        await merchant.set_commission({
          operation: "PayoutRequest",
          self_rate: "10",
          provider_rate: "5",
          currency: "RUB",
          agent_id: agent.id.toString(),
          agent_rate: "2".toString(),
          comment: "trader with commission",
        });
        await merchant.set_settings(traderSettings([trader.id]));

        let payout = await merchant
          .create_payout(payoutRequest(true))
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
          { timeout: 15_000 },
        );

        await delay(2_000);
        await core.change_status(finalized_feed.id, "declined");
        await declined;
        await ctx.healthcheck(token, { expect: { status: 2 } });
      }));
  });

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("payout cancellation without commission", () => {
    for (let usdt of [true, false]) {
      let variant = usdt ? "usdt" : "rub";

      test.concurrent(`approved -> declined (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await setup_payout(ctx, merchant, {
            usdt,
            commission: { self_rate: "0", provider_rate: "0" },
          });

          let { feed, token } = await approved_payout(
            ctx,
            merchant,
            trader,
            usdt,
            { expect: { commission_value: 0, commission_amount: 0 } },
          );

          let core = ctx.shared_state().core_harness;
          let declined = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "payout");
            assert.strictEqual(n.status, "declined");
          });
          await delay(2_000);
          await core.change_status(feed.id, "declined");
          await declined;
          await ctx.healthcheck(token, { expect: { status: 2 } });
        }));
    }
  });

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("payout cancellation with merchant commission", () => {
    for (let usdt of [true, false]) {
      let variant = usdt ? "usdt" : "rub";

      test.concurrent(`approved -> declined (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await setup_payout(ctx, merchant, {
            usdt,
            commission: { self_rate: "10", provider_rate: "0" },
          });

          let { feed, token } = await approved_payout(
            ctx,
            merchant,
            trader,
            usdt,
          );

          let core = ctx.shared_state().core_harness;
          let declined = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "payout");
            assert.strictEqual(n.status, "declined");
          });
          await delay(2_000);
          await core.change_status(feed.id, "declined");
          await declined;
          await ctx.healthcheck(token, { expect: { status: 2 } });
        }));
    }
  });

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("payout cancellation with trader + merchant commission", () => {
    for (let usdt of [true, false]) {
      let variant = usdt ? "usdt" : "rub";

      test.concurrent(`approved -> declined (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await setup_payout(ctx, merchant, { usdt });

          let { feed, token } = await approved_payout(
            ctx,
            merchant,
            trader,
            usdt,
          );

          let core = ctx.shared_state().core_harness;
          let declined = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "payout");
            assert.strictEqual(n.status, "declined");
          });
          await delay(2_000);
          await core.change_status(feed.id, "declined");
          await declined;
          await ctx.healthcheck(token, { expect: { status: 2 } });
        }));
    }
  });

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent(
    "payout cancellation with trader + merchant + agent commission",
    () => {
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
          await merchant.set_settings(traderSettings([trader.id]));

          let { feed, token } = await approved_payout(
            ctx,
            merchant,
            trader,
            true,
          );

          let core = ctx.shared_state().core_harness;
          let declined = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "payout");
            assert.strictEqual(n.status, "declined");
          });
          await delay(2_000);
          await core.change_status(feed.id, "declined");
          await declined;
          await ctx.healthcheck(token, { expect: { status: 2 } });
        }));
    },
  );

describe
  .runIf(CONFIG.in_project(["reactivepay"]))
  .concurrent(
    "payout cancellation with insufficient trader balance (main)",
    () => {
      for (let usdt of [true, false]) {
        let variant = usdt ? "usdt" : "rub";
        let currency = usdt ? "USDT" : "RUB";

        test.concurrent(`approved -> declined (${variant})`, ({
          ctx,
          merchant,
        }) =>
          ctx.track_bg_rejections(async () => {
            let trader = await setup_payout(ctx, merchant, { usdt });

            let { feed, token } = await approved_payout(
              ctx,
              merchant,
              trader,
              usdt,
            );

            // drain the trader main wallet so it can not cover the reversal
            let wallets = await trader.wallets();
            await trader.cashout("main", currency, wallets.main.available);

            let core = ctx.shared_state().core_harness;
            await delay(2_000);
            await core.change_status(feed.id, "declined");
            await delay(2_000);
            await ctx.healthcheck(token, { expect: { status: 1 } });
          }));
      }
    },
  );

describe
  .runIf(CONFIG.in_project(["reactivepay"]))
  .concurrent(
    "payout cancellation with insufficient trader balance (profit)",
    () => {
      for (let usdt of [true, false]) {
        let variant = usdt ? "usdt" : "rub";
        let currency = usdt ? "USDT" : "RUB";

        test.concurrent(`approved -> declined (${variant})`, ({
          ctx,
          merchant,
        }) =>
          ctx.track_bg_rejections(async () => {
            let trader = await setup_payout(ctx, merchant, { usdt });

            let { feed, token } = await approved_payout(
              ctx,
              merchant,
              trader,
              usdt,
            );

            // drain the trader income wallet so the earned provider commission
            // can not be clawed back
            let wallets = await trader.wallets();
            await trader.cashout("income", currency, wallets.income.available);

            let core = ctx.shared_state().core_harness;
            await delay(2_000);
            await core.change_status(feed.id, "declined");
            await delay(2_000);
            await ctx.healthcheck(token, { expect: { status: 1 } });
          }));
      }
    },
  );

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
        await merchant.set_settings(traderSettings([trader.id]));

        let { feed, token } = await approved_payout(
          ctx,
          merchant,
          trader,
          true,
        );

        // drain the agent wallet so it can not cover the reversal of the
        // agent commission
        let core = ctx.shared_state().core_harness;
        let agent_wallets = await ctx
          .shared_state()
          .core_db.profileWallets(agent.id, "USDT");
        let agent_wallet = agent_wallets.find((w) => w.currency === "USDT");
        assert(agent_wallet, "agent usdt wallet");
        let agent_available = agent_wallet.available;
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
    for (let usdt of [true, false]) {
      let variant = usdt ? "usdt" : "rub";

      test.concurrent(`approved -> declined (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await setup_payout(ctx, merchant, {
            usdt,
            payout_hold_period: 1,
          });

          // approved with an active hold period: payout funds are held
          let { feed, token } = await approved_payout(
            ctx,
            merchant,
            trader,
            usdt,
          );

          let core = ctx.shared_state().core_harness;
          let declined = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "payout");
            assert.strictEqual(n.status, "declined");
          });
          await delay(2_000);
          await core.change_status(feed.id, "declined");
          await declined;
          await ctx.healthcheck(token, {
            expect: { status: 2, amount_in_hold: 0 },
          });
        }));

      test.todo(`approved -> declined after worker (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await setup_payout(ctx, merchant, {
            usdt,
            payout_hold_period: 1,
          });

          // approved with an active hold period: payout funds are held
          await approved_payout(ctx, merchant, trader, usdt);
        }));
    }
  });

describe
  .runIf(CONFIG.in_project(["a2"]))
  .concurrent("deposit drain payout tests", () => {
    for (let usdt of [true, false]) {
      let variant = usdt ? "usdt" : "rub";
      let currency = usdt ? "USDT" : "RUB";

      test.concurrent(`approved -> declined drains deposit balance and commission amount (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await setup_payout(ctx, merchant, { usdt });

          let { feed } = await approved_payout(ctx, merchant, trader, usdt, {
            skip_notification_healthcheck: true,
          });

          let core = ctx.shared_state().core_harness;
          let wallets = await trader.wallets();
          await trader.cashout("main", currency, wallets.main.available);
          await trader.cashout("income", currency, wallets.income.available);

          await delay(2_000);
          await core.change_status(feed.id, "declined");
          await delay(1_000);
          wallets = await trader.wallets();
          // assert.containSubset(wallets, {
          //   main: { available: 0, held: 0 },
          //   profit: { available: 0, held: 0 },
          //   // payout amount + provider commission -> -105
          //   deposit: {
          //     available: -(PAYOUT_AMOUNT_MAJOR + TRADER_PROFIT),
          //     held: 0,
          //   },
          // });
          assert.isNotNull(feed.api_payment_token, "feed api payment token");
          await ctx.healthcheck(feed.api_payment_token, {
            expect: {
              status: 2,
              commission_provider_amount: TRADER_PROFIT,
            },
          });
        }));

      test.concurrent(`approved -> declined drains deposit balance (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await setup_payout(ctx, merchant, { usdt });

          let { feed } = await approved_payout(ctx, merchant, trader, usdt, {
            skip_notification_healthcheck: true,
          });

          let core = ctx.shared_state().core_harness;
          let wallets = await trader.wallets();
          await trader.cashout("main", currency, wallets.main.available);

          await delay(2_000);
          await core.change_status(feed.id, "declined");
          await delay(1_000);
          wallets = await trader.wallets();
          assert.containSubset(wallets, {
            deposit: { available: -PAYOUT_AMOUNT_MAJOR, held: 0 },
          });
          assert.isNotNull(feed.api_payment_token, "feed api payment token");
          await ctx.healthcheck(feed.api_payment_token, {
            expect: { status: 2 },
          });
        }));

      test.concurrent(`concurrent payout declines must not overdraw main (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await setup_payout(ctx, merchant, {
            usdt,
            // funds both payouts of the pair
            cashin: MERCHANT_CASHIN * 2,
          });

          let core = ctx.shared_state().core_harness;
          let approve = () =>
            approved_payout(ctx, merchant, trader, usdt, {
              skip_notification_healthcheck: true,
            }).then((r) => r.feed);

          let feeds = [await approve(), await approve()];

          let wallets = await trader.wallets();
          await trader.cashout(
            "main",
            currency,
            wallets.main.available - PAYOUT_AMOUNT_MAJOR,
          );
          await trader.wallets().then(({ main }) => {
            assert.containSubset(
              main,
              { available: PAYOUT_AMOUNT_MAJOR, held: 0 },
              "main funded for one clawback",
            );
          });

          let declines = Promise.all(
            feeds.map(() =>
              merchant.queue_notification(
                (n) => {
                  assert.strictEqual(n.type, "payout");
                  assert.strictEqual(n.status, "declined");
                },
                { skip_healthcheck: true, timeout: 20_000 },
              ),
            ),
          );

          await delay(2_000);
          await Promise.all(
            feeds.map((feed) => core.change_status(feed.id, "declined")),
          );
          await declines;
          await delay(1_000);

          let final = await trader.wallets();
          assert.containSubset(
            final,
            {
              // One drained main to 0; main must never go negative.
              main: { available: 0, held: 0 },
              // The other fell through to the deposit wallet -> -100.
              deposit: { available: -PAYOUT_AMOUNT_MAJOR, held: 0 },
            },
            "trader: concurrent payout declines split across main and deposit without overdrawing main",
          );

          for (let feed of feeds) {
            assert.isNotNull(feed.api_payment_token, "feed api payment token");
            await ctx.healthcheck(feed.api_payment_token, {
              expect: { status: 2 },
            });
          }
        }));
    }
  });
