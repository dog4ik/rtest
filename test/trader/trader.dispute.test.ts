import * as common from "@/common";
import * as assets from "@/assets";
import { traderNoConvertSettings } from "@/driver/trader";
import { test } from "@/test_context";
import { delay } from "@std/async";
import { assert, describe } from "vitest";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { Context } from "@/test_context/context";
import { CONFIG, PROJECT } from "@/config";

const TRADER_DELAY = 5_000;

describe.runIf(CONFIG.in_project(["reactivepay", "a2"])).concurrent("trader disputes", () => {
  const AMOUNT = 100_000;
  const AMOUNT_RUB = AMOUNT / 100; // 1000 RUB

  async function merchantWallet(merchant: ExtendedMerchant) {
    let ws = await merchant.wallets("RUB");
    let w = ws.find((w) => w.currency === "RUB");
    return { available: w?.available ?? 0, held: w?.held ?? 0 };
  }

  async function setup(ctx: Context) {
    let trader = await ctx.create_random_trader({
      usdt: false,
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
          amount: AMOUNT,
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

      let dispute_approved_notification = merchant.queue_notification((c) => {
        assert.strictEqual(c.status, "approved");
        assert.strictEqual(c.type, "dispute");
      });
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
          amount: AMOUNT,
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

      let dispute_declined_notification = merchant.queue_notification((c) => {
        assert.strictEqual(c.status, "declined");
        assert.strictEqual(c.type, "dispute");
      });
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
    }));

  test
    .runIf(CONFIG.in_project(["a2"]))
    .concurrent("dispute on approved payin draws from deposit wallet", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let PAYIN_AMOUNT = 100_00;
        let DISPUTE_AMOUNT = 100_00;

        let trader = await ctx.create_random_trader({
          usdt: false,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        let merchant = await ctx.create_random_merchant();
        await merchant.set_commission({
          operation: "PayinRequest",
          self_rate: "10",
          provider_rate: "5",
        });
        await merchant.set_commission({
          operation: "DisputeRequest",
          self_rate: "10",
          provider_rate: "5",
        });

        await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

        await trader.cashin("main", "RUB", 100);
        await trader.cashin("deposit", "RUB", 50);

        let approved_notification = merchant.queue_notification((cb) => {
          assert.strictEqual(cb.type, "pay");
          assert.strictEqual(cb.status, "approved");
        });

        let res = await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: PAYIN_AMOUNT,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        await delay(TRADER_DELAY);
        await trader.finalizeTransaction(res.token, "approved");
        await approved_notification;
        await trader.wallets().then(({ main, profit, deposit }) => {
          assert.containSubset(main, { available: 0, held: 0 }, "main should be empty");
          assert.containSubset(deposit, { available: 50, held: 0 }, "deposit is untouched");
          assert.containSubset(profit, { available: 5, held: 0 }, "commission should be applied");
        });

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

        // Deposit wallet goes negative, so the entry-replay healthcheck (which
        // does not model the deposit draw-down) is skipped; balances are
        // asserted directly instead.
        let dispute_approved_notification = merchant.queue_notification(
          (c) => {
            assert.strictEqual(c.status, "approved");
            assert.strictEqual(c.type, "dispute");
          },
          { skip_healthcheck: true },
        );

        await merchant.create_dispute({
          token: res.token,
          amount: DISPUTE_AMOUNT,
          file_path: assets.PngImgPath,
          description: "test dispute",
        });

        await dispute_pending_notification;
        await delay(TRADER_DELAY);

        await trader.wallets().then(({ main, profit, deposit }) => {
          assert.containSubset(main, { available: 0, held: 0 }, "main should be empty");
          assert.containSubset(deposit, { available: -50, held: 100 }, "deposit should be used");
          assert.containSubset(profit, { available: 5, held: 0 }, "commission should be applied");
        });

        let disputes = await ctx.get_disputes(res.token);
        await trader.finalize_dispute(disputes[0].dispute_id, "approved");
        await dispute_approved_notification;

        await trader.wallets().then((wallets) => {
          assert.containSubset(
            wallets,
            {
              main: { available: 0, held: 0 },
              deposit: { available: -50, held: 0 },
              profit: { available: 10, held: 0 },
            },
            "trader: dispute shortfall drawn from deposit wallet (negative)",
          );
        });

        assert.deepEqual(
          await merchantWallet(merchant),
          { available: 180, held: 0 },
          "merchant: credited net payin + net dispute amount",
        );
      }),
    );

  test.concurrent("dispute on declined payin draws from deposit wallet", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let trader = await ctx.create_random_trader({
        usdt: false,
      });

      await trader.setup({ card: true, bank: "sberbank" });
      let merchant = await ctx.create_random_merchant();

      await merchant.set_commission({
        operation: "DisputeRequest",
        self_rate: "10",
        provider_rate: "5",
      });

      await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

      await trader.cashin("main", "RUB", 10);
      await trader.cashin("deposit", "RUB", 95);

      let declined_notification = merchant.queue_notification((cb) => {
        assert.strictEqual(cb.type, "pay");
        assert.strictEqual(cb.status, "declined");
      });

      let res = await merchant
        .create_payment({
          ...common.traderPaymentRequest("RUB", "card"),
          amount: 10_00,
        })
        .then((r) => r.followFirstProcessingUrl())
        .then((r) => r.as_trader_requisites());

      await delay(TRADER_DELAY);
      await trader.finalizeTransaction(res.token, "declined");
      await declined_notification;

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
        { skip_healthcheck: true },
      );

      await merchant.create_dispute({
        token: res.token,
        amount: 100_00,
        file_path: assets.PngImgPath,
        description: "test dispute",
      });

      await dispute_pending_notification;
      await delay(TRADER_DELAY);

      await trader.wallets().then(({ main, profit, deposit }) => {
        assert.containSubset(main, { available: 0, held: 10 }, "main should be drained");
        assert.containSubset(deposit, { available: 5, held: 90 }, "deposit should be used");
        assert.containSubset(profit, { available: 0, held: 0 }, "commission should be empty");
      });

      let disputes = await ctx.get_disputes(res.token);
      await trader.finalize_dispute(disputes[0].dispute_id, "approved");
      await dispute_approved_notification;

      await trader.wallets().then((wallets) => {
        assert.containSubset(
          wallets,
          {
            main: { available: 0, held: 0 },
            deposit: { available: 5, held: 0 },
            profit: { available: 5, held: 0 },
          },
          "trader: dispute shortfall drawn from deposit wallet (stays positive)",
        );
      });
      // 100 RUB dispute net of 10% self commission.
      assert.deepEqual(
        await merchantWallet(merchant),
        { available: 90, held: 0 },
        "merchant: credited net dispute amount",
      );
    }));

  // Headline requirement: a merchant can create (and win) a dispute even when
  // the trader's deposit wallet is empty - the deposit wallet is allowed to go
  // negative. Funding: main 10 RUB, deposit 0. A 100 RUB dispute draws 10 RUB
  // from main and pushes the deposit wallet to -90 RUB.
  test.concurrent("dispute creation with empty deposit drives deposit wallet negative", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let trader = await ctx.create_random_trader({
        usdt: false,
      });

      await trader.setup({ card: true, bank: "sberbank" });
      let merchant = await ctx.create_random_merchant();

      await merchant.set_commission({
        operation: "DisputeRequest",
        self_rate: "10",
        provider_rate: "5",
      });

      await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

      await trader.cashin("main", "RUB", 10);

      let declined_notification = merchant.queue_notification((cb) => {
        assert.strictEqual(cb.type, "pay");
        assert.strictEqual(cb.status, "declined");
      });

      let res = await merchant
        .create_payment({
          ...common.traderPaymentRequest("RUB", "card"),
          amount: 10_00,
        })
        .then((r) => r.followFirstProcessingUrl())
        .then((r) => r.as_trader_requisites());

      await delay(TRADER_DELAY);
      await trader.finalizeTransaction(res.token, "declined");
      await declined_notification;

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
        { skip_healthcheck: true },
      );

      await merchant.create_dispute({
        token: res.token,
        amount: 100_00,
        file_path: assets.PngImgPath,
        description: "test dispute",
      });

      await dispute_pending_notification;
      await delay(TRADER_DELAY);
      let disputes = await ctx.get_disputes(res.token);
      await trader.finalize_dispute(disputes[0].dispute_id, "approved");
      await dispute_approved_notification;

      let wallets = await trader.wallets();
      assert.containSubset(
        wallets,
        {
          main: { available: 0, held: 0 },
          profit: { available: 5, held: 0 },
          // 10 RUB from main + 90 RUB from deposit = 100 RUB dispute,
          // deposit funded with 0 -> -90.
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

  test.concurrent("dispute declined with insufficient main balance restores balances", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let trader = await ctx.create_random_trader({
        usdt: false,
      });

      await trader.setup({ card: true, bank: "sberbank" });
      let merchant = await ctx.create_random_merchant();

      await merchant.set_commission({
        operation: "DisputeRequest",
        self_rate: "10",
        provider_rate: "5",
      });

      await merchant.set_settings(traderNoConvertSettings("RUB", [trader.id]));

      await trader.cashin("main", "RUB", 10);

      let declined_notification = merchant.queue_notification((cb) => {
        assert.strictEqual(cb.type, "pay");
        assert.strictEqual(cb.status, "declined");
      });

      let res = await merchant
        .create_payment({
          ...common.traderPaymentRequest("RUB", "card"),
          amount: 10_00,
        })
        .then((r) => r.followFirstProcessingUrl())
        .then((r) => r.as_trader_requisites());

      await delay(TRADER_DELAY);
      await trader.finalizeTransaction(res.token, "declined");
      await declined_notification;

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

      // On the current branch the decline never completes (rejection_process
      // raises NoBalance and rolls back), so this notification never arrives.
      // Bound the wait so the regression fails fast instead of hitting the
      // 90s global test timeout.
      let dispute_declined_notification = merchant.queue_notification(
        (c) => {
          assert.strictEqual(c.status, "declined");
          assert.strictEqual(c.type, "dispute");
        },
        { skip_healthcheck: true, timeout: 20_000 },
      );

      await merchant.create_dispute({
        token: res.token,
        amount: 100_00,
        file_path: assets.PngImgPath,
        description: "test dispute",
      });

      await dispute_pending_notification;
      await delay(TRADER_DELAY);
      let disputes = await ctx.get_disputes(res.token);
      await trader.finalize_dispute(disputes[0].dispute_id, "declined");
      await dispute_declined_notification;

      let wallets = await trader.wallets();
      assert.containSubset(
        wallets,
        {
          main: { available: 10, held: 0 },
          profit: { available: 0, held: 0 },
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
});
