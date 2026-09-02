import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as assets from "@/assets";
import * as common from "@/common";
import { CONFIG, PROJECT } from "@/config";
import { traderNoConvertSettings, traderSettings } from "@/driver/trader";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { ExtendedTrader } from "@/entities/trader";
import { STATIC_RATE } from "@/provider_mocks/rate";
import { test } from "@/test_context";
import type { Context } from "@/test_context/context";

const TRADER_DELAY = 5_000;

for (let usdt of [true, false]) {
  let currency = usdt ? "USDT" : "RUB";
  describe
    .runIf(CONFIG.in_project(["reactivepay", "a2"]))
    .concurrent(`trader disputes (${currency})`, () => {
      const AMOUNT = 100_000;
      const request_amount = usdt ? AMOUNT * STATIC_RATE : AMOUNT;
      const AMOUNT_MAJOR = AMOUNT / 100;
      const DEPOSIT_AMOUNT = 50_00;
      const DEPOSIT_AMOUNT_MAJOR = DEPOSIT_AMOUNT / 100;
      const dispute_amount = usdt
        ? (DEPOSIT_AMOUNT + AMOUNT) * STATIC_RATE
        : DEPOSIT_AMOUNT + AMOUNT;

      async function merchantWallet(merchant: ExtendedMerchant) {
        let ws = await merchant.wallets(currency);
        let w = ws.find((w) => w.currency === currency);
        return { available: w?.available ?? 0, held: w?.held ?? 0 };
      }

      async function setup(ctx: Context) {
        let trader = await ctx.create_random_trader({
          usdt,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        let merchant = await ctx.create_random_merchant();
        await merchant.set_commission({
          operation: "PayinRequest",
          self_rate: "10",
          provider_rate: "5",
        });
        if (usdt) {
          await merchant.set_settings(traderSettings([trader.id]));
        } else {
          await merchant.set_settings(
            traderNoConvertSettings("RUB", [trader.id]),
          );
        }
        await trader.cashin("main", currency, AMOUNT_MAJOR);
        return { trader, merchant };
      }

      test.concurrent("approve dispute", ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let { trader, merchant } = await setup(ctx);
          merchant.set_commission({
            operation: "DisputeRequest",
            self_rate: "10",
            provider_rate: "5",
          });
          let decline_cb = merchant.queue_notification(
            (n) => {
              assert.strictEqual(n.status, "declined");
            },
            { skip_healthcheck: true },
          );
          let res = await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "card"),
              amount: request_amount,
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          await delay(TRADER_DELAY);
          await trader.finalizeTransaction(res.token, "declined");
          await decline_cb;

          let dispute_pending_notification =
            PROJECT === "a2"
              ? merchant.queue_notification(
                  (c) => {
                    assert.strictEqual(c.status, "pending");
                    assert.strictEqual(c.type, "dispute");
                  },
                  { skip_healthcheck: true },
                )
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
          await ctx.healthcheck(res.token);
        }));

      test.concurrent("declined dispute", ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let { trader, merchant } = await setup(ctx);
          merchant.set_commission({
            operation: "DisputeRequest",
            self_rate: "10",
            provider_rate: "5",
          });
          let decline_cb = merchant.queue_notification((n) => {
            assert.strictEqual(n.status, "declined");
          });
          let res = await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "card"),
              amount: request_amount,
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          await delay(TRADER_DELAY);
          await trader.finalizeTransaction(res.token, "declined");
          await decline_cb;

          let dispute_pending_notification =
            PROJECT === "a2"
              ? merchant.queue_notification(
                  (c) => {
                    assert.strictEqual(c.status, "pending");
                    assert.strictEqual(c.type, "dispute");
                  },
                  { skip_healthcheck: true },
                )
              : Promise.resolve(undefined);

          let dispute_declined_notification = merchant.queue_notification(
            (c) => {
              assert.strictEqual(c.status, "declined");
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
          await trader.finalize_dispute(disputes[0].dispute_id, "declined");
          await dispute_declined_notification;
          await ctx.healthcheck(res.token);
        }));

      test.concurrent("only one pending and successful dispute allowed", ({
        ctx,
      }) =>
        ctx.track_bg_rejections(async () => {
          let { trader, merchant } = await setup(ctx);
          merchant.set_commission({
            operation: "DisputeRequest",
            self_rate: "10",
            provider_rate: "5",
          });
          let decline_cb = merchant.queue_notification(
            (n) => {
              assert.strictEqual(n.status, "declined");
            },
            { skip_healthcheck: true },
          );
          let res = await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "card"),
              amount: request_amount,
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          await delay(TRADER_DELAY);
          await trader.finalizeTransaction(res.token, "declined");
          await decline_cb;

          let dispute_pending_notification =
            PROJECT === "a2"
              ? merchant.queue_notification(
                  (c) => {
                    assert.strictEqual(c.status, "pending");
                    assert.strictEqual(c.type, "dispute");
                  },
                  { skip_healthcheck: true },
                )
              : Promise.resolve(undefined);

          let dispute_declined_notification = merchant.queue_notification(
            (c) => {
              assert.strictEqual(c.status, "declined");
              assert.strictEqual(c.type, "dispute");
            },
          );

          await merchant.create_dispute({
            token: res.token,
            file_path: assets.PngImgPath,
            description: "test dispute",
          });

          await merchant.create_dispute_err({
            token: res.token,
            file_path: assets.PngImgPath,
            description: "test dispute",
          });

          await dispute_pending_notification;
          await delay(TRADER_DELAY);
          let disputes = await ctx.get_disputes(res.token);
          await trader.finalize_dispute(disputes[0].dispute_id, "declined");
          await dispute_declined_notification;

          let another_dispute_pending_notification =
            PROJECT === "a2"
              ? merchant.queue_notification(
                  (c) => {
                    assert.strictEqual(c.status, "pending");
                    assert.strictEqual(c.type, "dispute");
                  },
                  { skip_healthcheck: true },
                )
              : Promise.resolve(undefined);

          await merchant.create_dispute({
            token: res.token,
            file_path: assets.PngImgPath,
            description: "test dispute",
          });
          await another_dispute_pending_notification;

          let approved_dispute_notification = merchant.queue_notification(
            (c) => {
              assert.strictEqual(c.status, "approved");
              assert.strictEqual(c.type, "dispute");
            },
          );
          await ctx
            .get_disputes(res.token)
            .then((disputes) =>
              trader.finalize_dispute(disputes[1].dispute_id, "approved"),
            );
          await approved_dispute_notification;

          await merchant.create_dispute_err({
            token: res.token,
            file_path: assets.PngImgPath,
            description: "test dispute",
          });
          await ctx.healthcheck(res.token);
        }));

      test.concurrent("dispute on declined payin draws from deposit wallet", ({
        ctx,
      }) =>
        ctx.track_bg_rejections(async () => {
          let { trader, merchant } = await setup(ctx);

          await merchant.set_commission({
            operation: "DisputeRequest",
            self_rate: "10",
            provider_rate: "5",
          });

          await trader.cashin("deposit", currency, DEPOSIT_AMOUNT_MAJOR);

          let declined_notification = merchant.queue_notification((cb) => {
            assert.strictEqual(cb.type, "pay");
            assert.strictEqual(cb.status, "declined");
          });

          let res = await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "card"),
              amount: request_amount,
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          await delay(TRADER_DELAY);
          await trader.finalizeTransaction(res.token, "declined");
          await declined_notification;

          let dispute_pending_notification =
            PROJECT === "a2"
              ? merchant.queue_notification((c) => {
                  assert.strictEqual(c.status, "pending");
                  assert.strictEqual(c.type, "dispute");
                })
              : Promise.resolve();

          let dispute_approved_notification = merchant.queue_notification(
            (c) => {
              assert.strictEqual(c.status, "approved");
              assert.strictEqual(c.type, "dispute");
            },
          );

          await merchant.create_dispute({
            token: res.token,
            amount: dispute_amount,
            file_path: assets.PngImgPath,
            description: "test dispute",
          });

          await dispute_pending_notification;
          await delay(TRADER_DELAY);

          await trader.wallets().then(({ main, income, deposit }) => {
            assert.containSubset(
              main,
              { available: 0, held: AMOUNT_MAJOR },
              "main should be drained",
            );
            assert.containSubset(
              deposit,
              { available: 0, held: DEPOSIT_AMOUNT_MAJOR },
              "deposit should be used",
            );
            assert.containSubset(
              income,
              { available: 0, held: 0 },
              "commission should be empty",
            );
          });

          let disputes = await ctx.get_disputes(res.token);
          await trader.finalize_dispute(disputes[0].dispute_id, "approved");
          await dispute_approved_notification;

          await trader.wallets().then((wallets) => {
            assert.containSubset(
              wallets,
              {
                main: { available: 0, held: 0 },
                deposit: { available: 0, held: 0 },
                // commission for dispute
                income: { available: 52.5, held: 0 },
              },
              "trader: dispute shortfall drawn from deposit wallet (stays positive)",
            );
          });
          assert.deepEqual(
            await merchantWallet(merchant),
            { available: 945, held: 0 },
            "merchant: credited net dispute amount",
          );
          await ctx.healthcheck(res.token);
        }));
    });
}

for (let usdt of [true, false]) {
  let currency = usdt ? "USDT" : "RUB";
  describe
    .runIf(CONFIG.in_project(["a2"]))
    .concurrent(`negative deposit balance tests (${currency})`, () => {
      const AMOUNT = 100_00;
      const AMOUNT_MAJOR = AMOUNT / 100;
      const PAYIN_AMOUNT = 10_00;
      const DISPUTE_AMOUNT = 100_00;
      const request_amount = usdt ? AMOUNT * STATIC_RATE : AMOUNT;
      const payin_amount = usdt ? PAYIN_AMOUNT * STATIC_RATE : PAYIN_AMOUNT;
      const dispute_amount = usdt
        ? DISPUTE_AMOUNT * STATIC_RATE
        : DISPUTE_AMOUNT;

      async function merchantWallet(merchant: ExtendedMerchant) {
        let ws = await merchant.wallets(currency);
        let w = ws.find((w) => w.currency === currency);
        return { available: w?.available ?? 0, held: w?.held ?? 0 };
      }

      /** A trader and merchant wired up for disputes, with `main` funded. */
      async function setup(ctx: Context, main_cashin: number) {
        let trader = await ctx.create_random_trader({ usdt });
        await trader.setup({ card: true, bank: "sberbank" });
        let merchant = await ctx.create_random_merchant();
        await merchant.set_commission({
          operation: "DisputeRequest",
          self_rate: "10",
          provider_rate: "5",
        });
        if (usdt) {
          await merchant.set_settings(traderSettings([trader.id]));
        } else {
          await merchant.set_settings(
            traderNoConvertSettings("RUB", [trader.id]),
          );
        }
        await trader.cashin("main", currency, main_cashin);
        return { trader, merchant };
      }

      /**
       * Creates a payin and declines it, returning its token so a dispute can
       * be raised against it later.
       */
      async function declined_payin(
        trader: ExtendedTrader,
        merchant: ExtendedMerchant,
      ) {
        let declined_notification = merchant.queue_notification((cb) => {
          assert.strictEqual(cb.type, "pay");
          assert.strictEqual(cb.status, "declined");
        });
        let res = await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: payin_amount,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        await delay(TRADER_DELAY);
        await trader.finalizeTransaction(res.token, "declined");
        await declined_notification;
        return res.token;
      }

      test.concurrent("dispute creation with empty deposit drives deposit wallet negative", ({
        ctx,
      }) =>
        ctx.track_bg_rejections(async () => {
          let { trader, merchant } = await setup(ctx, 10);
          let token = await declined_payin(trader, merchant);

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
            token,
            amount: dispute_amount,
            file_path: assets.PngImgPath,
            description: "test dispute",
          });

          await dispute_pending_notification;
          await delay(TRADER_DELAY);
          let disputes = await ctx.get_disputes(token);
          await trader.finalize_dispute(disputes[0].dispute_id, "approved");
          await dispute_approved_notification;

          let wallets = await trader.wallets();
          assert.containSubset(
            wallets,
            {
              main: { available: 0, held: 0 },
              income: { available: 5, held: 0 },
              // 10 from main + 90 from deposit = 100 dispute, deposit funded
              // with 0 -> -90.
              deposit: { available: -90, held: 0 },
            },
            "trader: dispute drained main and pushed deposit negative",
          );
          assert.deepEqual(
            await merchantWallet(merchant),
            { available: 90, held: 0 },
            "merchant: credited net dispute amount",
          );
        }));

      test.concurrent("dispute creation does not affect income wallet", ({
        ctx,
      }) =>
        ctx.track_bg_rejections(async () => {
          let { trader, merchant } = await setup(ctx, 10);
          await trader.cashin("income", currency, 50);

          let token = await declined_payin(trader, merchant);

          // Drain the main wallet so the dispute cannot draw anything from it and
          // is forced entirely onto the deposit wallet.
          await trader.cashout("main", currency, 10);
          await trader.wallets().then(({ main, income, deposit }) => {
            assert.containSubset(
              main,
              { available: 0, held: 0 },
              "main should be drained",
            );
            assert.containSubset(
              deposit,
              { available: 0, held: 0 },
              "deposit is empty",
            );
            assert.containSubset(
              income,
              { available: 50, held: 0 },
              "income wallet seeded",
            );
          });

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
            token,
            amount: dispute_amount,
            file_path: assets.PngImgPath,
            description: "test dispute",
          });

          await dispute_pending_notification;
          await delay(TRADER_DELAY);

          // The pending dispute holds the full 100 from the deposit wallet,
          // pushing it negative. The income wallet is left completely untouched.
          await trader.wallets().then(({ main, income, deposit }) => {
            assert.containSubset(
              main,
              { available: 0, held: 0 },
              "main stays empty",
            );
            assert.containSubset(
              deposit,
              { available: -100, held: 100 },
              "deposit absorbs the whole dispute",
            );
            assert.containSubset(
              income,
              { available: 50, held: 0 },
              "income wallet untouched",
            );
          });

          let disputes = await ctx.get_disputes(token);
          await trader.finalize_dispute(disputes[0].dispute_id, "approved");
          await dispute_approved_notification;

          let wallets = await trader.wallets();
          assert.containSubset(
            wallets,
            {
              main: { available: 0, held: 0 },
              // 50 seeded + 5 dispute commission; the shortfall never touched
              // it.
              income: { available: 55, held: 0 },
              // Entire 100 dispute drawn from deposit -> -100.
              deposit: { available: -100, held: 0 },
            },
            "trader: dispute shortfall drawn from deposit, income wallet preserved",
          );
          // 100 dispute net of 10% self commission.
          assert.deepEqual(
            await merchantWallet(merchant),
            { available: 90, held: 0 },
            "merchant: credited net dispute amount",
          );
        }));

      test.concurrent("second dispute can be created after deposit went negative", ({
        ctx,
      }) =>
        ctx.track_bg_rejections(async () => {
          let { trader, merchant } = await setup(ctx, 10);

          // Raise a 100 dispute against the given payin and approve it.
          async function approve_dispute(token: string) {
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
              token,
              amount: dispute_amount,
              file_path: assets.PngImgPath,
              description: "test dispute",
            });
            await dispute_pending_notification;
            await delay(TRADER_DELAY);
            let disputes = await ctx.get_disputes(token);
            await trader.finalize_dispute(disputes[0].dispute_id, "approved");
            await dispute_approved_notification;
          }

          let first_token = await declined_payin(trader, merchant);
          let second_token = await declined_payin(trader, merchant);

          await trader.cashout("main", currency, 10);
          await trader.wallets().then(({ main, deposit }) => {
            assert.containSubset(
              main,
              { available: 0, held: 0 },
              "main should be drained",
            );
            assert.containSubset(
              deposit,
              { available: 0, held: 0 },
              "deposit starts empty",
            );
          });

          // First dispute pushes the deposit wallet negative.
          await approve_dispute(first_token);
          await trader.wallets().then(({ main, income, deposit }) => {
            assert.containSubset(
              main,
              { available: 0, held: 0 },
              "main stays empty",
            );
            assert.containSubset(
              deposit,
              { available: -100, held: 0 },
              "deposit driven negative",
            );
            assert.containSubset(
              income,
              { available: 5, held: 0 },
              "commission applied",
            );
          });

          // Second dispute is accepted even though the deposit wallet is already
          // negative, driving it further down.
          await approve_dispute(second_token);
          let wallets = await trader.wallets();
          assert.containSubset(
            wallets,
            {
              main: { available: 0, held: 0 },
              income: { available: 10, held: 0 },
              // Both 100 disputes drawn from deposit -> -200.
              deposit: { available: -200, held: 0 },
            },
            "trader: second dispute drew from an already-negative deposit wallet",
          );
          // Two 100 disputes, each net of 10% self commission.
          assert.deepEqual(
            await merchantWallet(merchant),
            { available: 180, held: 0 },
            "merchant: credited net amount of both disputes",
          );
        }));

      test.concurrent("concurrent disputes racing for main balance both succeed", ({
        ctx,
      }) =>
        ctx.track_bg_rejections(async () => {
          // Enough main balance to cover exactly one of the two disputes, so
          // the two dispute holds contend for it.
          let { trader, merchant } = await setup(ctx, 100);

          let tokens = [
            await declined_payin(trader, merchant),
            await declined_payin(trader, merchant),
          ];

          let pending_notifications =
            PROJECT === "a2"
              ? Promise.all(
                  tokens.map(() =>
                    merchant.queue_notification(
                      (c) => {
                        assert.strictEqual(c.status, "pending");
                        assert.strictEqual(c.type, "dispute");
                      },
                      { skip_healthcheck: true, timeout: 20_000 },
                    ),
                  ),
                )
              : Promise.resolve(undefined);

          let approved_notifications = Promise.all(
            tokens.map(() =>
              merchant.queue_notification(
                (c) => {
                  assert.strictEqual(c.status, "approved");
                  assert.strictEqual(c.type, "dispute");
                },
                { skip_healthcheck: true, timeout: 20_000 },
              ),
            ),
          );

          await Promise.all(
            tokens.map((token) =>
              merchant.create_dispute({
                token,
                amount: dispute_amount,
                file_path: assets.PngImgPath,
                description: "test dispute",
              }),
            ),
          );

          await pending_notifications;
          await delay(TRADER_DELAY);

          for (let token of tokens) {
            let disputes = await ctx.get_disputes(token);
            await trader.finalize_dispute(disputes[0].dispute_id, "approved");
          }
          await approved_notifications;

          let wallets = await trader.wallets();
          assert.containSubset(
            wallets,
            {
              main: { available: 0, held: 0 },
              income: { available: 10, held: 0 },
              // One dispute drew 100 from main, the other pushed deposit to -100.
              deposit: { available: -100, held: 0 },
            },
            "trader: concurrent disputes split across main and deposit without loss",
          );
          // Two 100 disputes, each net of 10% self commission.
          assert.deepEqual(
            await merchantWallet(merchant),
            { available: 180, held: 0 },
            "merchant: credited net amount of both disputes",
          );
        }));

      test.concurrent("dispute declined with insufficient main balance restores balances", ({
        ctx,
      }) =>
        ctx.track_bg_rejections(async () => {
          let { trader, merchant } = await setup(ctx, 10);
          let token = await declined_payin(trader, merchant);

          let dispute_pending_notification =
            PROJECT === "a2"
              ? merchant.queue_notification(
                  (c) => {
                    assert.strictEqual(c.status, "pending");
                    assert.strictEqual(c.type, "dispute");
                  },
                  { skip_healthcheck: true, timeout: 20_000 },
                )
              : Promise.resolve(undefined);

          let dispute_declined_notification = merchant.queue_notification(
            (c) => {
              assert.strictEqual(c.status, "declined");
              assert.strictEqual(c.type, "dispute");
            },
            { skip_healthcheck: true, timeout: 20_000 },
          );

          await merchant.create_dispute({
            token,
            amount: dispute_amount,
            file_path: assets.PngImgPath,
            description: "test dispute",
          });

          await dispute_pending_notification;
          await delay(TRADER_DELAY);
          let disputes = await ctx.get_disputes(token);
          await trader.finalize_dispute(disputes[0].dispute_id, "declined");
          await dispute_declined_notification;

          let wallets = await trader.wallets();
          assert.containSubset(
            wallets,
            {
              main: { available: 10, held: 0 },
              income: { available: 0, held: 0 },
              deposit: { available: 0, held: 0 },
            },
            "trader: declined dispute releases both holds and restores balances",
          );
          assert.deepEqual(
            await merchantWallet(merchant),
            { available: 0, held: 0 },
            "merchant: nothing credited for a declined dispute",
          );
        }));

      test.concurrent("concurrent duplicate disputes on the same declined payin create only one dispute", ({
        ctx,
      }) =>
        ctx.track_bg_rejections(async () => {
          let { trader, merchant } = await setup(ctx, AMOUNT_MAJOR);
          await merchant.set_commission({
            operation: "PayinRequest",
            self_rate: "10",
            provider_rate: "5",
          });

          let decline_cb = merchant.queue_notification(
            (n) => {
              assert.strictEqual(n.status, "declined");
            },
            { skip_healthcheck: true },
          );

          let res = await merchant
            .create_payment({
              ...common.traderPaymentRequest("RUB", "card"),
              amount: request_amount,
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          await delay(TRADER_DELAY);
          await trader.finalizeTransaction(res.token, "declined");
          await decline_cb;

          // Only the winning dispute may reach the trader, so a single pending
          // notification is expected.
          let dispute_pending_notification =
            PROJECT === "a2"
              ? merchant.queue_notification(
                  (c) => {
                    assert.strictEqual(c.status, "pending");
                    assert.strictEqual(c.type, "dispute");
                  },
                  { skip_healthcheck: true, timeout: 20_000 },
                )
              : Promise.resolve(undefined);

          let dispute_request = {
            token: res.token,
            file_path: assets.PngImgPath,
            description: "test dispute",
          };
          let responses = await Promise.all([
            merchant.create_dispute_raw(dispute_request),
            merchant.create_dispute_raw(dispute_request),
          ]);

          let winners = responses.filter((r) => r.is_ok());
          let losers = responses.filter((r) => !r.is_ok());
          assert.strictEqual(
            winners.length,
            1,
            "exactly one dispute request must succeed",
          );
          assert.strictEqual(
            losers.length,
            1,
            "the duplicate concurrent dispute request must be rejected",
          );
          winners[0].as_ok();
          losers[0]
            .as_error()
            .as_common_error()
            .assert_error([
              { code: "payment_already_has_pending_dispute", kind: "" },
            ]);

          await dispute_pending_notification;
          await delay(TRADER_DELAY);

          // The definitive check: the unlocked-read race would leave two dispute
          // rows for the payin; only a single dispute may ever exist.
          let disputes = await ctx.get_disputes(res.token);
          assert.strictEqual(
            disputes.length,
            1,
            "only a single dispute row must exist for the declined payin",
          );
        }));
    });
}
