import * as common from "@/common";
import { TRADER_DELAY, traderNoConvertSettings } from "@/driver/trader";
import { test } from "@/test_context";
import { delay } from "@std/async";
import { assert, describe } from "vitest";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { Context } from "@/test_context/context";
import { CONFIG } from "@/config";

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("commission healthcheck payouts", () => {
    const AMOUNT = 100_000; // 1000 RUB
    const AMOUNT_RUB = AMOUNT / 100; // 1000 RUB
    const SELF_RATE = 0.1; // 10%
    const COMMISSION_RUB = AMOUNT_RUB * SELF_RATE; // 100 RUB
    const PROVIDER_RATE = 0.05; // 5%
    const PROVIDER_COMMISSION_RUB = AMOUNT_RUB * PROVIDER_RATE; // 50 RUB

    async function rubWallet(merchant: ExtendedMerchant) {
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

    async function setup(ctx: Context) {
      let trader = await ctx.create_random_trader({
        usdt: false,
        payout_hold_period: 0,
      });
      await trader.setup({ card: true, bank: "sberbank" });
      let merchant = await ctx.create_random_merchant();
      await merchant.set_commission({
        operation: "PayoutRequest",
        self_rate: "10",
        provider_rate: "5",
      });
      return { trader, merchant };
    }

    test.concurrent("instantly declined payout with commission", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { trader, merchant } = await setup(ctx);
        await merchant.cashin("RUB", AMOUNT_RUB + COMMISSION_RUB);
        assert.deepEqual(await rubWallet(merchant), { available: 1100, held: 0 }, "after cashin");
        await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

        let notification = merchant.queue_notification((cb) => {
          assert.strictEqual(cb.status, "declined");
        });

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());

        await delay(TRADER_DELAY);
        await trader.finalizeTransaction(payout.token, "declined");
        await notification;

        assert.deepEqual(
          await rubWallet(merchant),
          { available: AMOUNT_RUB + COMMISSION_RUB, held: 0 },
          "after declined: merchant funds returned",
        );
        let traderWallets = await trader.wallets();
        assert.deepEqual(
          {
            available: traderWallets.main.available,
            held: traderWallets.main.held,
          },
          { available: 0, held: 0 },
          "after declined: trader main funds untouched",
        );
        assert.deepEqual(
          {
            available: traderWallets.profit.available,
            held: traderWallets.profit.held,
          },
          { available: 0, held: 0 },
          "after declined: trader profit empty",
        );
      }));

    test.concurrent("pending payout finalize to approved with commission", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { trader, merchant } = await setup(ctx);
        await merchant.cashin("RUB", AMOUNT_RUB + COMMISSION_RUB);
        assert.deepEqual(await rubWallet(merchant), { available: 1100, held: 0 }, "after cashin");
        await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;

        assert.deepEqual(
          await rubWallet(merchant),
          { available: 0, held: AMOUNT_RUB + COMMISSION_RUB },
          "pending: payout amount and commission held",
        );
        let traderWalletsPending = await trader.wallets();
        assert.deepEqual(
          {
            available: traderWalletsPending.main.available,
            held: traderWalletsPending.main.held,
          },
          { available: 0, held: 0 },
          "pending: trader main funds not held yet",
        );

        let feed = await trader.finalizeTransaction(token, "approved");
        await delay(5_000);

        let notification = merchant.queue_notification((cb) => {
          assert.strictEqual(cb.type, "payout");
          assert.strictEqual(cb.status, "approved");
        });

        await ctx.shared_state().core_harness.approve_payout(feed.id);
        await notification;

        assert.deepEqual(
          await rubWallet(merchant),
          { available: 0, held: 0 },
          "approved: payout sent, commission charged",
        );
        let traderWalletsApproved = await trader.wallets();
        assert.deepEqual(
          {
            available: traderWalletsApproved.main.available,
            held: traderWalletsApproved.main.held,
          },
          { available: AMOUNT_RUB, held: 0 },
          "approved: trader gets payout funds",
        );
        assert.approximately(
          traderWalletsApproved.profit.available,
          PROVIDER_COMMISSION_RUB,
          0.01,
          "approved: trader profit received provider commission",
        );
        assert.strictEqual(
          traderWalletsApproved.profit.held,
          0,
          "approved: trader profit held is zero",
        );
      }));

    test.concurrent("pending payout finalize to declined with commission", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { trader, merchant } = await setup(ctx);
        await merchant.cashin("RUB", AMOUNT_RUB + COMMISSION_RUB);
        assert.deepEqual(await rubWallet(merchant), { available: 1100, held: 0 }, "after cashin");
        await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

        let payout = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());
        let token = payout.token;

        assert.deepEqual(
          await rubWallet(merchant),
          { available: 0, held: AMOUNT_RUB + COMMISSION_RUB },
          "pending: payout amount and commission held",
        );
        let traderWalletsPending = await trader.wallets();
        assert.deepEqual(
          {
            available: traderWalletsPending.main.available,
            held: traderWalletsPending.main.held,
          },
          { available: 0, held: 0 },
          "pending: trader main funds are not affected",
        );

        let notification = merchant.queue_notification((cb) => {
          assert.strictEqual(cb.status, "declined");
        });

        await delay(TRADER_DELAY);
        await trader.finalizeTransaction(token, "declined");
        await notification;

        assert.deepEqual(
          await rubWallet(merchant),
          { available: AMOUNT_RUB + COMMISSION_RUB, held: 0 },
          "declined: full amount returned to merchant",
        );
        let traderWalletsDeclined = await trader.wallets();
        assert.deepEqual(
          {
            available: traderWalletsDeclined.main.available,
            held: traderWalletsDeclined.main.held,
          },
          { available: 0, held: 0 },
          "declined: trader main funds untouched",
        );
        assert.deepEqual(
          {
            available: traderWalletsDeclined.profit.available,
            held: traderWalletsDeclined.profit.held,
          },
          { available: 0, held: 0 },
          "declined: trader profit empty",
        );
      }));

    test.concurrent("payout fails when cashin excludes commission", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { trader, merchant } = await setup(ctx);
        await merchant.cashin("RUB", AMOUNT_RUB); // only base amount, no commission
        await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

        let error = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
        error.assert_message("amount_not_enough_money");
        assert.deepEqual(
          await rubWallet(merchant),
          { available: AMOUNT_RUB, held: 0 },
          "payout failed: merchant balance unchanged",
        );
      }));

    test.concurrent("payout fails without any cashin", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { trader, merchant } = await setup(ctx);
        // No cashin at all
        await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

        let error = await merchant
          .create_payout(payoutRequest())
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
        error.assert_message("amount_not_enough_money");
      }));
  });
