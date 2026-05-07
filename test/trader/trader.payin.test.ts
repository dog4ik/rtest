import * as common from "@/common";
import { traderNoConvertSettings } from "@/driver/trader";
import { test } from "@/test_context";
import { delay } from "@std/async";
import { assert, describe } from "vitest";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { Context } from "@/test_context/context";
import { CONFIG } from "@/config";

const TRADER_DELAY = 5_000;

describe.runIf(CONFIG.in_project(["reactivepay", "a2"])).concurrent("commission healthcheck payins", () => {
  const AMOUNT = 100_000;
  const AMOUNT_RUB = AMOUNT / 100; // 1000 RUB
  const SELF_RATE = 0.1; // 10%
  const COMMISSION_RUB = AMOUNT_RUB * SELF_RATE; // 100 RUB
  const PROVIDER_RATE = 0.05; // 5%
  const PROVIDER_COMMISSION_RUB = AMOUNT_RUB * PROVIDER_RATE; // 50 RUB
  const MERCHANT_NET_RUB = AMOUNT_RUB - COMMISSION_RUB; // 900 RUB

  async function rubWallet(merchant: ExtendedMerchant) {
    let ws = await merchant.wallets("RUB");
    let w = ws.find((w) => w.currency === "RUB");
    return { available: w?.available ?? 0, held: w?.held ?? 0 };
  }

  async function setup(ctx: Context) {
    let trader = await ctx.create_random_trader({ usdt: false, payout_hold_period: 0 });
    await trader.setup({ card: true, bank: "sberbank" });
    let merchant = await ctx.create_random_merchant();
    await merchant.set_commission({
      operation: "PayinRequest",
      self_rate: "10",
      provider_rate: "5",
    });
    await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));
    await trader.cashin("main", "RUB", AMOUNT_RUB);
    return { trader, merchant };
  }

  test.concurrent("approved payin with commission", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { trader, merchant } = await setup(ctx);

      let notification = merchant.queue_notification((cb) => {
        assert.strictEqual(cb.type, "pay");
        assert.strictEqual(cb.status, "approved");
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
      await notification;

      assert.approximately(
        (await rubWallet(merchant)).available,
        MERCHANT_NET_RUB,
        0.01,
        "merchant wallet: received net amount after commission",
      );
      assert.strictEqual(
        (await rubWallet(merchant)).held,
        0,
        "merchant wallet: nothing held",
      );

      let traderWallets = await trader.wallets();
      assert.approximately(
        traderWallets.main.available,
        0,
        0.01,
        "trader main: fully paid out (net + commission)",
      );
      assert.strictEqual(
        traderWallets.main.held,
        0,
        "trader main: nothing held",
      );
      assert.approximately(
        traderWallets.profit.available,
        PROVIDER_COMMISSION_RUB,
        0.01,
        "trader profit: received provider commission",
      );
      assert.strictEqual(
        traderWallets.profit.held,
        0,
        "trader profit: nothing held",
      );
    }),
  );

  test.concurrent("declined payin with commission", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { trader, merchant } = await setup(ctx);

      let notification = merchant.queue_notification((cb) => {
        assert.strictEqual(cb.type, "pay");
        assert.strictEqual(cb.status, "declined");
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
      await notification;

      assert.deepEqual(
        await rubWallet(merchant),
        { available: 0, held: 0 },
        "merchant wallet: unchanged after decline",
      );

      let traderWallets = await trader.wallets();
      assert.approximately(
        traderWallets.main.available,
        AMOUNT_RUB,
        0.01,
        "trader main: fully returned after decline",
      );
      assert.strictEqual(
        traderWallets.main.held,
        0,
        "trader main: nothing held",
      );
      assert.deepEqual(
        { available: traderWallets.profit.available, held: traderWallets.profit.held },
        { available: 0, held: 0 },
        "trader profit: empty after decline",
      );
    }),
  );
});
