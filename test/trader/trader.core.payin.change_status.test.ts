import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import type { CreateTraderOptions } from "@/driver/core";
import { traderNoConvertSettings, traderSetttings } from "@/driver/trader";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { ExtendedTrader } from "@/entities/trader";
import { test } from "@/test_context";
import type { Context } from "@/test_context/context";

let opts: CreateTraderOptions = { usdt: false, payout_hold_period: 0 };

const TRADER_DELAY = 5_000;

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent(`trader core manage payin change status`, () => {
    const AMOUNT = 10_000; // 100 RUB in kopeyki
    const AMOUNT_RUB = AMOUNT / 100; // 100 RUB

    async function setup(
      ctx: Context,
      merchant: ExtendedMerchant,
      usdt = opts.usdt,
      pay_expired_minutes?: number,
    ) {
      let trader = await ctx.create_random_trader({ ...opts, usdt });
      await trader.setup({ card: true, bank: "sberbank" });
      if (usdt === true) {
        await trader.cashin("main", "USDT", AMOUNT_RUB);
        await merchant.set_settings(
          traderSetttings([trader.id], { pay_expired_minutes }),
        );
      } else {
        await trader.cashin("main", "RUB", AMOUNT_RUB);
        await merchant.set_settings(
          traderNoConvertSettings("RUB", [trader.id], { pay_expired_minutes }),
        );
      }
      await merchant.set_commission({
        operation: "PayinRequest",
        self_rate: "10",
        provider_rate: "5",
        currency: "RUB",
        comment: "trader with commission",
      });
      return trader;
    }

    for (let usdt of [true, false]) {
      let variant = usdt ? "usdt" : "rub";

      test.concurrent(`payin approved -> declined (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await setup(ctx, merchant, usdt);

          // await trader
          //   .wallets()
          //   .then(({ main: { id } }) =>
          //     ctx.shared_state().core_db.unsafe_set_wallet_balance(id, 1000000, 1000000),
          //   );

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

          let declined_cb = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "pay");
            assert.strictEqual(n.status, "declined");
          });
          await delay(TRADER_DELAY);
          await ctx.core_change_status(res.token, "declined");
          await ctx.healthcheck(res.token, { expect: { status: 2 } });
          await declined_cb;
        }));

      test.concurrent(`payin declined -> approved (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await setup(ctx, merchant, usdt);

          // await trader
          //   .wallets()
          //   .then(({ main: { id } }) =>
          //     ctx.shared_state().core_db.unsafe_set_wallet_balance(id, 1000000, 1000000),
          //   );

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

          await ctx.healthcheck(res.token, { expect: { status: 2 } });

          let approved_callback = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "pay");
            assert.strictEqual(n.status, "approved");
          });
          await delay(2_000);
          await ctx.core_change_status(res.token, "approved");
          await approved_callback;
          await ctx.healthcheck(res.token, {
            expect: { status: 1, commission_value: 10 },
          });
        }));

      test.concurrent(`payin pending -> approved (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          await setup(ctx, merchant, usdt);

          let res = await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "card"),
              amount: AMOUNT,
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          await delay(TRADER_DELAY);

          let approved_callback = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "pay");
            assert.strictEqual(n.status, "approved");
          });

          await ctx.core_change_status(res.token, "approved");
          await approved_callback;

          let updated_feed = await ctx.get_feed(res.token);
          assert.strictEqual(updated_feed.status, 1, "feed should be approved");
          await ctx.healthcheck(res.token, { expect: { status: 1 } });
        }));

      test.concurrent(`payin pending -> declined (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          await setup(ctx, merchant, usdt);

          let res = await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "card"),
              amount: AMOUNT,
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          await delay(TRADER_DELAY);

          let declined_callback = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "pay");
            assert.strictEqual(n.status, "declined");
          });

          await ctx.core_change_status(res.token, "declined");
          await declined_callback;

          await ctx.healthcheck(res.token, { expect: { status: 2 } });
        }));

      test.concurrent(`payin pending -> expired (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          await setup(ctx, merchant, usdt, 1);

          let res = await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "card"),
              amount: AMOUNT,
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          let feed = await ctx.get_feed(res.token);
          assert.strictEqual(feed.status, 0, "feed should be pending");

          let declined_callback = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "pay");
            assert.strictEqual(n.status, "expired");
          });

          await declined_callback;

          await ctx.healthcheck(res.token, { expect: { status: 2 } });
        }));
    }
  });

const PAYIN_AMOUNT = 10_000; // 100 RUB in kopeyki
const PAYIN_AMOUNT_RUB = PAYIN_AMOUNT / 100; // 100 RUB
// Over-fund the trader: the healthcheck validates per-transaction entries, not
// absolute wallet balances, so extra balance is harmless and avoids
// insufficient-funds errors on requisite assignment.
const TRADER_CASHIN = PAYIN_AMOUNT_RUB + 10;
const REQUISITE_DELAY = 5_000;

function payinRequest() {
  return {
    ...common.traderPaymentRequest("RUB", "card"),
    amount: PAYIN_AMOUNT,
  };
}

type PayinSetupOpts = {
  usdt: boolean;
  commission?: Parameters<ExtendedMerchant["set_commission"]>[0];
};

async function setup_payin(
  ctx: Context,
  merchant: ExtendedMerchant,
  opts: PayinSetupOpts,
) {
  let currency = opts.usdt ? "USDT" : "RUB";
  let trader = await ctx.create_random_trader({
    usdt: opts.usdt,
    payout_hold_period: 0,
  });
  await trader.setup({ card: true, bank: "sberbank" });
  await trader.cashin("main", currency, TRADER_CASHIN);
  await merchant.set_commission({
    operation: "PayinRequest",
    currency: "RUB",
    self_rate: "10",
    provider_rate: "5",
    ...opts.commission,
  });
  await merchant.set_settings(
    opts.usdt
      ? traderSetttings([trader.id])
      : traderNoConvertSettings("RUB", [trader.id]),
  );
  return trader;
}

/**
 * Runs a payin up to the approved state and returns its token.
 */
async function approved_payin(
  ctx: Context,
  merchant: ExtendedMerchant,
  trader: ExtendedTrader,
) {
  let approved = merchant.queue_notification((n) => {
    assert.strictEqual(n.type, "pay");
    assert.strictEqual(n.status, "approved");
  });

  let res = await merchant
    .create_payment(payinRequest())
    .then((r) => r.followFirstProcessingUrl())
    .then((r) => r.as_trader_requisites());

  await delay(REQUISITE_DELAY);
  await trader.finalizeTransaction(res.token, "approved");
  await approved;
  await ctx.healthcheck(res.token, {
    expect: { status: 1, commission_value: 10 },
  });
  return res.token;
}

describe
  .runIf(CONFIG.in_project(["reactivepay"]))
  .concurrent(
    "payin cancellation with insufficient trader income balance",
    () => {
      for (let usdt of [true, false]) {
        let currency = usdt ? "USDT" : "RUB";
        test.concurrent(`approved -> declined (${currency.toLowerCase()})`, ({
          ctx,
          merchant,
        }) =>
          ctx.track_bg_rejections(async () => {
            let trader = await setup_payin(ctx, merchant, { usdt });
            let token = await approved_payin(ctx, merchant, trader);

            // drain the trader income wallet so the earned provider commission
            // can not be clawed back
            let wallets = await trader.wallets();
            await trader.cashout("income", currency, wallets.income.available);

            await delay(2_000);
            await ctx.core_change_status(token, "declined");
            await delay(2_000);
            await ctx.healthcheck(token, {
              expect: { status: 1, commission_value: 10 },
            });
          }));
      }
    },
  );

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("payin cancellation with insufficient merchant balance", () => {
    for (let usdt of [true, false]) {
      let currency = usdt ? "USDT" : "RUB";
      test.concurrent(`approved -> declined (${currency.toLowerCase()})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await setup_payin(ctx, merchant, { usdt });
          let token = await approved_payin(ctx, merchant, trader);

          // drain the merchant wallet so the credited payin amount can not be
          // taken back on reversal
          let merchant_wallets = await merchant.wallets(currency);
          let merchant_wallet = merchant_wallets.find(
            (w) => w.currency === currency,
          );
          assert(merchant_wallet, "merchant wallet");
          let available = merchant_wallet.available;
          await merchant.cashout(currency, available);

          await delay(2_000);
          await ctx.core_change_status(token, "declined");
          await delay(2_000);
          await ctx.healthcheck(token, {
            expect: { status: 1, commission_value: 10 },
          });
        }));
    }
  });

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("payin cancellation with insufficient agent balance", () => {
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
        await trader.cashin("main", "USDT", TRADER_CASHIN);
        await merchant.set_commission({
          operation: "PayinRequest",
          currency: "RUB",
          self_rate: "10",
          provider_rate: "5",
          agent_id: agent.id.toString(),
          agent_rate: "2",
        });
        await merchant.set_settings(traderSetttings([trader.id]));

        let token = await approved_payin(ctx, merchant, trader);

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
        await ctx.core_change_status(token, "declined");
        await delay(2_000);
        await ctx.healthcheck(token, {
          expect: {
            status: 1,
            commission_value: 10,
            agent_commission_value: 2,
          },
        });
      }));
  });

describe
  .runIf(CONFIG.in_project(["reactivepay"]))
  .concurrent("payin restore with insufficient trader main balance", () => {
    for (let usdt of [true, false]) {
      let currency = usdt ? "USDT" : "RUB";
      test.concurrent(`declined -> approved (${currency.toLowerCase()})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await setup_payin(ctx, merchant, { usdt });

          let declined = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "pay");
            assert.strictEqual(n.status, "declined");
          });

          let res = await merchant
            .create_payment(payinRequest())
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          await delay(REQUISITE_DELAY);
          await trader.finalizeTransaction(res.token, "declined");
          await declined;
          await ctx.healthcheck(res.token, { expect: { status: 2 } });

          // decline returned the funds to the trader main wallet, drain it so
          // the payin can not be charged again on restore
          let wallets = await trader.wallets();
          await trader.cashout("main", currency, wallets.main.available);

          await delay(2_000);
          await ctx.core_change_status(res.token, "approved");
          await delay(2_000);
          await ctx.healthcheck(res.token, { expect: { status: 2 } });
        }));
    }
  });
