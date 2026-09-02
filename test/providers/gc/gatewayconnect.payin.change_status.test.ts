import { delay } from "@std/async";
import { assert, describe } from "vitest";
import { CONFIG } from "@/config";
import type { ExtendedMerchant } from "@/entities/merchant";
import { payinSuite } from "@/provider_mocks/gateway_connect";
import { CALLBACK_DELAY, providersSuite } from "@/suite_interfaces";
import { test } from "@/test_context";
import type { Context } from "@/test_context/context";

/** `self_rate` of the merchant commission rule, as the feed stores it. */
const COMMISSION_VALUE = 10;

const PAYIN_AMOUNT = 10_000;
const PAYIN_AMOUNT_RUB = PAYIN_AMOUNT / 100;
const SELF_RATE = 0.1;
const COMMISSION_RUB = PAYIN_AMOUNT_RUB * SELF_RATE;
/** What the approved payin credits to the merchant. */
const MERCHANT_CREDIT = PAYIN_AMOUNT_RUB - COMMISSION_RUB;

/** Gateway connect payin on providers settings. */
function changeStatusSuite() {
  let suite = payinSuite();
  return providersSuite("RUB", {
    ...suite,
    request: () => ({ ...suite.request(), amount: PAYIN_AMOUNT }),
  });
}

async function setup_payin(ctx: Context, merchant: ExtendedMerchant) {
  let suite = changeStatusSuite();
  await merchant.set_commission({
    operation: "PayinRequest",
    currency: "RUB",
    self_rate: "10",
    provider_rate: "5",
  });
  await merchant.set_settings(suite.settings(ctx.uuid));
  let provider = ctx.mock_server(
    suite.mock_options(ctx.uuid),
    suite.gw.status_handler("pending"),
  );

  return {
    suite,
    provider,
    /** Creates a payin the gateway leaves pending and returns its token. */
    async create_pending() {
      let gateway_request = provider.queue(
        suite.gw.basic_payin_handler("pending"),
      );
      let payment = await merchant.create_payment(suite.request());
      await payment.followFirstProcessingUrl().then((r) => r.as_raw_json());
      await gateway_request;
      await ctx.healthcheck(payment.token, {
        expect: { status: 0 },
      });
      return payment.token;
    },
  };
}

async function merchantWallet(merchant: ExtendedMerchant, currency: string) {
  let ws = await merchant.wallets(currency);
  let w = ws.find((w) => w.currency === currency);
  return { available: w?.available ?? 0, held: w?.held ?? 0 };
}

function payinNotification(status: "approved" | "declined") {
  return (n: { type: string; status: string }) => {
    assert.strictEqual(n.type, "pay");
    assert.strictEqual(n.status, status);
  };
}

describe
  // gateway connect is only wired up on these projects
  .runIf(CONFIG.in_project(["reactivepay", "8pay", "spinpay"]))
  .concurrent("gateway connect core manage payin change status", () => {
    test.concurrent("payin approved -> declined", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let { suite, create_pending } = await setup_payin(ctx, merchant);
        let token = await create_pending();

        let approved = merchant.queue_notification(
          payinNotification("approved"),
        );
        await delay(CALLBACK_DELAY);
        await suite.gw.send_callback("approved", PAYIN_AMOUNT);
        await approved;
        await ctx.healthcheck(token, {
          expect: { status: 1, commission_value: COMMISSION_VALUE },
        });

        let declined = merchant.queue_notification(
          payinNotification("declined"),
        );
        await delay(2_000);
        await ctx.core_change_status(token, "declined");
        await declined;
        await ctx.healthcheck(token, {
          expect: { status: 2 },
        });
      }));

    test.concurrent("payin declined -> approved", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let { suite, create_pending } = await setup_payin(ctx, merchant);
        let token = await create_pending();

        let declined = merchant.queue_notification(
          payinNotification("declined"),
        );
        await delay(CALLBACK_DELAY);
        await suite.gw.send_callback("declined", PAYIN_AMOUNT);
        await declined;
        await ctx.healthcheck(token, {
          expect: { status: 2 },
        });

        let approved = merchant.queue_notification(
          payinNotification("approved"),
        );
        await delay(2_000);
        await ctx.core_change_status(token, "approved");
        await approved;
        await ctx.healthcheck(token, {
          expect: { status: 1, commission_value: COMMISSION_VALUE },
        });
      }));

    test.concurrent("payin pending -> declined", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let { create_pending } = await setup_payin(ctx, merchant);
        let token = await create_pending();

        let declined = merchant.queue_notification(
          payinNotification("declined"),
        );
        await delay(2_000);
        await ctx.core_change_status(token, "declined");
        await declined;
        await ctx.healthcheck(token, {
          expect: { status: 2 },
        });
      }));

    test.concurrent("payin pending -> approved", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let { create_pending } = await setup_payin(ctx, merchant);
        let token = await create_pending();

        let approved = merchant.queue_notification(
          payinNotification("approved"),
        );
        await delay(2_000);
        await ctx.core_change_status(token, "approved");
        await approved;
        await ctx.healthcheck(token, {
          expect: { status: 1, commission_value: COMMISSION_VALUE },
        });
      }));
  });

describe
  // gateway connect is only wired up on these projects
  .runIf(CONFIG.in_project(["reactivepay", "8pay", "spinpay"]))
  .concurrent(
    "gateway connect core manage payin change status edge cases",
    () => {
      test.concurrent("payin approved -> declined with insufficient merchant balance", ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let { suite, create_pending } = await setup_payin(ctx, merchant);
          let token = await create_pending();

          let approved = merchant.queue_notification(
            payinNotification("approved"),
          );
          await delay(CALLBACK_DELAY);
          await suite.gw.send_callback("approved", PAYIN_AMOUNT);
          await approved;
          await ctx.healthcheck(token, {
            expect: { status: 1, commission_value: COMMISSION_VALUE },
          });

          // drain the credited funds so the reversal can not take them back
          assert.deepEqual(
            await merchantWallet(merchant, "RUB"),
            { available: MERCHANT_CREDIT, held: 0 },
            "merchant: credited the payin amount without the commission",
          );
          await merchant.cashout("RUB", MERCHANT_CREDIT);

          await delay(2_000);
          await ctx.core_change_status(token, "declined");
          await delay(2_000);
          // the reversal can not be funded, the payin stays approved
          await ctx.healthcheck(token, {
            expect: { status: 1, commission_value: COMMISSION_VALUE },
          });
        }));

      test.concurrent("payin approved -> declined with insufficient merchant balance for commission", ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let { suite, create_pending } = await setup_payin(ctx, merchant);
          let token = await create_pending();

          let approved = merchant.queue_notification(
            payinNotification("approved"),
          );
          await delay(CALLBACK_DELAY);
          await suite.gw.send_callback("approved", PAYIN_AMOUNT);
          await approved;
          await ctx.healthcheck(token, {
            expect: { status: 1, commission_value: COMMISSION_VALUE },
          });

          // leave the credited funds short by exactly the commission
          assert.deepEqual(
            await merchantWallet(merchant, "RUB"),
            { available: MERCHANT_CREDIT, held: 0 },
            "merchant: credited the payin amount without the commission",
          );
          await merchant.cashout("RUB", COMMISSION_RUB);
          assert.deepEqual(
            await merchantWallet(merchant, "RUB"),
            { available: MERCHANT_CREDIT - COMMISSION_RUB, held: 0 },
            "merchant: one commission short of the reversal",
          );

          await delay(2_000);
          await ctx.core_change_status(token, "declined");
          await delay(2_000);
          // the reversal can not be funded in full, the payin stays approved
          await ctx.healthcheck(token, {
            expect: { status: 1, commission_value: COMMISSION_VALUE },
          });
        }));
    },
  );
