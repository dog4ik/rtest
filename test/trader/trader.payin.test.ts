import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as assets from "@/assets";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { traderNoConvertSettings, traderSettings } from "@/driver/trader";
import type { ExtendedMerchant } from "@/entities/merchant";
import { STATIC_RATE } from "@/provider_mocks/rate";
import { test } from "@/test_context";
import type { Context } from "@/test_context/context";

const TRADER_DELAY = 5_000;

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2", "settlixx"]))
  .concurrent("commission healthcheck payins", () => {
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
      let trader = await ctx.create_random_trader({
        usdt: false,
        payout_hold_period: 0,
      });
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
          traderWallets.income.available,
          PROVIDER_COMMISSION_RUB,
          0.01,
          "trader profit: received provider commission",
        );
        assert.strictEqual(
          traderWallets.income.held,
          0,
          "trader profit: nothing held",
        );
      }));

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
          {
            available: traderWallets.income.available,
            held: traderWallets.income.held,
          },
          { available: 0, held: 0 },
          "trader profit: empty after decline",
        );
      }));
  });

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("unique amount per device", () => {
    test.concurrent("1 device 1 profile 1 card 1 sbp should allow same amount", ({
      ctx,
      merchant,
    }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
        });
        await trader.cashin("main", "USDT", common.amount * 5);
        await trader.enable_trader_method("card_enabled");
        await trader.enable_trader_method("sbp_enabled");
        let device_id = await trader.create_device(true);
        let profile_id = await trader.create_profile(device_id);
        await trader.create_requisite(
          profile_id,
          "card",
          common.visaCard,
          true,
        );
        await trader.create_requisite(
          profile_id,
          "sbp",
          common.phoneNumber,
          true,
        );
        await merchant.set_settings(traderSettings([trader.id]));
        let request_amount = common.amount * STATIC_RATE;
        let res = await merchant
          .create_payment({
            ...common.p2pPaymentRequest("RUB", "card"),
            amount: request_amount,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        await merchant
          .create_payment({
            ...common.p2pPaymentRequest("RUB", "sbp"),
            amount: request_amount,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        await trader.finalizeTransaction(res.token, "approved");

        await merchant
          .create_payment({
            ...common.p2pPaymentRequest("RUB", "sbp"),
            amount: request_amount,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());

        await merchant
          .create_payment({
            ...common.p2pPaymentRequest("RUB", "card"),
            amount: request_amount,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
      }));

    test.concurrent("2 device 2 profile card should allow same amount", ({
      ctx,
      merchant,
    }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
        });
        await trader.cashin("main", "USDT", common.amount * 5);
        await trader.enable_trader_method("card_enabled");
        await Promise.all(
          [...Array(2)].map(async (_, i) => {
            let device_id = await trader.create_device(true);
            let profile_id = await trader.create_profile(device_id);
            await trader.create_requisite(
              profile_id,
              "card",
              i % 2 === 0 ? common.visaCard : common.mastercardCard,
              true,
            );
          }),
        );
        await merchant.set_settings(traderSettings([trader.id]));
        let request_amount = common.amount * STATIC_RATE;
        let res = await merchant
          .create_payment({
            ...common.p2pPaymentRequest("RUB", "card"),
            amount: request_amount,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        await merchant
          .create_payment({
            ...common.p2pPaymentRequest("RUB", "card"),
            amount: request_amount,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        await merchant
          .create_payment({
            ...common.p2pPaymentRequest("RUB", "card"),
            amount: request_amount,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());

        await trader.finalizeTransaction(res.token, "approved");

        await merchant
          .create_payment({
            ...common.p2pPaymentRequest("RUB", "card"),
            amount: request_amount,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
      }));

    test.concurrent("1 device 2 profile 2 card should not allow same amount", ({
      ctx,
      merchant,
    }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
        });
        await trader.cashin("main", "USDT", common.amount * 5);
        await trader.enable_trader_method("card_enabled");
        let device_id = await trader.create_device(true);
        await Promise.all(
          [...Array(2)].map(async (_, i) => {
            let profile_id = await trader.create_profile(device_id);
            await trader.create_requisite(
              profile_id,
              "card",
              i % 2 === 0 ? common.visaCard : common.mastercardCard,
              true,
            );
          }),
        );
        await merchant.set_settings(traderSettings([trader.id]));
        let request_amount = common.amount * STATIC_RATE;
        await merchant
          .create_payment({
            ...common.p2pPaymentRequest("RUB", "card"),
            amount: request_amount,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        await merchant
          .create_payment({
            ...common.p2pPaymentRequest("RUB", "card"),
            amount: request_amount,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
      }));

    test.concurrent("1 device 1 profile 2 card should not allow same amount", ({
      ctx,
      merchant,
    }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
        });
        await trader.cashin("main", "USDT", common.amount * 5);
        await trader.enable_trader_method("card_enabled");
        let device_id = await trader.create_device(true);
        let profile_id = await trader.create_profile(device_id);
        await Promise.all(
          [...Array(2)].map(async (_, i) => {
            await trader.create_requisite(
              profile_id,
              "card",
              i % 2 === 0 ? common.visaCard : common.mastercardCard,
              true,
            );
          }),
        );
        await merchant.set_settings(traderSettings([trader.id]));
        let request_amount = common.amount * STATIC_RATE;
        await merchant
          .create_payment({
            ...common.p2pPaymentRequest("RUB", "card"),
            amount: request_amount,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        await merchant
          .create_payment({
            ...common.p2pPaymentRequest("RUB", "card"),
            amount: request_amount,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
      }));
  });

test
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent(
    "only one requisite assigned under concurrency",
    ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          payout_hold_period: 0,
        });
        let setup = await trader.setup({
          card: true,
          sbp: true,
          bank: "sberbank",
        });
        assert(setup.profile_id);
        await trader.driver
          .add_requisite({
            profile_id: setup.profile_id,
            requisite_type: "card",
            requisite_value: common.mastercardCard,
            title: "another card",
            card_holder: "Test holder",
          })
          .then(async (r) => {
            assert(r.id);
            await trader.driver.activate_requisite(r.id);
          });

        let transactions_amount = 8;
        let amount = 10000;
        await trader.cashin(
          "main",
          "USDT",
          transactions_amount * (amount / 100),
        );
        await merchant.set_settings(
          traderSettings([trader.id], {
            // randomizer: {
            //   random_step: 1_00,
            //   random_range: [1_00, 10_00],
            //   random_retries: 100,
            // },
          }),
        );

        let barrier = Promise.withResolvers<unknown>();
        let got_requests = 0;
        let got_requisites = 0;

        let results = [...new Array(transactions_amount)].map(async (_, i) => {
          let res = await merchant.create_payment({
            ...common.traderPaymentRequest("RUB", i % 2 === 0 ? "card" : "sbp"),
            amount: amount * STATIC_RATE,
          });
          got_requests += 1;
          if (got_requests === transactions_amount) {
            barrier.resolve(undefined);
          }
          await barrier.promise;
          let json = await res
            .followFirstProcessingUrl()
            .then((r) => r.as_raw_json() as Record<string, any>);
          if (
            [common.visaCard, common.mastercardCard].includes(
              json?.card?.pan,
            ) ||
            common.phoneNumber === json?.sbp?.phone
          ) {
            got_requisites += 1;
          }
        });

        await Promise.all(results);
        assert.strictEqual(
          got_requisites,
          2,
          "merchant should get only one requisite",
        );
      }),
  );

describe
  .runIf(CONFIG.in_project(["a2", "reactivepay"]))
  .concurrent("requisite available regardless of any trader state", () => {
    test.concurrent("trader insufficient balance", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader1 = await ctx.create_random_trader({
          usdt: false,
        });
        let trader2 = await ctx.create_random_trader({
          usdt: false,
        });
        await trader1.setup({ card: true, bank: "sberbank" });
        await trader2.setup({ card: true, bank: "tbank" });
        await trader2.cashin("main", "RUB", common.amount);
        await trader1.cashin("main", "RUB", 10);
        await merchant.set_settings(
          traderNoConvertSettings("RUB", [trader1.id, trader2.id]),
        );
        let res = await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        assert.strictEqual(res.card?.bank, "tbank", "tbank trader requisite");
      }));

    test.concurrent("trader missing profile", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader1 = await ctx.create_random_trader({
          usdt: false,
        });
        let trader2 = await ctx.create_random_trader({
          usdt: false,
        });
        await trader1.setup({ bank: "sberbank" });
        await trader2.setup({ card: true, bank: "tbank" });
        await trader1.cashin("main", "RUB", common.amount);
        await trader2.cashin("main", "RUB", common.amount);
        await trader1.enable_trader_method("card_enabled");
        await merchant.set_settings(
          traderNoConvertSettings("RUB", [trader1.id, trader2.id]),
        );
        let res = await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        assert.strictEqual(res.card?.bank, "tbank", "tbank trader requisite");
      }));
  });

describe
  .runIf(
    CONFIG.in_project(["a2", "reactivepay", "settlixx"]) && CONFIG.mock_rate,
  )
  .concurrent("trader requisite limits", () => {
    test.concurrent("min_amount_float limit", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          currency: "RUB",
        });
        let requisite = await trader.setup({ card: true, bank: "sberbank" });
        await requisite.card.edit({
          min_amount_float: 221.0,
        });
        await trader.cashin("main", "USDT", 999999999999);
        await merchant.set_settings(traderSettings([trader.id]));
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 220_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 221_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 222_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
      }));

    test.concurrent("max_amount_float", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          currency: "RUB",
        });
        let requisites = await trader.setup({ card: true, bank: "sberbank" });
        await requisites.card.edit({
          max_amount_float: 221.0,
        });
        await trader.cashin("main", "USDT", 99999999999);
        await merchant.set_settings(traderSettings([trader.id]));
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 220_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 221_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 222_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
      }));

    test.concurrent("daily amount", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          currency: "RUB",
        });
        let requisites = await trader.setup({ card: true, bank: "sberbank" });
        await requisites.card.edit({
          amount_limit_float: 221.0,
          deactivate_limit_reached: true,
        });
        await trader.cashin("main", "USDT", 99999999999);
        await merchant.set_settings(traderSettings([trader.id]));
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 220_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 221_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 222_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
      }));

    test.concurrent("concurrent transactions", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          currency: "RUB",
        });
        let requisites = await trader.setup({ card: true, bank: "sberbank" });
        await requisites.card.edit({
          concurrent_transactions_enabled: true,
          concurrent_transactions: 2,
          deactivate_limit_reached: true,
        });
        await trader.cashin("main", "USDT", 99999999999);
        await merchant.set_settings(traderSettings([trader.id]));
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 220_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        let res = await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 221_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 222_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
        await trader.finalizeTransaction(res.token, "approved");
        await delay(TRADER_DELAY);
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 223_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 224_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
      }));

    test.concurrent(
      "delay between transactions",
      { timeout: 90_000 },
      ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader({
            usdt: true,
            currency: "RUB",
          });
          let requisites = await trader.setup({ card: true, bank: "sberbank" });
          await requisites.card.edit({
            transaction_delay: 1,
            deactivate_limit_reached: true,
          });
          await trader.cashin("main", "USDT", 99999999999);
          await merchant.set_settings(traderSettings([trader.id]));
          await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "card"),
              amount: 220_00,
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());
          await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "card"),
              amount: 221_00,
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_error());
          await delay(70_000);
          await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "card"),
              amount: 223_00,
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());
          await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "card"),
              amount: 224_00,
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_error());
        }),
    );

    test.concurrent("daily transaction limit", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          currency: "RUB",
        });
        let requisites = await trader.setup({ card: true, bank: "sberbank" });
        await requisites.card.edit({
          transaction_limit: 2,
          deactivate_limit_reached: true,
        });
        await trader.cashin("main", "USDT", 99999999999);
        await merchant.set_settings(traderSettings([trader.id]));
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 220_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 221_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 222_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
      }));

    test.concurrent("deactivate when dispute", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          currency: "RUB",
        });
        let requisites = await trader.setup({ card: true, bank: "sberbank" });
        await requisites.card.edit({
          deactivate_dispute_present: true,
          deactivate_limit_reached: true,
        });
        await trader.cashin("main", "USDT", 99999999999);
        await merchant.set_settings(traderSettings([trader.id]));
        let res = await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 220_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        await delay(TRADER_DELAY);
        await trader.finalizeTransaction(res.token, "declined");
        await delay(TRADER_DELAY);
        await merchant.create_dispute({
          token: res.token,
          description: "test dispute",
          file_path: assets.PngImgPath,
        });
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 222_00,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
      }));
  });
describe
  .runIf(CONFIG.in_project(["a2", "reactivepay"]) && CONFIG.mock_rate)
  .concurrent("trader core filters", () => {
    test.concurrent("min limit", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          min_limit: 21,
          max_limit: 5000,
          currency: "RUB",
        });
        await trader.setup({ card: true, bank: "sberbank" });
        await trader.cashin("main", "USDT", 99999999);
        await merchant.set_settings(traderSettings([trader.id]));
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 2000 * STATIC_RATE,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 2100 * STATIC_RATE,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 2200 * STATIC_RATE,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
      }));

    test.concurrent("max limit", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          min_limit: 0,
          max_limit: 21,
          currency: "RUB",
        });
        await trader.setup({ card: true, bank: "sberbank" });
        await trader.cashin("main", "USDT", 99999999);
        await merchant.set_settings(traderSettings([trader.id]));
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 2000 * STATIC_RATE,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 2100 * STATIC_RATE,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
        await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 2200 * STATIC_RATE,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
      }));

    test
      .runIf(CONFIG.in_project(["reactivepay"]))
      .concurrent(
        "pick trader with the request currency convert_to",
        ({ ctx, merchant }) =>
          ctx.track_bg_rejections(async () => {
            let trader1 = await ctx.create_random_trader({
              usdt: true,
              currency: "RUB",
            });
            let trader2 = await ctx.create_random_trader({
              usdt: true,
              currency: "INR",
            });
            for (let trader of [trader1, trader2]) {
              await trader.setup({ card: true, bank: "sberbank" });
              await trader.cashin("main", "USDT", 99999999);
            }
            await merchant.set_settings(
              traderSettings([trader1.id, trader2.id]),
            );
            await merchant
              .create_payment({
                ...common.traderPaymentRequest("USD", "card"),
                amount: 2200 * STATIC_RATE,
              })
              .then((r) => r.followFirstProcessingUrl())
              .then((r) => r.as_error());
            await merchant
              .create_payment({
                ...common.traderPaymentRequest("INR", "card"),
                amount: 2200 * STATIC_RATE,
              })
              .then((r) => r.followFirstProcessingUrl())
              .then((r) => r.as_trader_requisites());
          }),
      );

    test
      .runIf(CONFIG.in_project(["reactivepay"]))
      .concurrent(
        "pick trader with the request currency no convert",
        ({ ctx, merchant }) =>
          ctx.track_bg_rejections(async () => {
            let trader1 = await ctx.create_random_trader({
              usdt: false,
              currency: "RUB",
            });
            let trader2 = await ctx.create_random_trader({
              usdt: false,
              currency: "INR",
            });
            for (let trader of [trader1, trader2]) {
              await trader.setup({ card: true, bank: "sberbank" });
              await trader.cashin("main", trader.default_currency, 99999999);
            }
            await merchant.set_settings(
              traderSettings([trader1.id, trader2.id]),
            );
            await merchant
              .create_payment({
                ...common.traderPaymentRequest("USD", "card"),
              })
              .then((r) => r.followFirstProcessingUrl())
              .then((r) => r.as_error());
            await merchant
              .create_payment({
                ...common.traderPaymentRequest("INR", "card"),
              })
              .then((r) => r.followFirstProcessingUrl())
              .then((r) => r.as_trader_requisites());
            await merchant
              .create_payment({
                ...common.traderPaymentRequest("INR", "card"),
              })
              .then((r) => r.followFirstProcessingUrl())
              .then((r) => r.as_error());
          }),
      );
  });

describe
  .runIf(CONFIG.in_project(["reactivepay"]))
  .concurrent("test inr payform", () => {
    test.skip("inr payfrom random amount", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader1 = await ctx.create_random_trader({
          usdt: false,
          currency: "INR",
        });
        await trader1.setup({ account: true, bank: "sberbank" });
        await trader1.cashin("main", "INR", 9999999999999);
        let settings = traderNoConvertSettings("INR", [trader1.id], {
          randomizer: {
            random_range: [100, 200],
            random_retries: 1,
            random_step: 100,
          },
          custom_payform: "upi",
          skip_processing_url: true,
          pay_expired_minutes: 1,
        }) as Record<string, any>;
        await merchant.set_settings(settings);
        let create = await merchant.create_payment({
          ...common.traderPaymentRequest("INR", "account"),
          redirect_success_url: "https://google.com/success",
          redirect_fail_url: "https://google.com/fail",
        });
        await ctx.annotate(create.selectorUrl ?? "");
      }));
  });

test
  .runIf(CONFIG.in_project(["reactivepay"]))
  .todo(
    "changed expires_in same amount",
    { timeout: 160_000 },
    ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: true,
          currency: "INR",
        });
        await trader.setup({ account: true, bank: "sberbank" });
        await trader.cashin("main", "USDT", 9999999999999);
        let settings = traderSettings([trader.id], {
          custom_payform: "upi",
          skip_processing_url: true,
          pay_expired_minutes: 30,
        });
        await merchant.set_settings(settings);
        await merchant.create_payment({
          ...common.traderPaymentRequest("INR", "account"),
        });

        let updated_settings = traderSettings([trader.id], {
          custom_payform: "upi",
          skip_processing_url: true,
          pay_expired_minutes: 1,
        });
        merchant.set_settings(updated_settings);
        await delay(95_000);
        await merchant.create_payment({
          ...common.traderPaymentRequest("INR", "account"),
        });
      }),
  );
