import { describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import type { CreateTraderOptions } from "@/driver/core";
import { traderNoConvertSettings, traderSetttings } from "@/driver/trader";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { ExtendedTrader } from "@/entities/trader";
import { test } from "@/test_context";

for (const usdt of [true]) {
  let opts: CreateTraderOptions = { usdt, payout_hold_period: 0 };
  async function setup_merchant(merchant: ExtendedMerchant, trader_id: number) {
    let opts = { pay_expired_minutes: 10 };
    if (usdt) {
      await merchant.set_settings(traderSetttings([trader_id], opts));
    } else {
      await merchant.set_settings(
        traderNoConvertSettings("RUB", [trader_id], opts),
      );
    }
  }

  async function trader_cashin(
    trader: ExtendedTrader,
    amount = common.amount / 100,
  ) {
    await trader.cashin("main", usdt ? "USDT" : "RUB", amount);
  }

  describe
    .runIf(CONFIG.in_project(["reactivepay", "a2"]))
    .concurrent(
      `trader tests ${usdt ? "ustd" : "without convert"}`,
      { timeout: 180_000 },
      () => {
        test.skip("card payin transactions load test", ({ ctx, merchant }) =>
          ctx.track_bg_rejections(async () => {
            let trader = await ctx.create_random_trader(opts);
            await trader.setup({ card: true, bank: "sberbank" });
            let transactions_amount = 1;
            await trader_cashin(
              trader,
              transactions_amount * (common.amount / 100),
            );
            await setup_merchant(merchant, trader.id);
            let requisites = [...new Array(transactions_amount)].map(
              async (_, i) => {
                let res = await merchant
                  .create_payment({
                    ...common.traderPaymentRequest("RUB", "card"),
                    amount: common.amount + i,
                  })
                  .then((r) => r.followFirstProcessingUrl())
                  .then((r) => r.as_trader_requisites());
                return res.token;
              },
            );
            let tokens = await Promise.all(requisites);
            for (let _token of tokens) {
              // await trader.finalizeTransaction(token, "approved");
            }
          }));
      },
    );
}
