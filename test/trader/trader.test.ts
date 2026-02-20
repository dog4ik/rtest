import * as common from "@/common";
import * as assets from "@/assets";
import { traderSetttings } from "@/driver/trader";
import { CONFIG } from "@/config";
import { test } from "@/test_context";
import { delay } from "@std/async";
import { assert, describe } from "vitest";

describe
  .runIf(CONFIG.in_project(["reactivepay"]))
  .concurrent("trader tests", () => {
    test.concurrent("approve payin", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader();
        await trader.setup({ sbp: true, bank: "sberbank" });
        await trader.cashin("main", "USDT", common.amount / 100);
        await merchant.set_commission({
          operation: "PayinRequest",
          self_rate: "10",
          currency: "RUB",
        });
        await merchant.set_settings(traderSetttings([trader.id]));
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

        await delay(5_000);
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
        let trader = await ctx.create_random_trader();
        await trader.setup({ sbp: true, bank: "sberbank" });
        await trader.cashin("main", "USDT", common.amount / 100);
        await merchant.set_settings(traderSetttings([trader.id]));
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

        await delay(5_000);
        await trader.finalizeTransaction(res.token, "declined");
        await decline_cb;

        let wallets = await trader.wallets();
        assert.strictEqual(wallets.main.available, common.amount / 100);
        assert.strictEqual(wallets.main.held, 0);
      }),
    );

    test.concurrent("approve dispute", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader();
        await trader.setup({ sbp: true, bank: "sberbank" });
        await trader.cashin("main", "USDT", common.amount / 100);
        await merchant.set_settings(traderSetttings([trader.id]));
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

        await delay(5_000);
        await trader.finalizeTransaction(res.token, "declined");
        await decline_cb;

        let dispute_pending_notification = merchant.queue_notification((c) => {
          assert.strictEqual(c.status, "pending");
          assert.strictEqual(c.type, "dispute");
        });
        let dispute_approved_notification = merchant.queue_notification((c) => {
          assert.strictEqual(c.status, "approved");
          assert.strictEqual(c.type, "dispute");
        });
        await merchant.create_dispute({
          token: res.token,
          file_path: assets.PngImgPath,
          description: "test dispute",
        });

        await delay(5_000);
        let disputes = await ctx.get_disputes(res.token);
        await trader.finalize_dispute(disputes[0].dispute_id, "approved");
        await dispute_pending_notification;
        await dispute_approved_notification;
      }),
    );
  });
