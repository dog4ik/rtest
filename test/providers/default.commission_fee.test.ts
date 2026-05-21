import * as default_provider from "@/provider_mocks/default";
import { test } from "@/test_context";
import { delay } from "@std/async";
import { assert, describe } from "vitest";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { Context } from "@/test_context/context";

describe.concurrent(
  "default provider payin commission with fee: ChangeStateByStatus",
  () => {
    const AMOUNT = 100_000; // 1000 RUB in kopeyki
    const AMOUNT_RUB = AMOUNT / 100; // 1000 RUB
    const SELF_RATE = 0.1; // 10%
    const SELF_FEE = 50; // 50 RUB fixed fee
    const PROVIDER_RATE = 0.05; // 5%
    const PROVIDER_FEE = 25; // 25 RUB fixed provider fee
    const COMMISSION_RUB = AMOUNT_RUB * SELF_RATE + SELF_FEE; // 100 + 50 = 150 RUB
    const PROVIDER_COMMISSION_RUB = AMOUNT_RUB * PROVIDER_RATE + PROVIDER_FEE; // 50 + 25 = 75 RUB
    const MERCHANT_NET_RUB = AMOUNT_RUB - COMMISSION_RUB; // 850 RUB

    const PAID_AMOUNT_RUB = 750.0;
    const PAID_COMMISSION_RUB = PAID_AMOUNT_RUB * SELF_RATE + SELF_FEE; // 75 + 50 = 125 RUB
    const PAID_NET_RUB = PAID_AMOUNT_RUB - PAID_COMMISSION_RUB; // 625 RUB

    async function rubWallet(merchant: ExtendedMerchant) {
      let ws = await merchant.wallets("RUB");
      let w = ws.find((w) => w.currency === "RUB");
      return { available: w?.available ?? 0, held: w?.held ?? 0 };
    }

    async function setup(ctx: Context) {
      let merchant = await ctx.create_random_merchant();
      await merchant.set_commission({
        operation: "PayinRequest",
        self_rate: "10",
        self_fee: String(SELF_FEE),
        provider_rate: "5",
        provider_fee: String(PROVIDER_FEE),
      });
      await merchant.set_settings(default_provider.fullSettings("RUB"));
      return merchant;
    }

    test.concurrent(
      "approved → declined (fee + commission reversal)",
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let merchant = await setup(ctx);

          let approved_notification = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "pay");
            assert.strictEqual(n.status, "approved");
          });

          let response = await merchant.create_payment(
            default_provider.request("RUB", AMOUNT, "pay", true),
          );
          assert.strictEqual(response.payment.status, "approved");
          await approved_notification;

          assert.approximately(
            (await rubWallet(merchant)).available,
            MERCHANT_NET_RUB,
            0.01,
            "merchant: net amount after commission + fee",
          );
          assert.strictEqual((await rubWallet(merchant)).held, 0);

          let feed = await ctx.get_feed(response.token);
          assert.strictEqual(feed.status, 1, "feed: approved");
          assert.approximately(
            feed.commission_amount!,
            COMMISSION_RUB,
            0.01,
            "feed: commission_amount includes fee",
          );
          assert.approximately(
            feed.commission_fee!,
            SELF_FEE,
            0.01,
            "feed: commission_fee set",
          );
          assert.approximately(
            feed.amount,
            AMOUNT_RUB,
            0.01,
            "feed: original amount",
          );

          let declined_notification = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "pay");
            assert.strictEqual(n.status, "declined");
          });

          await delay(2_000);
          await ctx
            .shared_state()
            .core_harness.change_state_by_status(feed.id, "declined");
          await declined_notification;

          assert.deepEqual(
            await rubWallet(merchant),
            { available: 0, held: 0 },
            "merchant: funds reversed after decline",
          );

          let updated_feed = await ctx.get_feed(response.token);
          assert.strictEqual(
            updated_feed.status,
            2,
            "feed: changed to declined",
          );
          assert.strictEqual(
            updated_feed.commission_amount,
            0,
            "feed: commission_amount cleared after reversal",
          );
          assert.approximately(
            updated_feed.amount,
            AMOUNT_RUB,
            0.01,
            "feed: amount unchanged after reversal",
          );
        }),
    );

    test.concurrent(
      "declined → accepted with fee and amount change",
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let merchant = await setup(ctx);

          let declined_notification = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "pay");
            assert.strictEqual(n.status, "declined");
          });

          let response = await merchant.create_payment(
            default_provider.request("RUB", AMOUNT, "pay", false),
          );
          assert.strictEqual(response.payment.status, "declined");
          await declined_notification;

          assert.deepEqual(
            await rubWallet(merchant),
            { available: 0, held: 0 },
            "merchant: nothing after decline",
          );

          let feed = await ctx.get_feed(response.token);
          assert.strictEqual(feed.status, 2, "feed: declined");

          let approved_notification = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "pay");
            assert.strictEqual(n.status, "approved");
          });

          await delay(2_000);
          await ctx
            .shared_state()
            .core_harness.change_state_by_status(feed.id, "accepted", {
              paid_amount: PAID_AMOUNT_RUB,
              force_change: true,
            });
          await approved_notification;

          assert.approximately(
            (await rubWallet(merchant)).available,
            PAID_NET_RUB,
            0.01,
            "merchant: net of paid amount minus fee + commission",
          );
          assert.strictEqual((await rubWallet(merchant)).held, 0);

          let updated_feed = await ctx.get_feed(response.token);
          assert.strictEqual(
            updated_feed.status,
            1,
            "feed: changed to approved",
          );
          assert.approximately(
            updated_feed.amount,
            PAID_AMOUNT_RUB,
            0.01,
            "feed: amount changed to paid_amount",
          );
          assert.approximately(
            updated_feed.commission_amount!,
            PAID_COMMISSION_RUB,
            0.01,
            "feed: commission_amount recalculated with fee for new amount",
          );
          assert.approximately(
            updated_feed.commission_fee!,
            SELF_FEE,
            0.01,
            "feed: commission_fee unchanged after amount change",
          );
        }),
    );
  },
);

describe.concurrent(
  "default provider payout commission with fee: ChangeStateByStatus",
  () => {
    const AMOUNT = 100_000; // 1000 RUB in kopeyki
    const AMOUNT_RUB = AMOUNT / 100; // 1000 RUB
    const SELF_RATE = 0.1; // 10%
    const SELF_FEE = 50; // 50 RUB fixed fee
    const PROVIDER_RATE = 0.05; // 5%
    const PROVIDER_FEE = 25; // 25 RUB fixed provider fee
    const COMMISSION_RUB = AMOUNT_RUB * SELF_RATE + SELF_FEE; // 100 + 50 = 150 RUB
    const MERCHANT_CASHIN_RUB = AMOUNT_RUB + COMMISSION_RUB; // 1150 RUB

    async function rubWallet(merchant: ExtendedMerchant) {
      let ws = await merchant.wallets("RUB");
      let w = ws.find((w) => w.currency === "RUB");
      return { available: w?.available ?? 0, held: w?.held ?? 0 };
    }

    function payoutRequest() {
      return {
        ...default_provider.request("RUB", AMOUNT, "payout", true),
        order_number: crypto.randomUUID(),
      };
    }

    async function setup(ctx: Context) {
      let merchant = await ctx.create_random_merchant();
      await merchant.set_commission({
        operation: "PayoutRequest",
        self_rate: "10",
        self_fee: String(SELF_FEE),
        provider_rate: "5",
        provider_fee: String(PROVIDER_FEE),
      });
      await merchant.cashin("RUB", MERCHANT_CASHIN_RUB);
      await merchant.set_settings(default_provider.fullSettings("RUB"));
      return merchant;
    }

    test.concurrent(
      "approved → declined (fee + commission reversal)",
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let merchant = await setup(ctx);

          assert.deepEqual(
            await rubWallet(merchant),
            { available: MERCHANT_CASHIN_RUB, held: 0 },
            "after cashin",
          );

          let approved_notification = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "payout");
            assert.strictEqual(n.status, "approved");
          });

          let response = await merchant.create_payout(payoutRequest());
          assert.strictEqual(response.payout?.status, "approved");
          await approved_notification;

          assert.deepEqual(
            await rubWallet(merchant),
            { available: 0, held: 0 },
            "merchant: fully deducted (amount + fee + commission) after approval",
          );

          let feed = await ctx.get_feed(response.token);
          assert.strictEqual(feed.status, 1, "feed: approved");
          assert.approximately(
            feed.commission_amount!,
            COMMISSION_RUB,
            0.01,
            "feed: commission_amount includes fee",
          );
          assert.approximately(
            feed.commission_fee!,
            SELF_FEE,
            0.01,
            "feed: commission_fee set",
          );
          assert.approximately(
            feed.amount,
            AMOUNT_RUB,
            0.01,
            "feed: original amount",
          );

          let declined_notification = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "payout");
            assert.strictEqual(n.status, "declined");
          });

          await delay(2_000);
          await ctx
            .shared_state()
            .core_harness.change_state_by_status(feed.id, "declined");
          await declined_notification;

          assert.deepEqual(
            await rubWallet(merchant),
            { available: MERCHANT_CASHIN_RUB, held: 0 },
            "merchant: fully refunded (amount + fee + commission) after reversal",
          );

          let updated_feed = await ctx.get_feed(response.token);
          assert.strictEqual(
            updated_feed.status,
            2,
            "feed: changed to declined",
          );
          assert.strictEqual(
            updated_feed.commission_amount,
            0,
            "feed: commission_amount cleared after reversal",
          );
          assert.approximately(
            updated_feed.amount,
            AMOUNT_RUB,
            0.01,
            "feed: amount unchanged after reversal",
          );
        }),
    );

    test.concurrent(
      "declined payout with fee: merchant balance unchanged",
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let merchant = await setup(ctx);

          assert.deepEqual(
            await rubWallet(merchant),
            { available: MERCHANT_CASHIN_RUB, held: 0 },
            "after cashin",
          );

          let declined_notification = merchant.queue_notification((n) => {
            assert.strictEqual(n.type, "payout");
            assert.strictEqual(n.status, "declined");
          });

          let response = await merchant.create_payout({
            ...default_provider.request("RUB", AMOUNT, "payout", false),
            order_number: crypto.randomUUID(),
          });
          assert.strictEqual(response.payout?.status, "declined");
          await declined_notification;

          assert.deepEqual(
            await rubWallet(merchant),
            { available: MERCHANT_CASHIN_RUB, held: 0 },
            "merchant: funds fully returned after decline",
          );

          let feed = await ctx.get_feed(response.token);
          assert.strictEqual(feed.status, 2, "feed: declined");
          assert.approximately(
            feed.amount,
            AMOUNT_RUB,
            0.01,
            "feed: amount unchanged",
          );
        }),
    );
  },
);
