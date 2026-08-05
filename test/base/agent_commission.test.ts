import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { traderSettings } from "@/driver/trader";
import { test } from "@/test_context";

const TRADER_DELAY = 5_000;

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("agent commission tests", () => {
    const AMOUNT = 100_000;
    const AMOUNT_USD = AMOUNT / 100; // 1000 USD
    const AGENT_RATE = 0.02; // 2% agent commission
    const AGENT_COMMISSION = AMOUNT_USD * AGENT_RATE; // 20 USDT

    test.concurrent("approved payin pays agent commission", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          payout_hold_period: 0,
        });
        await trader.setup({ card: true, bank: "sberbank" });

        let merchant = await ctx.create_random_merchant();
        let agent = await ctx.create_random_agent({
          traders_ids: [trader.id],
          merchant_id: merchant.id,
        });

        await merchant.set_commission({
          operation: "PayinRequest",
          trader_id: trader.id.toString(),
          agent_id: agent.id.toString(),
          self_rate: "10",
          provider_rate: "5",
          agent_rate: "2",
        });

        await merchant.set_settings(traderSettings([trader.id]));
        await trader.cashin("main", "USDT", AMOUNT_USD * 3);

        // Healthcheck runs inside queue_notification: the `expect` object asserts
        // the feed's agent commission and the validator checks the agent wallet
        // received exactly that amount.
        let notification = merchant.queue_notification(
          (cb) => {
            assert.strictEqual(cb.type, "pay");
            assert.strictEqual(cb.status, "approved");
          },
          { expect: { agent_commission_amount: AGENT_COMMISSION } },
        );

        let res = await merchant
          .create_payment({
            ...common.traderPaymentRequest("USD", "card"),
            amount: AMOUNT,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        await delay(TRADER_DELAY);
        await trader.finalizeTransaction(res.token, "approved");
        await notification;
      }));
  });
