import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { traderSettings } from "@/driver/trader";
import { test } from "@/test_context";

const TRADER_DELAY = 5_000;

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("trader agent commission tests", () => {
    const AMOUNT = 100_000;
    const AMOUNT_RUB = AMOUNT / 100; // 1000 RUB
    const SELF_RATE = 0.1; // 10% merchant commission
    const _PROVIDER_RATE = 0.05; // 5% trader commission
    const _AGENT_RATE = 0.02; // 2% agent commission
    const _MERCHANT_NET_RUB = AMOUNT_RUB * (1 - SELF_RATE); // 900 RUB

    test.concurrent("approved payin with trader agent merchant commission", ({
      ctx,
    }) =>
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
        await trader.cashin("main", "USDT", AMOUNT_RUB * 3);

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
      }));

    test.concurrent("approved payout with trader agent merchant commission", ({
      ctx,
    }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          payout_hold_period: 1,
        });
        await trader.setup({ card: true, bank: "sberbank" });

        let merchant = await ctx.create_random_merchant();
        let agent = await ctx.create_random_agent({
          traders_ids: [trader.id],
          merchant_id: merchant.id,
        });

        await merchant.set_commission({
          operation: "PayoutRequest",
          trader_id: trader.id.toString(),
          agent_id: agent.id.toString(),
          self_rate: "10",
          provider_rate: "5",
          agent_rate: "2",
        });

        await merchant.set_settings(traderSettings([trader.id]));
        await merchant.cashin("USDT", AMOUNT_RUB * 3);

        let notification = merchant.queue_notification((cb) => {
          assert.strictEqual(cb.type, "payout");
          assert.strictEqual(cb.status, "approved");
        });

        let res = await merchant
          .create_payout({
            ...common.payoutRequest("RUB"),
            amount: AMOUNT,
            card: {
              pan: common.visaCard,
            },
            customer: {
              email: "test@email.com",
              ip: "8.8.8.8",
              first_name: common.firstName,
              last_name: common.lastName,
            },
            bank_account: {
              requisite_type: "card",
            },
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_payout_response());

        await delay(TRADER_DELAY);
        let feed = await trader.finalizeTransaction(res.token, "approved");
        await ctx.shared_state().core_harness.approve_payout(feed.id);
        await notification;
      }));
  });
