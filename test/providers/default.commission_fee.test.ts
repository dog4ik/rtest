import { assert, describe } from "vitest";
import type { ExtendedMerchant } from "@/entities/merchant";
import * as default_provider from "@/provider_mocks/default";
import { test } from "@/test_context";
import type { Context } from "@/test_context/context";

describe.concurrent("default provider payout commission with fee: ChangeStateByStatus", () => {
  const AMOUNT = 100_000; // 1000 RUB in kopeyki
  const AMOUNT_RUB = AMOUNT / 100; // 1000 RUB
  const SELF_RATE = 0.1; // 10%
  const SELF_FEE = 50; // 50 RUB fixed fee
  const PROVIDER_FEE = 25; // 25 RUB fixed provider fee
  const COMMISSION_RUB = AMOUNT_RUB * SELF_RATE + SELF_FEE; // 100 + 50 = 150 RUB
  const MERCHANT_CASHIN_RUB = AMOUNT_RUB + COMMISSION_RUB; // 1150 RUB

  async function rubWallet(merchant: ExtendedMerchant) {
    let ws = await merchant.wallets("RUB");
    let w = ws.find((w) => w.currency === "RUB");
    return { available: w?.available ?? 0, held: w?.held ?? 0 };
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

  test.concurrent("declined payout with fee: merchant balance unchanged", ({
    ctx,
  }) =>
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
    }));
});
