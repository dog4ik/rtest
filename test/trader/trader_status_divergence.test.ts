import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { businessOfCoreStatus } from "@/db/business";
import { traderNoConvertSettings } from "@/driver/trader";
import { test } from "@/test_context";

/**
 * Reproduces a trader-gateway defect where core hands out more requisites than it
 * can honor, stranding the extra payins.
 *
 * Core routes a trader only if its main wallet already covers the amount
 * (services/core/app/services/trader/route.rb#main_balance_filter) and it reads the
 * balance without reserving anything. Firing several payins concurrently against a
 * trader funded for a SINGLE payment lets them all pass routing (a check-then-act
 * race), so business assigns the requisite to every one of them. On finalization the
 * trader "approves" all of them, but core can only hold funds once
 * (services/core/app/services/trader/hold.rb): one payin ends approved while the
 * rest are left stranded at business=pending / core=init(0) instead of being
 * declined, and nothing ever resolves them.
 *
 * Expected once fixed: at most one requisite is handed out (or the surplus payins
 * are declined), and no approved-by-trader payin is left pending. Business and core
 * statuses stay consistent.
 */
describe
  .runIf(CONFIG.in_project(["a2", "reactivepay"]))
  .concurrent("trader gateway business/core status divergence", () => {
    const TRADER_DELAY = 5_000;
    const SETTLE_DELAY = 10_000;

    const PAYMENT_AMOUNT = common.amount; // 123456 kopeek = 1234.56 RUB
    const CONCURRENCY = 3;
    // funded for a single payment only -> core can honor at most one of them
    const TRADER_BALANCE_RUB = PAYMENT_AMOUNT / 100;

    test.concurrent("concurrently routed trader payins must all resolve consistently in business and core", ({
      ctx,
      merchant,
    }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({
          usdt: false,
          payout_hold_period: 0,
        });
        await trader.setup({ card: true, bank: "sberbank" });
        await trader.cashin("main", "RUB", TRADER_BALANCE_RUB);
        await merchant.set_settings(
          traderNoConvertSettings("RUB", [trader.id]),
        );

        // fire all payins concurrently so they all clear the reservation-free
        // balance filter before any of them holds funds in core
        let barrier = Promise.withResolvers<void>();
        let arrived = 0;

        let tokens = await Promise.all(
          [...new Array(CONCURRENCY)].map(async (_, i) => {
            let created = await merchant.create_payment({
              ...common.traderPaymentRequest("RUB", "card"),
              amount: PAYMENT_AMOUNT - i,
            });
            arrived += 1;
            if (arrived === CONCURRENCY) barrier.resolve();
            await barrier.promise;

            let res = await created
              .followFirstProcessingUrl()
              .then((r) => r.as_raw_json() as Promise<Record<string, any>>);
            return res?.token as string | undefined;
          }),
        );

        let assigned = tokens.filter((t): t is string => Boolean(t));
        console.log(
          `[divergence] assigned requisites: ${assigned.length}/${CONCURRENCY}`,
        );
        assert(
          assigned.length > 0,
          "at least one payin should get a requisite",
        );

        await delay(TRADER_DELAY);
        await Promise.all(
          assigned.map((token) =>
            trader.finalizeTransaction(token, "approved").catch(() => {}),
          ),
        );
        await delay(SETTLE_DELAY);

        let rows = await Promise.all(
          assigned.map(async (token) => {
            let payment = await ctx.get_payment(token);
            let feed = await ctx.get_feed(token);
            let expectedCore = businessOfCoreStatus(payment.status);
            let row = {
              token,
              business: payment.status,
              core: feed.status,
              expectedCore,
            };
            console.log(
              `[divergence] token=${token} business=${row.business} core=${row.core} expectedCore=${expectedCore}`,
            );
            return row;
          }),
        );

        // business and core must never disagree on a payin's outcome
        let diverged = rows.filter((r) => r.core !== r.expectedCore);
        assert.deepStrictEqual(
          diverged.map(
            (r) => `${r.token} business=${r.business} core=${r.core}`,
          ),
          [],
          "business/core status divergence",
        );

        // every payin that got a requisite and was approved by the trader must
        // reach a terminal outcome; surplus payins core could not honor are left
        // stranded at pending instead of being declined.
        let stranded = rows.filter((r) => r.business === "pending");
        assert.deepStrictEqual(
          stranded.map(
            (r) => `${r.token} business=${r.business} core=${r.core}`,
          ),
          [],
          `payins left stranded (assigned a requisite but never resolved); ` +
            `trader funded for 1 but ${assigned.length} requisites were handed out`,
        );
      }));
  });
