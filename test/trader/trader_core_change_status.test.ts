import * as common from "@/common";
import { CONFIG } from "@/config";
import type { CreateTraderOptions } from "@/driver/core";
import { traderNoConvertSettings } from "@/driver/trader";
import { test } from "@/test_context";
import { delay } from "@std/async";
import { assert } from "vitest";
import { describe } from "vitest";

let opts: CreateTraderOptions = { usdt: false, payout_hold_period: 0 };

const TRADER_DELAY = 5_000;

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent(`trader core manage change status`, () => {
    test.concurrent(
      "payin with comission approved -> declined",
      ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(opts);
          await trader.setup({ card: true, bank: "sberbank" });
          trader.cashin("main", "RUB", common.amount / 100);
          await merchant.set_commission({
            operation: "PayinRequest",
            self_rate: "10",
            currency: "RUB",
            comment: "trader with commission",
          });
          await merchant.set_settings(
            traderNoConvertSettings("RUB", [trader.id]),
          );
          let approved_cb = merchant.queue_notification((n) => {
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
          await trader.finalizeTransaction(res.token, "approved");
          await approved_cb;

          let trader_wallets = await trader.wallets();
          assert.strictEqual(trader_wallets.main.available, 0);
          assert.strictEqual(
            trader_wallets.profit.available,
            (common.amount / 100) * 0.05,
          );
          assert.strictEqual(trader_wallets.main.held, 0);
          let merchant_wallet = (await merchant.wallets())[0];
          assert.strictEqual(
            merchant_wallet.available,
            common.amount / 100 - (common.amount / 100) * 0.1,
          );
          assert.strictEqual(merchant_wallet.held, 0);

          let core = ctx.shared_state().core_harness;
          let feed = await ctx.get_feed(res.token);
          assert.strictEqual(feed.status, 1, "feed should be approved");

          let declined_callback = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "pay");
            assert.strictEqual(n.status, "declined");
          });

          await delay(2_000);
          await core.change_status(feed.id, "declined");

          let updated_feed = await ctx.get_feed(res.token);
          assert.strictEqual(
            updated_feed.status,
            2,
            "feed should be changed to declined",
          );
          await ctx.healthcheck(res.token);
        }),
    );

    test.concurrent(
      "payin with commission declined -> approved",
      ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader(opts);
          await trader.setup({ card: true, bank: "sberbank" });
          trader.cashin("main", "RUB", common.amount / 100);
          await merchant.set_commission({
            operation: "PayinRequest",
            self_rate: "10",
            currency: "RUB",
            comment: "trader with commission",
          });
          await merchant.set_settings(
            traderNoConvertSettings("RUB", [trader.id]),
          );
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

          let trader_wallets = await trader.wallets();
          assert.strictEqual(
            trader_wallets.main.available,
            common.amount / 100,
          );
          assert.strictEqual(trader_wallets.main.held, 0);
          let merchant_wallet = (await merchant.wallets())[0];
          assert.strictEqual(merchant_wallet.available, 0);
          assert.strictEqual(merchant_wallet.held, 0);

          let core = ctx.shared_state().core_harness;
          let feed = await ctx.get_feed(res.token);
          assert.strictEqual(feed.status, 2, "feed should be declined");

          let approved_callback = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "pay");
            assert.strictEqual(n.status, "approved");
          });

          await delay(2_000);
          await core.change_status(feed.id, "approved");

          let updated_feed = await ctx.get_feed(res.token);
          assert.strictEqual(
            updated_feed.status,
            1,
            "feed should be changed to approved",
          );
          await ctx.healthcheck(res.token);
        }),
    );
  });
