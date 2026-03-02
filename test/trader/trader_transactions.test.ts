import * as common from "@/common";
import * as assets from "@/assets";
import { traderNoConvertSettings, traderSetttings } from "@/driver/trader";
import { CONFIG } from "@/config";
import { test } from "@/test_context";
import { delay } from "@std/async";
import { assert, describe } from "vitest";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { ExtendedTrader } from "@/entities/trader";

const TRADER_DELAY = 5_000;

for (const usdt of [true, false]) {
  async function setup_merchant(merchant: ExtendedMerchant, trader_id: number) {
    if (usdt) {
      await merchant.set_settings(traderSetttings([trader_id]));
    } else {
      await merchant.set_settings(traderNoConvertSettings("RUB", [trader_id]));
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
    .concurrent(`trader tests ${usdt ? "ustd" : "without convert"}`, () => {
      test.concurrent("approve payin", ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(usdt);
          await trader.setup({ sbp: true, bank: "sberbank" });
          await trader_cashin(trader);
          await merchant.set_commission({
            operation: "PayinRequest",
            self_rate: "10",
            currency: "RUB",
            comment: "trader with commission",
          });
          await setup_merchant(merchant, trader.id);
          let approve_cb = merchant.queue_notification((n) => {
            assert.strictEqual(n.status, "approved");
          });
          let res = await merchant
            .create_payment({
              ...common.paymentRequest("RUB"),
              bank_account: {
                requisite_type: "sbp",
              },
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          await delay(TRADER_DELAY);
          let feed = await trader.finalizeTransaction(res.token, "approved");
          await approve_cb;

          let wallets = await trader.wallets();
          assert.strictEqual(
            wallets.main.available,
            common.amount / 100 -
              (feed.target_amount! + (feed.commission_amount ?? 0)),
          );
          assert.strictEqual(wallets.main.held, 0);
        }),
      );

      test.concurrent("decline payin", ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(usdt);
          await trader.setup({ sbp: true, bank: "sberbank" });
          await trader_cashin(trader);
          await setup_merchant(merchant, trader.id);
          let decline_cb = merchant.queue_notification((n) => {
            assert.strictEqual(n.status, "declined");
          });
          let res = await merchant
            .create_payment({
              ...common.paymentRequest("RUB"),
              bank_account: {
                requisite_type: "sbp",
              },
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          await delay(TRADER_DELAY);
          await trader.finalizeTransaction(res.token, "declined");
          await decline_cb;

          let wallets = await trader.wallets();
          assert.strictEqual(wallets.main.available, common.amount / 100);
          assert.strictEqual(wallets.main.held, 0);
        }),
      );

      test.concurrent("approve dispute", ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(usdt);
          await trader.setup({ sbp: true, bank: "sberbank" });
          await trader_cashin(trader);
          await setup_merchant(merchant, trader.id);
          let decline_cb = merchant.queue_notification((n) => {
            assert.strictEqual(n.status, "declined");
          });
          let res = await merchant
            .create_payment({
              ...common.paymentRequest("RUB"),
              bank_account: {
                requisite_type: "sbp",
              },
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          await delay(TRADER_DELAY);
          await trader.finalizeTransaction(res.token, "declined");
          await decline_cb;

          let dispute_pending_notification = merchant.queue_notification(
            (c) => {
              assert.strictEqual(c.status, "pending");
              assert.strictEqual(c.type, "dispute");
            },
          );
          let dispute_approved_notification = merchant.queue_notification(
            (c) => {
              assert.strictEqual(c.status, "approved");
              assert.strictEqual(c.type, "dispute");
            },
          );
          await merchant.create_dispute({
            token: res.token,
            file_path: assets.PngImgPath,
            description: "test dispute",
          });

          await delay(TRADER_DELAY);
          let disputes = await ctx.get_disputes(res.token);
          await trader.finalize_dispute(disputes[0].dispute_id, "approved");
          await dispute_pending_notification;
          await dispute_approved_notification;
        }),
      );

      test.concurrent("card payin data flow", ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(usdt);
          await trader.setup({ card: true, bank: "sberbank" });
          await trader_cashin(trader);
          await setup_merchant(merchant, trader.id);
          let res = await merchant
            .create_payment({
              ...common.paymentRequest("RUB"),
              bank_account: {
                requisite_type: "card",
              },
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());
          assert(res.card, "card filed should not be empty");
          assert.strictEqual(res.card.pan, common.visaCard);
          assert.strictEqual(res.card.bank, "sberbank");
          assert.strictEqual(res.card.name, common.fullName);
        }),
      );

      test.concurrent("link payin data flow", ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(usdt);
          await trader.setup({ link: true, bank: "sberbank" });
          await trader_cashin(trader);
          await setup_merchant(merchant, trader.id);
          let res = await merchant
            .create_payment({
              ...common.paymentRequest("RUB"),
              bank_account: {
                requisite_type: "link",
              },
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());
          assert(res.link, "link filed should not be empty");
          assert.strictEqual(res.link.url, common.redirectPayUrl);
        }),
      );

      test.concurrent("sbp payin data flow", ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(usdt);
          await trader.setup({ sbp: true, bank: "sberbank" });
          await trader_cashin(trader);
          await setup_merchant(merchant, trader.id);
          let res = await merchant
            .create_payment({
              ...common.paymentRequest("RUB"),
              bank_account: {
                requisite_type: "sbp",
              },
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());
          assert(res.sbp, "sbp filed should not be empty");
          assert.strictEqual(res.sbp.name, common.fullName);
          assert.strictEqual(res.sbp.bank, "sberbank");
          assert.strictEqual(res.sbp.phone, common.phoneNumber);
        }),
      );

      test.concurrent("account payin data flow", ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(usdt);
          await trader.setup({ account: true, bank: "sberbank" });
          await trader_cashin(trader);
          await setup_merchant(merchant, trader.id);
          let res = await merchant
            .create_payment({
              ...common.paymentRequest("RUB"),
              bank_account: {
                requisite_type: "account",
              },
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());
          assert(res.account, "account filed should not be empty");
          assert.strictEqual(res.account.name, common.fullName);
          assert.strictEqual(res.account.bank, "sberbank");
          assert.strictEqual(res.account.number, common.accountNumber);
        }),
      );

      test.concurrent("card payout data flow", ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(usdt);
          await trader.setup({ card: true, bank: "sberbank" });
          await setup_merchant(merchant, trader.id);
          await merchant.cashin(usdt ? "USDT" : "RUB", common.amount / 100);
          await trader_cashin(trader);
          let res = await merchant
            .create_payout({
              ...common.payoutRequest("RUB"),
              bank_account: {
                requisite_type: "card",
              },
              customer: {
                email: common.email,
                ip: "8.8.8.8",
                first_name: "test",
                last_name: "test",
              },
              card: {
                pan: common.visaCard,
              },
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_raw_json());
        }),
      );

      test.concurrent(
        "card payin transactions load test",
        ({ ctx, merchant }) =>
          ctx.track_bg_rejections(async () => {
            let trader = await ctx.create_random_trader(usdt);
            await trader.setup({ card: true, bank: "sberbank" });
            let transactions_amount = 20;
            await trader_cashin(
              trader,
              transactions_amount * (common.amount / 100),
            );
            await setup_merchant(merchant, trader.id);
            let requisites = [...new Array(transactions_amount)].map(
              async (_, i) => {
                let res = await merchant
                  .create_payment({
                    ...common.paymentRequest("RUB"),
                    amount: common.amount + i,
                    bank_account: {
                      requisite_type: "card",
                    },
                  })
                  .then((r) => r.followFirstProcessingUrl())
                  .then((r) => r.as_trader_requisites());
                if (res) {
                  assert(res.card, "card filed should not be empty");
                  assert.strictEqual(res.card.pan, common.visaCard);
                  assert.strictEqual(res.card.bank, "sberbank");
                  assert.strictEqual(res.card.name, common.fullName);
                }
              },
            );
            await Promise.all(requisites);
          }),
      );
    });
}
test.runIf(CONFIG.in_project(["a2", "reactivepay"])).concurrent(
  "trader don't leak requisite under load",
  ({ ctx, merchant }) =>
    ctx.track_bg_rejections(async () => {
      let trader = await ctx.create_random_trader(false);
      await trader.setup({ card: true, bank: "sberbank" });
      let transactions_amount = 2;
      let amount = 10000;
      await trader.cashin(
        "main",
        "RUB",
        (transactions_amount) * (amount / 100),
      );
      await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));
      let requisites = [...new Array(transactions_amount)].map(async (_, i) => {
        let res = await merchant
          .create_payment({
            ...common.paymentRequest("RUB"),
            amount: amount + i * 100,
            bank_account: {
              requisite_type: "card",
            },
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        if (res) {
          assert(res.card, "card filed should not be empty");
          assert.strictEqual(res.card.pan, common.visaCard);
          assert.strictEqual(res.card.bank, "sberbank");
          assert.strictEqual(res.card.name, common.fullName);
        }
      });
      // for (let req of requisites) {
      //   await req;
      // }
      await Promise.all(requisites);
    }),
);
