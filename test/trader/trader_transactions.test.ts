import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as assets from "@/assets";
import * as common from "@/common";
import { CONFIG, PROJECT } from "@/config";
import type { CreateTraderOptions } from "@/driver/core";
import { traderNoConvertSettings, traderSetttings } from "@/driver/trader";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { ExtendedTrader } from "@/entities/trader";
import { test } from "@/test_context";

const TRADER_DELAY = 5_000;

for (const usdt of [true, false]) {
  let opts: CreateTraderOptions = { usdt, payout_hold_period: 0 };
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
          let trader = await ctx.create_random_trader(opts);
          await trader.setup({ card: true, bank: "sberbank" });
          await trader_cashin(trader);
          await merchant.set_commission({
            operation: "PayinRequest",
            self_rate: "10",
            currency: "RUB",
            comment: "trader with commission",
          });
          await setup_merchant(merchant, trader.id);
          let approve_cb = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "pay");
            assert.strictEqual(n.status, "approved");
          });
          let res = await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "card"),
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          await delay(TRADER_DELAY);
          let feed = await trader.finalizeTransaction(res.token, "approved");
          await approve_cb;

          let wallets = await trader.wallets();
          assert.isNotNull(feed.target_amount, "feed target amount");
          assert.approximately(
            wallets.main.available,
            common.amount / 100 -
              (feed.target_amount + (feed.commission_amount ?? 0)),
            0.01,
          );
          assert.strictEqual(wallets.main.held, 0);
          let merchant_wallet = (await merchant.wallets())[0];
          if (usdt) {
            assert.strictEqual(
              merchant_wallet.held,
              0,
              "merchant wallet held after payment finalization",
            );
          } else {
            assert.approximately(
              merchant_wallet.available,
              common.amount / 100 - (common.amount * 0.1) / 100,
              0.01,
              "merchant wallet available after payment finalization",
            );
            assert.strictEqual(
              merchant_wallet.held,
              0,
              "merchant wallet held after payment finalization",
            );
          }
        }));

      test.concurrent("decline payin", ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(opts);
          await trader.setup({ card: true, bank: "sberbank" });
          await trader_cashin(trader);
          await setup_merchant(merchant, trader.id);
          let decline_cb = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "pay");
            assert.strictEqual(n.status, "declined");
          });
          let res = await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "card"),
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          await delay(TRADER_DELAY);
          await trader.finalizeTransaction(res.token, "declined");
          await decline_cb;

          let wallets = await trader.wallets();
          assert.strictEqual(wallets.main.available, common.amount / 100);
          assert.strictEqual(wallets.main.held, 0);
        }));

      test.concurrent("approved dispute on declined payin", ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(opts);
          await trader.setup({ sbp: true, bank: "sberbank" });
          await trader_cashin(trader);
          await setup_merchant(merchant, trader.id);
          let decline_cb = merchant.queue_notification((n) => {
            assert.strictEqual(n.status, "declined");
          });
          let res = await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "sbp"),
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          await delay(TRADER_DELAY);
          await trader.finalizeTransaction(res.token, "declined");
          await decline_cb;

          let dispute_pending_notification =
            PROJECT === "a2"
              ? merchant.queue_notification((c) => {
                  assert.strictEqual(c.status, "pending");
                  assert.strictEqual(c.type, "dispute");
                })
              : Promise.resolve(undefined);

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
          await dispute_pending_notification;

          await delay(TRADER_DELAY);
          let disputes = await ctx.get_disputes(res.token);
          await trader.finalize_dispute(disputes[0].dispute_id, "approved");
          await dispute_approved_notification;
        }));

      test
        .runIf(CONFIG.in_project(["a2"]))
        .concurrent("approved dispute on approved payin", ({ ctx, merchant }) =>
          ctx.track_bg_rejections(async () => {
            let trader = await ctx.create_random_trader(opts);
            await trader.setup({ sbp: true, bank: "sberbank" });
            await trader_cashin(trader, common.amount * 2);
            await setup_merchant(merchant, trader.id);
            let approved_cb = merchant.queue_notification((n) => {
              assert.strictEqual(n.status, "approved");
            });
            let res = await merchant
              .create_payment({
                ...common.traderPaymentRequest("RUB", "sbp"),
              })
              .then((r) => r.followFirstProcessingUrl())
              .then((r) => r.as_trader_requisites());

            await delay(TRADER_DELAY);
            await trader.finalizeTransaction(res.token, "approved");
            await approved_cb;

            let dispute_pending_notification =
              PROJECT === "a2"
                ? merchant.queue_notification((c) => {
                    assert.strictEqual(c.status, "pending");
                    assert.strictEqual(c.type, "dispute");
                  })
                : Promise.resolve(undefined);

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
            await dispute_pending_notification;

            await delay(TRADER_DELAY);
            let disputes = await ctx.get_disputes(res.token);
            await trader.finalize_dispute(disputes[0].dispute_id, "approved");
            await dispute_approved_notification;
          }),
        );

      test.concurrent("card payin data flow", ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(opts);
          await trader.setup({ card: true, bank: "sberbank" });
          await trader_cashin(trader);
          await setup_merchant(merchant, trader.id);
          let res = await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "card"),
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());
          assert(res.card, "card filed should not be empty");
          assert.strictEqual(res.card.pan, common.visaCard);
          assert.strictEqual(res.card.bank, "sberbank");
          assert.strictEqual(res.card.name, common.fullName);
        }));

      test.concurrent("link payin data flow", ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(opts);
          await trader.setup({ link: true, bank: "sberbank" });
          await trader_cashin(trader);
          await setup_merchant(merchant, trader.id);
          let res = await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "link"),
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());
          assert(res.link, "link filed should not be empty");
          assert.strictEqual(res.link.url, common.redirectPayUrl);
        }));

      test.concurrent("sbp payin data flow", ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(opts);
          await trader.setup({ sbp: true, bank: "sberbank" });
          await trader_cashin(trader);
          await setup_merchant(merchant, trader.id);
          let res = await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "sbp"),
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());
          assert(res.sbp, "sbp filed should not be empty");
          assert.strictEqual(res.sbp.name, common.fullName);
          assert.strictEqual(res.sbp.bank, "sberbank");
          assert.strictEqual(res.sbp.phone, common.phoneNumber);
        }));

      test.concurrent("account payin data flow", ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(opts);
          await trader.setup({ account: true, bank: "sberbank" });
          await trader_cashin(trader);
          await setup_merchant(merchant, trader.id);
          let res = await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "account"),
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());
          assert(res.account, "account filed should not be empty");
          assert.strictEqual(res.account.name, common.fullName);
          assert.strictEqual(res.account.bank, "sberbank");
          assert.strictEqual(res.account.number, common.accountNumber);
        }));

      test.concurrent("card payout data flow", ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(opts);
          await trader.setup({ card: true, bank: "sberbank" });
          let converted_amount = common.amount / (usdt ? 74.01 : 1);
          await setup_merchant(merchant, trader.id);
          if (usdt) {
            await merchant.cashin(
              "USDT",
              converted_amount / 100 + (converted_amount * 0.1) / 100,
            );
          } else {
            await merchant.cashin(
              "RUB",
              common.amount / 100 + (converted_amount * 0.1) / 100,
            );
          }
          await merchant.set_commission({
            self_rate: "10",
            operation: "PayoutRequest",
          });
          await trader_cashin(trader, converted_amount / 100);
          let res = await merchant
            .create_payout({
              ...common.payoutRequest("RUB"),
              bank_account: {
                requisite_type: "card",
              },
              customer: {
                email: common.email,
                ip: common.ip,
                first_name: "test",
                last_name: "test",
              },
              card: {
                pan: common.visaCard,
              },
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_payout_response());
          let feed = await trader.finalizeTransaction(res.token, "approved");
          await delay(5_000);
          let approve_notification = merchant.queue_notification((c) => {
            assert.strictEqual(c.type, "payout");
            assert.strictEqual(c.status, "approved");
          });
          await ctx.shared_state().core_harness.approve_payout(feed.id);
          await approve_notification;
        }));

      test.concurrent("card payin transactions load test", ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(opts);
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
                  ...common.traderPaymentRequest("RUB", "card"),
                  amount: common.amount + i,
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
        }));
    });
}
test
  .runIf(CONFIG.in_project(["a2", "reactivepay"]))
  .concurrent("trader don't leak requisite under load", ({ ctx, merchant }) =>
    ctx.track_bg_rejections(async () => {
      let trader = await ctx.create_random_trader({ usdt: false });
      await trader.setup({ card: true, bank: "sberbank" });
      let transactions_amount = 3;
      let extra_requests = 2;
      let amount = 10000;
      await trader.cashin("main", "RUB", transactions_amount * (amount / 100));
      await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));
      let barrier = Promise.withResolvers<unknown>();
      let got_requests = 0;
      let got_requisites = 0;
      let requisites = [...new Array(transactions_amount + extra_requests)].map(
        async (_, i) => {
          let res = await merchant.create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: amount - i,
          });
          got_requests += 1;
          if (got_requests === transactions_amount + extra_requests) {
            barrier.resolve(undefined);
          }
          await barrier.promise;
          let json = await res
            .followFirstProcessingUrl()
            .then((r) => r.as_raw_json() as Record<string, any>);
          if (json?.card?.pan === common.visaCard) {
            got_requisites += 1;
          }
        },
      );
      // for (let req of requisites) {
      //   await req;
      // }
      await Promise.all(requisites);
      assert.strictEqual(got_requisites, transactions_amount);
    }),
  );

test
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent(
    "TRY trader 2 requisites with the same amount",
    ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: false,
          currency: "TRY",
        });
        await trader.setup({ card: true, bank: "sberbank" });
        let transactions_amount = 2;
        let amount = 10000;
        await trader.cashin(
          "main",
          "TRY",
          transactions_amount * (amount / 100),
        );
        await merchant.set_settings(
          traderNoConvertSettings("TRY", [trader.id]),
        );

        for (let _ of [...new Array(transactions_amount)]) {
          let res = await merchant
            .create_payment({
              ...common.traderPaymentRequest("TRY", "card"),
              amount,
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());
          if (res) {
            assert(res.card, "card filed should not be empty");
            assert.strictEqual(res.card.pan, common.visaCard);
            assert.strictEqual(res.card.bank, "sberbank");
            assert.strictEqual(res.card.name, common.fullName);
          }
        }
      }),
  );

test
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent(
    "rub trader fails to get 2 requisites with the same amount",
    ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: false,
          currency: "RUB",
        });
        await trader.setup({ card: true, bank: "sberbank" });
        let transactions_amount = 2;
        let amount = 10000;
        await trader.cashin(
          "main",
          "RUB",
          transactions_amount * (amount / 100),
        );
        await merchant.set_settings(
          traderNoConvertSettings("RUB", [trader.id]),
        );

        let res = await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        if (res) {
          assert(res.card, "card filed should not be empty");
          assert.strictEqual(res.card.pan, common.visaCard);
          assert.strictEqual(res.card.bank, "sberbank");
          assert.strictEqual(res.card.name, common.fullName);
        }
        let failedRes = await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
        failedRes.assert_message("gateway response error: requisite_not_found");
      }),
  );

test
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("payout skip_processing_url approved", ({ ctx, merchant }) =>
    ctx.track_bg_rejections(async () => {
      let trader = await ctx.create_random_trader({
        usdt: false,
        currency: "RUB",
      });
      await trader.setup({ card: true, bank: "sberbank" });
      let amount = 10000;
      await merchant.cashin("RUB", amount / 100);
      let settings = traderNoConvertSettings("RUB", [trader.id]) as Record<
        string,
        any
      >;
      settings.gateways.skip_processing_url = true;
      await merchant.set_settings(settings);

      let res = await merchant.create_payout_raw({
        ...common.payoutRequest("RUB"),
        amount,
        bank_account: {
          requisite_type: "card",
        },
        customer: {
          email: common.email,
          ip: common.ip,
          first_name: "test",
          last_name: "test",
        },
        card: {
          pan: common.visaCard,
        },
      });
      let response = res.as_p2p_ok();
      let feed = await trader.finalizeTransaction(response.token, "approved");
      await delay(5_000);
      let approve_notification = merchant.queue_notification((c) => {
        assert.strictEqual(c.type, "payout");
        assert.strictEqual(c.status, "approved");
      });
      await ctx.shared_state().core_harness.approve_payout(feed.id);
      await approve_notification;
    }),
  );

test
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("card payin randomizer", ({ ctx, merchant }) =>
    ctx.track_bg_rejections(async () => {
      let trader = await ctx.create_random_trader({
        usdt: false,
        currency: "RUB",
      });
      await merchant.set_commission({ operation: "PayinRequest" });
      /// There is a bug where 2 concurrent approves create 2 wallets with the same currency.
      // kind  |  id   | available | held | profile_id |         created_at         | currency
      // ------+-------+-----------+------+------------+----------------------------+----------
      //       | 31936 |        90 |    0 |      21438 | 2026-08-04 14:58:33.499398 | RUB
      //       | 31937 |     100.8 |    0 |      21438 | 2026-08-04 14:58:33.509945 | RUB
      await merchant.cashin("RUB", 1);
      await trader.setup({ card: true, bank: "sberbank" });
      let amount = 100_00;
      let transactions_amount = 2;
      await trader.cashin("main", "RUB", (amount / 100) * 99999);
      let settings = traderNoConvertSettings("RUB", [trader.id]);
      let trader_block = settings.gateways.trader as Record<string, any>;
      trader_block.random_range = [10_00, 30_00];
      trader_block.random_retries = 5;
      trader_block.random_step = 1_00;
      await merchant.set_settings(settings);
      let tokens: string[] = [];
      let notifications: any[] = [];
      for (let _ of [...new Array(transactions_amount)]) {
        let res = await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: amount,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        assert(res.card, "card filed should not be empty");
        assert.strictEqual(res.card.pan, common.visaCard);
        assert.strictEqual(res.card.bank, "sberbank");
        assert.strictEqual(res.card.name, common.fullName);
        notifications.push(
          merchant.queue_notification((cb) => {
            assert.strictEqual(cb.status, "approved");
          }),
        );
        tokens.push(res.token);
      }
      for (let token of tokens) {
        await trader.finalizeTransaction(token, "approved");
      }
      await Promise.race([Promise.all(notifications), delay(5_000)]);
    }),
  );
