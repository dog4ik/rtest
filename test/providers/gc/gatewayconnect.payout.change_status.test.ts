import { delay } from "@std/async";
import { assert, describe } from "vitest";
import { CONFIG } from "@/config";
import type { ExtendedMerchant } from "@/entities/merchant";
import { payoutSuite } from "@/provider_mocks/gateway_connect";
import { STATIC_RATE } from "@/provider_mocks/rate";
import { CALLBACK_DELAY, providersSuite } from "@/suite_interfaces";
import { test } from "@/test_context";
import type { Context } from "@/test_context/context";

const COMMISSION_VALUE = 10;

const PAYOUT_AMOUNT = 10_000;
const PAYOUT_AMOUNT_MAJOR = PAYOUT_AMOUNT / 100;
const SELF_RATE = 0.1;
const COMMISSION_MAJOR = PAYOUT_AMOUNT_MAJOR * SELF_RATE;
const MERCHANT_CASHIN = PAYOUT_AMOUNT_MAJOR + COMMISSION_MAJOR;

function requestAmount(usdt: boolean) {
  return usdt ? PAYOUT_AMOUNT * STATIC_RATE : PAYOUT_AMOUNT;
}

function changeStatusSuite(usdt: boolean) {
  let suite = payoutSuite();
  return providersSuite(
    usdt ? "USDT" : "RUB",
    {
      ...suite,
      request: () => ({ ...suite.request(), amount: requestAmount(usdt) }),
    },
    { convert_to: usdt },
  );
}

async function setup_payout(
  ctx: Context,
  merchant: ExtendedMerchant,
  usdt: boolean,
) {
  let currency = usdt ? "USDT" : "RUB";
  let suite = changeStatusSuite(usdt);
  await merchant.set_commission({
    operation: "PayoutRequest",
    currency: "RUB",
    self_rate: "10",
    provider_rate: "5",
  });
  await merchant.cashin(currency, MERCHANT_CASHIN);
  await merchant.set_settings(suite.settings(ctx.uuid));
  // the status checker keeps polling while the payout is pending, the default
  // handler absorbs those requests without moving the transaction
  let provider = ctx.mock_server(
    suite.mock_options(ctx.uuid),
    suite.gw.status_handler("pending"),
  );

  return {
    suite,
    provider,
    /** Creates a payout the gateway leaves pending and returns its token. */
    async create_pending() {
      let gateway_request = provider.queue(
        suite.gw.basic_payout_handler("pending"),
      );
      let payout = await merchant
        .create_payout(suite.request())
        .then((r) => r.followFirstProcessingUrl())
        .then((r) => r.as_payout_response());
      await gateway_request;
      await ctx.healthcheck(payout.token, {
        expect: { status: 0 },
      });
      return payout.token;
    },
  };
}

async function merchantWallet(merchant: ExtendedMerchant, currency: string) {
  let ws = await merchant.wallets(currency);
  let w = ws.find((w) => w.currency === currency);
  return { available: w?.available ?? 0, held: w?.held ?? 0 };
}

function payoutNotification(status: "approved" | "declined") {
  return (n: { type: string; status: string }) => {
    assert.strictEqual(n.type, "payout");
    assert.strictEqual(n.status, status);
  };
}

describe
  .runIf(CONFIG.in_project(["spinpay"]))
  .concurrent("gateway connect core manage payout change status", () => {
    for (let usdt of [true, false]) {
      let variant = usdt ? "usdt" : "rub";

      test.concurrent(`payout approved -> declined (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let { suite, create_pending } = await setup_payout(
            ctx,
            merchant,
            usdt,
          );
          let token = await create_pending();

          let approved = merchant.queue_notification(
            payoutNotification("approved"),
          );
          await delay(CALLBACK_DELAY);
          await suite.gw.send_callback("approved");
          await approved;
          await ctx.healthcheck(token, {
            expect: { status: 1, commission_value: COMMISSION_VALUE },
          });

          let declined = merchant.queue_notification(
            payoutNotification("declined"),
          );
          await delay(2_000);
          await ctx.core_change_status(token, "declined");
          await declined;
          await ctx.healthcheck(token, {
            expect: { status: 2 },
          });
        }));

      test.concurrent(`payout declined -> approved (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let { suite, create_pending } = await setup_payout(
            ctx,
            merchant,
            usdt,
          );
          let token = await create_pending();

          let declined = merchant.queue_notification(
            payoutNotification("declined"),
          );
          await delay(CALLBACK_DELAY);
          await suite.gw.send_callback("declined");
          await declined;
          await ctx.healthcheck(token, {
            expect: { status: 2 },
          });

          let approved = merchant.queue_notification(
            payoutNotification("approved"),
          );
          await delay(2_000);
          await ctx.core_change_status(token, "approved");
          await approved;
          await ctx.healthcheck(token, {
            expect: { status: 1, commission_value: COMMISSION_VALUE },
          });
        }));

      test.concurrent(`payout pending -> declined (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let { create_pending } = await setup_payout(ctx, merchant, usdt);
          let token = await create_pending();

          let declined = merchant.queue_notification(
            payoutNotification("declined"),
          );
          await delay(2_000);
          await ctx.core_change_status(token, "declined");
          await declined;
          await ctx.healthcheck(token, {
            expect: { status: 2 },
          });
        }));

      test.concurrent(`payout pending -> approved (${variant})`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let { create_pending } = await setup_payout(ctx, merchant, usdt);
          let token = await create_pending();

          let approved = merchant.queue_notification(
            payoutNotification("approved"),
          );
          await delay(2_000);
          await ctx.core_change_status(token, "approved");
          await approved;
          await ctx.healthcheck(token, {
            expect: { status: 1, commission_value: COMMISSION_VALUE },
          });
        }));
    }
  });

describe
  // gateway connect is only wired up on these projects
  .runIf(CONFIG.in_project(["reactivepay", "8pay", "spinpay"]))
  .concurrent(
    "gateway connect core manage payout change status edge cases",
    () => {
      for (let usdt of [true, false]) {
        let variant = usdt ? "usdt" : "rub";
        let currency = usdt ? "USDT" : "RUB";

        test.concurrent(`payout declined -> approved with insufficient merchant balance (${variant})`, ({
          ctx,
          merchant,
        }) =>
          ctx.track_bg_rejections(async () => {
            let { suite, create_pending } = await setup_payout(
              ctx,
              merchant,
              usdt,
            );
            let token = await create_pending();

            let declined = merchant.queue_notification(
              payoutNotification("declined"),
            );
            await delay(CALLBACK_DELAY);
            await suite.gw.send_callback("declined");
            await declined;
            await ctx.healthcheck(token, {
              expect: { status: 2 },
            });

            // drain the refunded funds so the payout can not be charged again
            let { available } = await merchantWallet(merchant, currency);
            assert.isAbove(
              available,
              0,
              "merchant: funds are returned after the decline",
            );
            await merchant.cashout(currency, available);

            await delay(2_000);
            await ctx.core_change_status(token, "approved");
            await delay(2_000);
            // the restore can not be funded, the payout stays declined
            await ctx.healthcheck(token, {
              expect: { status: 2 },
            });
          }));

        test.concurrent(`payout declined -> approved with insufficient merchant balance for commission (${variant})`, ({
          ctx,
          merchant,
        }) =>
          ctx.track_bg_rejections(async () => {
            let { suite, create_pending } = await setup_payout(
              ctx,
              merchant,
              usdt,
            );
            let token = await create_pending();

            let declined = merchant.queue_notification(
              payoutNotification("declined"),
            );
            await delay(CALLBACK_DELAY);
            await suite.gw.send_callback("declined");
            await declined;
            await ctx.healthcheck(token, {
              expect: { status: 2 },
            });

            // leave the payout amount but drain the commission on top of it
            let { available } = await merchantWallet(merchant, currency);
            assert.isAbove(
              available,
              PAYOUT_AMOUNT_MAJOR,
              "merchant: amount and commission are returned after the decline",
            );
            await merchant.cashout(currency, available - PAYOUT_AMOUNT_MAJOR);
            assert.deepEqual(
              await merchantWallet(merchant, currency),
              { available: PAYOUT_AMOUNT_MAJOR, held: 0 },
              "merchant: funded for the amount but not for the commission",
            );

            await delay(2_000);
            await ctx.core_change_status(token, "approved");
            await delay(2_000);
            // the commission can not be charged, the payout stays declined
            await ctx.healthcheck(token, {
              expect: { status: 2 },
            });
          }));

        // Only spinpay keeps the commission in available while the payout is
        // pending, everywhere else it is held on creation and can not be drained.
        test
          .runIf(CONFIG.in_project("spinpay"))
          .concurrent(
            `payout pending -> approved with insufficient merchant balance for commission (${variant})`,
            ({ ctx, merchant }) =>
              ctx.track_bg_rejections(async () => {
                let { create_pending } = await setup_payout(
                  ctx,
                  merchant,
                  usdt,
                );
                let token = await create_pending();

                // the payout amount is held, drain the commission left beside it
                assert.deepEqual(
                  await merchantWallet(merchant, currency),
                  { available: COMMISSION_MAJOR, held: PAYOUT_AMOUNT_MAJOR },
                  "merchant: amount held, commission still available while pending",
                );
                await merchant.cashout(currency, COMMISSION_MAJOR);

                await delay(2_000);
                await ctx.core_change_status(token, "approved");
                await delay(2_000);
                // the payout should stay pending, no funds to cover commission.
                await ctx.healthcheck(token, {
                  expect: { status: 0 },
                });
              }),
          );
      }
    },
  );
