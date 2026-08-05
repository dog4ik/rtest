import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { payoutSuite } from "@/provider_mocks/gateway_connect";
import {
  callbackFinalizationSuite,
  defaultSuite,
  payoutPendingSuite,
  providersSuite,
  statusFinalizationSuite,
} from "@/suite_interfaces";
import { test } from "@/test_context";

let p2pSuite = () => providersSuite("RUB", payoutSuite());
let ecomSuite = () => {
  let suite = payoutSuite();
  return defaultSuite("RUB", {
    ...suite,
    request: () => ({ ...suite.request(), card: { pan: common.visaCard } }),
  });
};

callbackFinalizationSuite(p2pSuite);
statusFinalizationSuite(p2pSuite);
payoutPendingSuite(p2pSuite());

callbackFinalizationSuite(ecomSuite, { tag: "ecom" });
statusFinalizationSuite(ecomSuite, { tag: "ecom" });
payoutPendingSuite(ecomSuite(), { tag: "ecom" });

test.concurrent("gatewayconnect payout no balance for commission", ({ ctx }) =>
  ctx.track_bg_rejections(async () => {
    let suite = providersSuite("RUB", payoutSuite());
    let merchant = await ctx.create_random_merchant();
    await merchant.set_commission({
      self_rate: (10).toString(),
      provider_rate: (5).toString(),
      operation: "PayoutRequest",
    });
    await merchant.cashin("RUB", (common.amount / 100) * 2 + 1000);
    await merchant.set_settings(suite.settings(ctx.uuid));
    let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

    provider.queue(suite.create_handler("pending", { ctx, provider }));
    provider.queue(suite.create_handler("pending", { ctx, provider }));

    let payout = await merchant
      .create_payout(suite.request())
      .then((r) => r.followFirstProcessingUrl())
      .then((r) => r.as_payout_response());
    await ctx.healthcheck(payout.token);
  }));

test
  .runIf(CONFIG.in_project(["reactivepay"]))
  .todo(
    "concurrent payout requests don't overdraft merchant balance",
    ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let suite = providersSuite("RUB", payoutSuite("RUB"));
        let gateway = ctx.mock_server(suite.mock_options(ctx.uuid));
        await merchant.set_settings(suite.settings(ctx.uuid));
        await merchant.cashin("RUB", common.amount / 100);

        let pending = gateway.queue(suite.gw.basic_payout_handler("pending"));
        let unreachable = gateway.queue((_) => {
          assert.fail("gateway should not be reached twice");
        });

        let [init1, init2] = await Promise.all([
          merchant.create_payout(suite.request()),
          merchant.create_payout(suite.request()),
        ]);

        let [res1, res2] = await Promise.all([
          init1.followFirstProcessingUrl(),
          init2.followFirstProcessingUrl(),
        ]);

        await res1.as_raw_json();
        await res2.as_raw_json();
        await pending;
        await Promise.race([unreachable, delay(1000)]);
      }),
  );

describe.concurrent("commission healthcheck payouts", () => {
  const AMOUNT = 100_000; // 1000 RUB in kopeyki
  const AMOUNT_RUB = AMOUNT / 100; // 1000 RUB
  const SELF_RATE = 0.1; // 10%
  const COMMISSION_RUB = AMOUNT_RUB * SELF_RATE; // 100 RUB

  function commissionPayoutSuite() {
    let suite = payoutSuite();
    return providersSuite("RUB", {
      ...suite,
      request: () => ({
        ...suite.request(),
        amount: AMOUNT,
      }),
    });
  }

  async function rubWallet(merchant: {
    wallets(
      c: string,
    ): Promise<
      Array<{ available: number; held: number; currency: string | null }>
    >;
  }) {
    let ws = await merchant.wallets("RUB");
    let w = ws.find((w) => w.currency === "RUB");
    return { available: w?.available ?? 0, held: w?.held ?? 0 };
  }

  test.concurrent("instantly declined payout with commission", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let suite = commissionPayoutSuite();
      let merchant = await ctx.create_random_merchant();
      await merchant.set_commission({ operation: "PayoutRequest" });
      await merchant.cashin("RUB", AMOUNT_RUB + COMMISSION_RUB);
      assert.deepEqual(
        await rubWallet(merchant),
        { available: 1100, held: 0 },
        "after cashin",
      );
      await merchant.set_settings(suite.settings(ctx.uuid));
      let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

      let notification = merchant.queue_notification((cb) => {
        assert.strictEqual(cb.status, "declined");
      });

      provider.queue(suite.gw.basic_payout_handler("declined"));

      let response = await merchant.create_payout(suite.request());
      await response.followFirstProcessingUrl();
      await notification;
      assert.deepEqual(
        await rubWallet(merchant),
        { available: 1100, held: 0 },
        "after declined: funds returned",
      );
    }));

  test.concurrent("pending payout finalize to approved with commission", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let suite = commissionPayoutSuite();
      let merchant = await ctx.create_random_merchant();
      await merchant.set_commission({ operation: "PayoutRequest" });
      await merchant.cashin("RUB", AMOUNT_RUB + COMMISSION_RUB);
      assert.deepEqual(
        await rubWallet(merchant),
        { available: 1100, held: 0 },
        "after cashin",
      );
      await merchant.set_settings(suite.settings(ctx.uuid));
      let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

      let provider_request = provider.queue(
        suite.gw.basic_payout_handler("pending"),
      );

      let payout = await merchant
        .create_payout(suite.request())
        .then((r) => r.followFirstProcessingUrl())
        .then((r) => r.as_payout_response());
      let token = payout.token;

      await provider_request;
      if (CONFIG.in_project("spinpay")) {
        assert.deepEqual(
          await rubWallet(merchant),
          { available: COMMISSION_RUB, held: AMOUNT_RUB },
          "pending: payout amount held, commission stays in available",
        );
      } else {
        assert.deepEqual(
          await rubWallet(merchant),
          { available: 0, held: AMOUNT_RUB + COMMISSION_RUB },
          "pending: payout amount held, commission stays in held",
        );
      }
      await ctx.healthcheck(token);

      let notification = merchant.queue_notification((cb) => {
        assert.strictEqual(cb.status, "approved");
      });

      await suite.gw.send_callback("approved");
      await notification;
      assert.deepEqual(
        await rubWallet(merchant),
        { available: 0, held: 0 },
        "approved: payout sent, commission charged",
      );
    }));

  test.concurrent("pending payout finalize to declined with commission", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let suite = commissionPayoutSuite();
      let merchant = await ctx.create_random_merchant();
      await merchant.set_commission({ operation: "PayoutRequest" });
      await merchant.cashin("RUB", AMOUNT_RUB + COMMISSION_RUB);
      assert.deepEqual(
        await rubWallet(merchant),
        { available: 1100, held: 0 },
        "after cashin",
      );
      await merchant.set_settings(suite.settings(ctx.uuid));
      let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

      let provider_request = provider.queue(
        suite.gw.basic_payout_handler("pending"),
      );

      let payout = await merchant
        .create_payout(suite.request())
        .then((r) => r.followFirstProcessingUrl())
        .then((r) => r.as_payout_response());
      let token = payout.token;

      await provider_request;

      if (CONFIG.in_project("spinpay")) {
        assert.deepEqual(
          await rubWallet(merchant),
          { available: COMMISSION_RUB, held: AMOUNT_RUB },
          "pending: payout amount held, commission stays in available",
        );
      } else {
        assert.deepEqual(
          await rubWallet(merchant),
          { available: 0, held: AMOUNT_RUB + COMMISSION_RUB },
          "pending: payout amount held, commission stays in held",
        );
      }
      await ctx.healthcheck(token);

      let notification = merchant.queue_notification((cb) => {
        assert.strictEqual(cb.status, "declined");
      });

      await suite.gw.send_callback("declined");
      await notification;
      assert.deepEqual(
        await rubWallet(merchant),
        { available: AMOUNT_RUB + COMMISSION_RUB, held: 0 },
        "declined: full amount returned",
      );
    }));

  test.concurrent("payout fails when cashin excludes commission", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let suite = commissionPayoutSuite();
      let merchant = await ctx.create_random_merchant();
      await merchant.set_commission({ operation: "PayoutRequest" });
      await merchant.cashin("RUB", AMOUNT_RUB); // only base amount, no commission
      await merchant.set_settings(suite.settings(ctx.uuid));
      let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

      // Gateway should never be reached
      provider.queue(async () => {
        assert.fail(
          "Gateway should not be reached when balance is insufficient for commission",
        );
      });

      if (CONFIG.in_project(["reactivepay", "kotulapay"])) {
        let init = await merchant.create_payout(suite.request());
        await init.followFirstProcessingUrl().then((res) => res.as_error());
        let feed = await ctx.get_feed(init.token);
        assert.strictEqual(
          feed.status,
          2,
          "feed should be declined when payout got no balance",
        );
        assert.deepEqual(
          await rubWallet(merchant),
          { available: AMOUNT_RUB, held: 0 },
          "declined: full amount returned",
        );
      } else {
        await merchant.create_payout_err(suite.request());
        assert.deepEqual(
          await rubWallet(merchant),
          { available: AMOUNT_RUB, held: 0 },
          "declined: full amount returned",
        );
      }
    }));
});
