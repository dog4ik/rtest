import * as common from "@/common";
import * as assets from "@/assets";
import { traderSetttings } from "@/driver/trader";
import { CONFIG } from "@/config";
import { test } from "@/test_context";
import { delay } from "@std/async";
import { assert, describe } from "vitest";

const TRADER_DELAY = 5_000;

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
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
          comment: "trader with commission",
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

    test.concurrent("approve double processingUrl", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader();
        await trader.setup({ card: true, bank: "sberbank" });
        await trader.cashin("main", "USDT", common.amount / 100);
        await merchant.set_commission({
          operation: "PayinRequest",
          self_rate: "10",
          currency: "RUB",
          comment: "trader with commission",
        });
        await merchant.set_settings(traderSetttings([trader.id]));
        let approve_cb = merchant.queue_notification((n) => {
          assert.strictEqual(n.status, "approved");
        });
        let res = await merchant.create_payment({
          ...common.paymentRequest("RUB"),
          bank_account: {
            requisite_type: "card",
          },
        });
        let [first, second] = await Promise.all([
          res.followFirstProcessingUrl().then((r) => r.as_raw_json()),
          res.followFirstProcessingUrl().then((r) => r.as_raw_json()),
        ]);
        console.log({first, second});

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

        await delay(TRADER_DELAY);
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

        await delay(TRADER_DELAY);
        let disputes = await ctx.get_disputes(res.token);
        await trader.finalize_dispute(disputes[0].dispute_id, "approved");
        await dispute_pending_notification;
        await dispute_approved_notification;
      }),
    );

    test.concurrent("card payin data flow", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader();
        await trader.setup({ card: true, bank: "sberbank" });
        await trader.cashin("main", "USDT", common.amount / 100);
        await merchant.set_settings(traderSetttings([trader.id]));
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
        let trader = await ctx.create_random_trader();
        await trader.setup({ link: true, bank: "sberbank" });
        await trader.cashin("main", "USDT", common.amount / 100);
        await merchant.set_settings(traderSetttings([trader.id]));
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
        let trader = await ctx.create_random_trader();
        await trader.setup({ sbp: true, bank: "sberbank" });
        await trader.cashin("main", "USDT", common.amount / 100);
        await merchant.set_settings(traderSetttings([trader.id]));
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
        let trader = await ctx.create_random_trader();
        await trader.setup({ account: true, bank: "sberbank" });
        await trader.cashin("main", "USDT", common.amount / 100);
        await merchant.set_settings(traderSetttings([trader.id]));
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
        let trader = await ctx.create_random_trader();
        await trader.setup({ card: true, bank: "sberbank" });
        await merchant.set_settings(traderSetttings([trader.id]));
        await merchant.cashin("USDT", common.amount / 100);
        await trader.cashin("main", "USDT", common.amount / 100);
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
  });
