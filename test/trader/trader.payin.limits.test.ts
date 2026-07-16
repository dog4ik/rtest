import { CONFIG } from "@/config";
import * as common from "@/common";
import { test } from "@/test_context";
import { assert, describe } from "vitest";
import { TRADER_DELAY, traderNoConvertSettings } from "@/driver/trader";
import { delay } from "@std/async";

describe.runIf(CONFIG.in_project(["reactivepay", "a2"])).concurrent("trader service limits", () => {
  let transactions_amount = 3;
  test.concurrent(`${transactions_amount} concurrent requests don't go over the requisite limit`, ({
    ctx,
    merchant,
  }) =>
    ctx.track_bg_rejections(async () => {
      let trader = await ctx.create_random_trader({
        usdt: false,
      });

      await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

      await trader.cashin("main", "RUB", (common.amount / 100) * transactions_amount);
      let t = await trader.setup({ card: true, bank: "sberbank" });
      await t.card.edit({
        transaction_limit: 1,
        deactivate_limit_reached: true,
        concurrent_transactions_enabled: true,
        concurrent_transactions: transactions_amount,
      });

      let requests = await Promise.all(
        [...new Array(transactions_amount)].map((_, i) =>
          merchant.create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: common.amount - i,
          }),
        ),
      );

      let responses = await Promise.all(
        requests.map((r) =>
          r.followFirstProcessingUrl().then((r) => r.as_raw_json() as Record<string, any>),
        ),
      );

      // let responses = [
      //   await req1.followFirstProcessingUrl().then((r) => r.as_raw_json() as Record<string, any>),
      //   await req2.followFirstProcessingUrl().then((r) => r.as_raw_json() as Record<string, any>),
      // ];

      await delay(TRADER_DELAY);
      let requisite_count = responses.reduce(
        (n, r) => (r.card?.pan === common.visaCard ? n + 1 : n),
        0,
      );
      assert.strictEqual(requisite_count, 1, "merchant expected to get one requisite");
    }));
});
