import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { traderSettings } from "@/driver/trader";
import { STATIC_RATE } from "@/provider_mocks/rate";
import { test } from "@/test_context";

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("trader randomizer", () => {
    test.concurrent("card payin randomizer", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          currency: "RUB",
        });
        await merchant.set_commission({ operation: "PayinRequest" });
        await merchant.cashin("RUB", 1);
        await trader.setup({ card: true, bank: "sberbank" });
        let amount = 100_00;
        let transactions_amount = 10;
        await trader.cashin("main", "USDT", 99999999999);
        await merchant.set_settings(
          traderSettings([trader.id], {
            randomizer: {
              random_range: [300_00, 350_00],
              random_step: 50_00,
              random_retries: 5,
            },
          }),
        );
        let tokens: string[] = [];
        let notifications: any[] = [];
        for (let _ of [...new Array(transactions_amount)]) {
          let res = await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "card"),
              amount: amount * 5,
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_raw_json() as Record<string, any>);
          if (res.card) {
            assert(res.card, "card filed should not be empty");
            assert.strictEqual(res.card.pan, common.visaCard);
            assert.strictEqual(res.card.bank, "sberbank");
            assert.strictEqual(res.card.name, common.fullName);
            notifications.push(
              merchant.queue_notification((_cb) => {}, {
                skip_healthcheck: true,
              }),
            );
            tokens.push(res.token);
          }
        }
        for (let token of tokens) {
          await trader.finalizeTransaction(token, "approved");
        }
        await Promise.race([Promise.all(notifications), delay(5_000)]);
      }));

    test
      .runIf(CONFIG.mock_rate)
      .concurrent(
        "card randomizer don't go over the trader limits",
        ({ ctx, merchant }) =>
          ctx.track_bg_rejections(async () => {
            let trader = await ctx.create_random_trader({
              usdt: true,
              min_limit: common.amount / 100 - 10,
              max_limit: common.amount / 100 + 10,
            });
            await merchant.cashin("RUB", 1);
            await trader.setup({ card: true, bank: "sberbank" });
            await trader.cashin("main", "USDT", 99999999999);
            await merchant.set_settings(
              traderSettings([trader.id], {
                randomizer: {
                  random_range: [300_00, 350_00],
                  random_step: 50_00,
                  random_retries: 5,
                },
              }),
            );

            // Obtain slot for default amount
            await merchant
              .create_payment({
                ...common.traderPaymentRequest("RUB", "card"),
                amount: common.amount * STATIC_RATE,
              })
              .then((r) => r.followFirstProcessingUrl())
              .then((r) => r.as_trader_requisites());

            // make sure the limits worked
            await merchant
              .create_payment({
                ...common.traderPaymentRequest("RUB", "card"),
                amount: common.amount * STATIC_RATE + 10000,
              })
              .then((r) => r.followFirstProcessingUrl())
              .then((r) => r.as_error());

            // Randomizer should respect core trader limits
            await merchant
              .create_payment({
                ...common.traderPaymentRequest("RUB", "card"),
                amount: common.amount * STATIC_RATE,
              })
              .then((r) => r.followFirstProcessingUrl())
              .then((r) => r.as_error());
          }),
      );

    test
      .runIf(CONFIG.mock_rate)
      .concurrent(
        "no trader balance for randomized amount",
        ({ ctx, merchant }) =>
          ctx.track_bg_rejections(async () => {
            let trader = await ctx.create_random_trader({
              usdt: true,
            });
            await merchant.cashin("RUB", 1);
            let requisites = await trader.setup({
              card: true,
              bank: "sberbank",
            });
            await requisites.card.edit({ min_amount_float: 201.0 });
            await trader.cashin("main", "USDT", 100);
            await merchant.set_settings(
              traderSettings([trader.id], {
                randomizer: {
                  random_range: [300_00, 350_00],
                  random_step: 50_00,
                  random_retries: 5,
                },
              }),
            );

            await merchant
              .create_payment({
                ...common.traderPaymentRequest("RUB", "card"),
                amount: 100_00 * STATIC_RATE,
              })
              .then((r) => r.followFirstProcessingUrl())
              .then((r) => r.as_error());
          }),
      );

    test
      .runIf(CONFIG.mock_rate)
      .concurrent(
        "no trader balance for randomized amount picks trader with balance",
        ({ ctx, merchant }) =>
          ctx.track_bg_rejections(async () => {
            let trader = await ctx.create_random_trader({
              usdt: true,
            });
            let trader_with_balance = await ctx.create_random_trader({
              usdt: true,
            });
            await merchant.cashin("RUB", 1);
            await trader
              .setup({ card: true, bank: "sberbank" })
              .then((r) => r.card.edit({ min_amount_float: 201.0 }));
            await trader_with_balance
              .setup({ card: true, bank: "tbank" })
              .then((r) => r.card.edit({ min_amount_float: 201.0 }));
            await trader.cashin("main", "USDT", 100);
            await trader_with_balance.cashin("main", "USDT", 130);
            await merchant.set_settings(
              traderSettings([trader.id, trader_with_balance.id], {
                randomizer: {
                  random_range: [10_00, 100_00],
                  random_step: 10_00,
                  random_retries: 5,
                },
              }),
            );

            await merchant
              .create_payment({
                ...common.traderPaymentRequest("RUB", "card"),
                amount: 100_00 * STATIC_RATE,
              })
              .then((r) => r.followFirstProcessingUrl())
              .then((r) => r.as_trader_requisites());
          }),
      );
  });
