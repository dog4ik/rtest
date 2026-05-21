import * as common from "@/common";
import { CONFIG } from "@/config";
import { traderNoConvertSettings } from "@/driver/trader";
import { test } from "@/test_context";
import { delay } from "@std/async";
import { assert, describe } from "vitest";

describe
  .runIf(CONFIG.in_project("a2"))
  .concurrent("expires tests", { timeout: 180_000 }, () => {
    test.concurrent("expired payin", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: false,
          payout_hold_period: 0,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          traderNoConvertSettings("RUB", [trader.id], {
            pay_expired_minutes: 1,
          }),
        );
        await trader.cashin("main", "RUB", common.amount / 100);

        let notification = merchant.queue_notification((cb) => {
          assert.strictEqual(cb.type, "pay");
          assert.strictEqual(cb.status, "approved");
        });

        let res = await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: common.amount,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        await Promise.race([notification, delay(150 * 1_000)]);
        await trader.finalizeTransaction(res.token, "approved");
        await notification;
      }),
    );
  });
