import { delay } from "@std/async";
import { MongoClient } from "mongodb";
import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import type { Bank } from "@/driver/trader";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { ExtendedTrader } from "@/entities/trader";
import { test } from "@/test_context";
import type { Context } from "@/test_context/context";

const CURRENCY = "RUB";

const REQUISITE_TYPE = "card";

const TRADER_DELAY = 5_000;

const BANKS: Bank[] = ["sberbank", "tbank", "alfabank"];

type AttemptStatus = "pending" | "approved" | "declined" | "expired";

async function with_attempts<T>(
  f: (
    attempts: ReturnType<ReturnType<MongoClient["db"]>["collection"]>,
  ) => Promise<T>,
): Promise<T> {
  let client = new MongoClient(CONFIG.urls().mongo);
  try {
    await client.connect();
    return await f(client.db("counters").collection("attempts"));
  } finally {
    await client.close();
  }
}

class TraderDispatchingTester {
  private traders: ExtendedTrader[] = [];
  private merchant: ExtendedMerchant | undefined;

  constructor(
    private ctx: Context,
    private n: number,
    private opts: {
      cascade?: boolean;
      accepted_only?: boolean;
      exchange?: boolean;
      without_requisite?: number[];
      min_conversion?: number;
      cascade_rule?: boolean;
    } = {},
  ) {}

  private alias(i: number): string {
    return `trader_${i}`;
  }

  private aliases(): string[] {
    return [...Array(this.n)].map((_, i) => this.alias(i));
  }

  private makeRule(mid: number, i: number) {
    if (this.opts.cascade_rule) {
      return {
        header: { mid, acq_alias: this.alias(i) },
        body: { status: { not_in: ["declined"] } },
        routing: { "status:not_in": { dispatching: true } },
        action: null,
        dispatching: {
          list: this.aliases(),
          method: "conversion",
          rate: "1d#approved",
        },
      };
    }

    return {
      header: { mid, acq_alias: this.alias(i), type: "pay" },
      body: this.opts.cascade ? { status: { not_in: ["declined"] } } : {},
      routing: this.opts.cascade
        ? { "status:not_in": { dispatching: true } }
        : null,
      action: null,
      dispatching: {
        list: this.aliases(),
        method: "conversion",
        rate: "1d#approved",
        accepted_only: this.opts.accepted_only ?? false,
        ...(this.opts.min_conversion === undefined
          ? {}
          : { min_conversion: this.opts.min_conversion }),
      },
    };
  }

  private gateway_settings(trader: ExtendedTrader) {
    return {
      list: [trader.id],
      class: "trader",
      pay_expired_minutes: 15,
      private_key: "1ccca8894bf0baabb47ef6695c0f0f18",
      wrapped_to_json_response: true,
    };
  }

  async init() {
    let exchange = this.opts.exchange ?? false;
    this.merchant = await this.ctx.create_random_merchant();

    for (let i = 0; i < this.n; i++) {
      let trader = await this.ctx.create_random_trader({ usdt: exchange });
      if (this.opts.without_requisite?.includes(i)) {
        // Core still sees the trader as able to take cards, but the trader service has
        // nothing to hand out, so the payment is refused before a requisite exists
        await trader.setup({ bank: BANKS[i] });
        await trader.enable_trader_method("card_enabled");
      } else {
        await trader.setup({ card: true, bank: BANKS[i] });
      }
      await trader.cashin("main", exchange ? "USDT" : CURRENCY, common.amount);
      this.traders.push(trader);
    }

    for (let i = 0; i < this.n; i++) {
      await this.ctx.add_flexy_guard_rule(
        this.makeRule(this.merchant.id, i),
        `Trader conversion dispatching rule for ${this.alias(i)}`,
      );
    }

    let gateways: Record<string, unknown> = { allow_host2host: true };
    this.traders.forEach((trader, i) => {
      gateways[this.alias(i)] = this.gateway_settings(trader);
    });

    let settle_currency = exchange ? "USDT" : CURRENCY;
    await this.merchant.set_settings({
      [settle_currency]: {
        gateways: { pay: { providers: [{ trader: this.alias(0) }] } },
      },
      ...(exchange ? { convert_to: "USDT" } : {}),
      gateways,
    });
  }

  private request() {
    return common.traderPaymentRequest(CURRENCY, REQUISITE_TYPE);
  }

  /**
   * The payment has to be served by the expected trader end to end: the requisite is from
   * its bank and core holds the amount against it, not against the trader of the alias
   * the payment came in on.
   */
  private async assert_requisite_from(
    token: string,
    bank: string | undefined,
    trader_idx: number,
  ) {
    assert.strictEqual(
      bank,
      BANKS[trader_idx],
      `requisite issued by ${this.alias(trader_idx)}`,
    );
    let feed = await this.ctx.get_feed(token);
    assert.strictEqual(
      feed.trader_id,
      this.traders[trader_idx].id,
      `core feed held by ${this.alias(trader_idx)}`,
    );
    if (this.opts.exchange) {
      assert.strictEqual(feed.target_currency, "USDT", "payin converted");
    }

    // Payments run one at a time, so the only amount on hold is this one
    for (let [i, trader] of this.traders.entries()) {
      let { main } = await trader.wallets();
      if (i === trader_idx) {
        assert.isAbove(main.held, 0, `${this.alias(i)} holds the amount`);
      } else {
        assert.strictEqual(main.held, 0, `${this.alias(i)} holds nothing`);
      }
    }
  }

  /**
   * Pay through the trader expected to win the dispatch, which hands over a requisite and
   * then settles the payment. Returns the payment token.
   */
  async pay_via(
    trader_idx: number,
    status: "approved" | "declined",
  ): Promise<string> {
    assert(this.merchant);

    let payment = await this.merchant.create_payment(this.request());
    let requisites = await payment
      .followFirstProcessingUrl()
      .then((r) => r.as_trader_requisites());
    await this.assert_requisite_from(
      payment.token,
      requisites.card?.bank,
      trader_idx,
    );

    let notification = this.merchant.queue_notification((n) => {
      assert.strictEqual(n.status, status);
    });
    await delay(TRADER_DELAY);
    await this.traders[trader_idx].finalizeTransaction(payment.token, status);
    await notification;

    return payment.token;
  }

  /** The dispatched-to trader has no requisite, so the merchant gets an error. */
  async pay_refused(): Promise<string> {
    assert(this.merchant);

    let payment = await this.merchant.create_payment(this.request());
    await payment.followFirstProcessingUrl().then((r) => r.as_error());

    return payment.token;
  }

  async assert_routed_to(token: string, trader_idx: number): Promise<void> {
    let payment = await this.ctx.get_payment(token);
    assert.strictEqual(payment.gateway_alias, this.alias(trader_idx));
  }

  /** Every alias that holds an attempt on the payment. */
  async attempted_aliases(token: string): Promise<string[]> {
    assert(this.merchant);
    let mid = this.merchant.id;
    let aliases = await with_attempts((attempts) =>
      attempts.distinct("acq_alias", { mid, tid: token }),
    );
    return aliases.map(String).sort();
  }

  async assert_nothing_held(): Promise<void> {
    for (let [i, trader] of this.traders.entries()) {
      let { main } = await trader.wallets();
      assert.strictEqual(main.held, 0, `${this.alias(i)} holds nothing`);
    }
  }

  async assert_declined_with(token: string, reason: string): Promise<void> {
    let payment = await this.ctx.get_payment(token);
    assert.strictEqual(payment.status, "declined");
    assert.include(payment.declination_reason ?? "", reason);
  }

  /** Wait for the attempt this trader made on the payment to reach the status. */
  async await_attempt(
    token: string,
    trader_idx: number,
    status: AttemptStatus,
    accepted?: boolean,
    counted?: boolean,
  ): Promise<void> {
    assert(this.merchant);
    let mid = this.merchant.id;
    let acq_alias = this.alias(trader_idx);

    let last = await with_attempts(async (attempts) => {
      let found: Record<string, unknown> | null = null;
      for (let i = 0; i < 60; i++) {
        found = await attempts.findOne({ mid, tid: token, acq_alias });
        if (found?.status === status) {
          return found;
        }
        await delay(500);
      }
      return found;
    });

    assert(last, `no attempt of ${acq_alias} on ${token}`);
    assert.strictEqual(last.status, status, `attempt of ${acq_alias}`);
    if (accepted !== undefined) {
      assert.strictEqual(last.accepted, accepted, `${acq_alias} accepted`);
    }
    if (counted !== undefined) {
      // Attempts written before the flag existed have no field and count
      assert.strictEqual(last.counted ?? true, counted, `${acq_alias} counted`);
    }
  }
}

function dispatching_tests(exchange: boolean) {
  test.concurrent("a trader decline is recorded against the trader", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let tester = new TraderDispatchingTester(ctx, 2, { exchange });
      await tester.init();

      // The decline arrives in a trader callback, long after the gateway answered with
      // a requisite, and has to replace the pending attempt rather than leave it
      let declined = await tester.pay_via(0, "declined");
      await tester.await_attempt(declined, 0, "declined", true);

      let approved = await tester.pay_via(1, "approved");
      await tester.await_attempt(approved, 1, "approved", true);
    }));

  test.concurrent("the requisite comes from the trader the payment was dispatched to", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let tester = new TraderDispatchingTester(ctx, 2, { exchange });
      await tester.init();

      // Both untried, the tie keeps the payment on trader_0, which loses it
      let first = await tester.pay_via(0, "declined");
      await tester.assert_routed_to(first, 0);
      await tester.await_attempt(first, 0, "declined");

      // trader_0 is 0/1 => 33%, so the payment moves to trader_1. The payin was created
      // for trader_0's list, so the requisite and the hold must follow the move.
      let second = await tester.pay_via(1, "approved");
      await tester.assert_routed_to(second, 1);
    }));

  test.concurrent("the best converting trader keeps the traffic", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let tester = new TraderDispatchingTester(ctx, 3, { exchange });
      await tester.init();

      let first = await tester.pay_via(0, "declined");
      await tester.await_attempt(first, 0, "declined");

      // trader_0 is 0/1 => 33%, trader_1 and trader_2 tie at 50%, the list order wins
      let second = await tester.pay_via(1, "approved");
      await tester.await_attempt(second, 1, "approved");

      // trader_1 is 1/1 => 67% and keeps it, even after losing one: 1/2 => 50% still
      // ties with the untried trader_2 and comes first in the list
      let third = await tester.pay_via(1, "declined");
      await tester.await_attempt(third, 1, "declined");

      let fourth = await tester.pay_via(1, "approved");
      await tester.assert_routed_to(fourth, 1);
    }));

  test.concurrent("dispatches past every trader that lost a payment", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let tester = new TraderDispatchingTester(ctx, 3, { exchange });
      await tester.init();

      let first = await tester.pay_via(0, "declined");
      await tester.await_attempt(first, 0, "declined");

      // trader_0 is 0/1 => 33%, the payment moves to trader_1, which loses it too
      let second = await tester.pay_via(1, "declined");
      await tester.await_attempt(second, 1, "declined");

      // Both at 33%, the untried trader_2 at 50% gets the payment although it is last
      // in the list and the payin was created for trader_0
      let third = await tester.pay_via(2, "approved");
      await tester.assert_routed_to(third, 2);
    }));

  test.concurrent("cascades to the next ranked trader when one has no requisite", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let tester = new TraderDispatchingTester(ctx, 2, {
        exchange,
        cascade: true,
        without_requisite: [0],
      });
      await tester.init();

      // trader_0 wins the tie but has nothing to hand out, the payment cascades to
      // trader_1 and the merchant only ever sees trader_1's requisite
      let token = await tester.pay_via(1, "approved");
      await tester.assert_routed_to(token, 1);

      // Both halves of the cascade are recorded, against the trader that earned them
      await tester.await_attempt(token, 0, "declined", false);
      await tester.await_attempt(token, 1, "approved", true);

      // trader_0 is 0/1 => 33%, so the next payment starts on trader_1 directly
      let next = await tester.pay_via(1, "approved");
      await tester.assert_routed_to(next, 1);
    }));

  test.concurrent("without accepted_only, a trader with no requisite drops out", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let tester = new TraderDispatchingTester(ctx, 2, {
        exchange,
        without_requisite: [0],
      });
      await tester.init();

      let first = await tester.pay_refused();
      await tester.assert_routed_to(first, 0);
      await tester.await_attempt(first, 0, "declined", false);

      // The refusal counts, trader_0 is 0/1 => 33% and trader_1 takes over
      let second = await tester.pay_via(1, "approved");
      await tester.assert_routed_to(second, 1);
    }));

  test.concurrent("with accepted_only, a trader with no requisite stays in rotation", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let tester = new TraderDispatchingTester(ctx, 2, {
        exchange,
        accepted_only: true,
        without_requisite: [0],
      });
      await tester.init();

      let first = await tester.pay_refused();
      await tester.assert_routed_to(first, 0);
      await tester.await_attempt(first, 0, "declined", false);

      // Never issued a requisite, so it is not scored: still tied, still first
      let second = await tester.pay_refused();
      await tester.assert_routed_to(second, 0);
    }));

  test.concurrent("min_conversion declines when every trader converts below it", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let tester = new TraderDispatchingTester(ctx, 2, {
        exchange,
        min_conversion: 40,
      });
      await tester.init();

      // Both untried at 50%, above the bar
      let first = await tester.pay_via(0, "declined");
      await tester.await_attempt(first, 0, "declined", true, true);

      // trader_0 is 0/1 => 33%, under the bar, so trader_1 at 50% gets it
      let second = await tester.pay_via(1, "declined");
      await tester.assert_routed_to(second, 1);
      await tester.await_attempt(second, 1, "declined", true, true);

      // Both at 33%: the payment is refused before any trader is asked for a
      // requisite, and the refusal is kept out of trader_0's conversion
      let third = await tester.pay_refused();
      await tester.assert_routed_to(third, 0);
      await tester.assert_declined_with(third, "below 40%");
      await tester.await_attempt(third, 0, "declined", false, false);
      let feed = await ctx.get_feed(third);
      assert.isNull(feed.trader_id, "no trader was asked for a requisite");
    }));
}

/**
 * Three traders behind one merchant, each alias with the same rule: a decline routes the
 * payment on to the best converting alias it has not been through yet.
 */
function cascade_rule_tests(exchange: boolean) {
  test.concurrent("hands the payment down the list until a trader has a requisite", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let tester = new TraderDispatchingTester(ctx, 3, {
        exchange,
        cascade_rule: true,
        without_requisite: [0, 1],
      });
      await tester.init();

      // trader_0 refuses, trader_1 and trader_2 tie among the untried and trader_1 is
      // first in the list, refuses as well, and trader_2 finally hands a requisite over
      let token = await tester.pay_via(2, "approved");
      await tester.assert_routed_to(token, 2);

      await tester.await_attempt(token, 0, "declined", false);
      await tester.await_attempt(token, 1, "declined", false);
      await tester.await_attempt(token, 2, "approved", true);
    }));

  test.concurrent("declines once every trader in the list has refused", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let tester = new TraderDispatchingTester(ctx, 3, {
        exchange,
        cascade_rule: true,
        without_requisite: [0, 1, 2],
      });
      await tester.init();

      // Each trader gets exactly one go, then there is nowhere left to route to and the
      // decline of the last one stands
      let token = await tester.pay_refused();
      await tester.assert_routed_to(token, 2);
      let payment = await ctx.get_payment(token);
      assert.strictEqual(payment.status, "declined");

      for (let i = 0; i < 3; i++) {
        await tester.await_attempt(token, i, "declined", false);
      }
      await tester.assert_nothing_held();
    }));

  test.concurrent("after a cascade the next payment goes to the untried trader", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let tester = new TraderDispatchingTester(ctx, 3, {
        exchange,
        cascade_rule: true,
        without_requisite: [0],
      });
      await tester.init();

      // trader_0 refuses and the payment cascades to trader_1, which issues a requisite
      // and then loses the payment in a callback
      let first = await tester.pay_via(1, "declined");
      await tester.assert_routed_to(first, 1);
      await tester.await_attempt(first, 0, "declined", false);
      await tester.await_attempt(first, 1, "declined", true);

      // trader_0 and trader_1 are both 0/1 => 33%, so the payment is dispatched straight
      // to trader_2 before trader_0 is asked for anything
      let second = await tester.pay_via(2, "approved");
      await tester.assert_routed_to(second, 2);
      assert.deepEqual(
        await tester.attempted_aliases(second),
        ["trader_2"],
        "no trader but trader_2 took the second payment on",
      );
    }));

  test.concurrent("a trader decline after the requisite is not routed on", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let tester = new TraderDispatchingTester(ctx, 3, {
        exchange,
        cascade_rule: true,
      });
      await tester.init();

      // The decline matches the routing condition too, but the payment has already been
      // settled by the trader, so it must stay declined on trader_0
      let first = await tester.pay_via(0, "declined");
      await tester.await_attempt(first, 0, "declined", true);
      // Leave time for anything that would still move the payment on
      await delay(TRADER_DELAY);

      await tester.assert_routed_to(first, 0);
      let payment = await ctx.get_payment(first);
      assert.strictEqual(payment.status, "declined");
      assert.deepEqual(await tester.attempted_aliases(first), ["trader_0"]);
      await tester.assert_nothing_held();

      // trader_0 is 0/1 => 33%, the next payment starts on trader_1
      let second = await tester.pay_via(1, "approved");
      await tester.assert_routed_to(second, 1);
    }));

  test.concurrent("an async decline by the dispatched-to trader counts in its conversion", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let tester = new TraderDispatchingTester(ctx, 2, {
        exchange,
        cascade_rule: true,
      });
      await tester.init();

      // trader_0 issues a requisite and loses the payment: 0/1 => 33%
      let first = await tester.pay_via(0, "declined");
      await tester.await_attempt(first, 0, "declined", true, true);

      // The payment comes in on trader_0 and is dispatched to the untried trader_1 before
      // trader_0 is asked for anything. trader_1 issues a requisite and declines later,
      // in a callback.
      let second = await tester.pay_via(1, "declined");
      await tester.assert_routed_to(second, 1);
      assert.deepEqual(
        await tester.attempted_aliases(second),
        ["trader_1"],
        "the dispatched payment is attempted by trader_1 only",
      );
      // The callback decline replaces the pending attempt and is scored
      await tester.await_attempt(second, 1, "declined", true, true);

      // Only a counted decline brings trader_1 down to 0/1 => 33%, tying with trader_0,
      // and the tie goes back to trader_0 by list order. Had the decline been left out,
      // trader_1 would still be on its 50% prior and keep the payment.
      let third = await tester.pay_via(0, "approved");
      await tester.assert_routed_to(third, 0);
    }));
}

describe
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("trader conversion dispatching", () => dispatching_tests(false));

describe
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("trader cascade rule", () => cascade_rule_tests(false));

describe
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("trader cascade rule with convert_to USDT", () =>
    cascade_rule_tests(true),
  );

describe
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("trader conversion dispatching with convert_to USDT", () =>
    dispatching_tests(true),
  );

/**
 * A payment that settles without a trader callback still has to land in the conversion:
 * the attempt must leave pending once the payment is final.
 */
describe
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("trader conversion outside of trader callbacks", () => {
    async function setup(ctx: Context, bank: string, pay_expired_minutes = 15) {
      let merchant = await ctx.create_random_merchant();
      let trader = await ctx.create_random_trader({ usdt: false });
      let requisites = await trader.setup({ card: true, bank });
      await trader.cashin("main", CURRENCY, common.amount);

      await ctx.add_flexy_guard_rule({
        header: { mid: merchant.id, acq_alias: "trader_0" },
        body: {},
        routing: null,
        action: null,
        dispatching: {
          list: ["trader_0"],
          method: "conversion",
          rate: "1d#approved",
        },
      });
      await merchant.set_settings({
        [CURRENCY]: {
          gateways: { pay: { providers: [{ trader: "trader_0" }] } },
        },
        gateways: {
          allow_host2host: true,
          trader_0: {
            list: [trader.id],
            class: "trader",
            pay_expired_minutes,
            private_key: "1ccca8894bf0baabb47ef6695c0f0f18",
            wrapped_to_json_response: true,
          },
        },
      });

      return { merchant, trader, requisites };
    }

    async function await_settled_attempt(mid: number, tid: string) {
      return with_attempts(async (attempts) => {
        for (let i = 0; i < 60; i++) {
          let attempt = await attempts.findOne({
            mid,
            tid,
            acq_alias: "trader_0",
          });
          if (attempt && attempt.status !== "pending") {
            return attempt;
          }
          await delay(500);
        }
        return attempts.findOne({ mid, tid, acq_alias: "trader_0" });
      });
    }

    test.concurrent(
      "an expired payment counts in the conversion",
      { timeout: 180_000 },
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let { merchant } = await setup(ctx, "sberbank", 1);

          let payment = await merchant.create_payment(
            common.traderPaymentRequest(CURRENCY, REQUISITE_TYPE),
          );
          // Core catches up with an expiry asynchronously, so a healthcheck here is racy
          let expired = merchant.queue_notification(
            (n) => {
              assert.strictEqual(n.status, "expired");
            },
            { skip_healthcheck: true },
          );
          await payment
            .followFirstProcessingUrl()
            .then((r) => r.as_trader_requisites());

          // Nobody finalizes it: business expires it a minute and a half later
          await expired;

          let attempt = await await_settled_attempt(merchant.id, payment.token);
          assert(attempt, "attempt recorded");
          assert.strictEqual(attempt.status, "expired");
          assert.strictEqual(attempt.counted ?? true, true, "attempt counted");
        }),
    );

    test.concurrent(
      "a payment approved by an sms counts in the conversion",
      { timeout: 90_000 },
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let bank = await ctx.create_random_bank();
          let sim = crypto.randomUUID();
          await ctx.create_sms_parser({
            sms_type: "card",
            bank_id: bank.id.toString(),
            sim,
            from_pattern: "VTB",
            from_data: "VTB",
            pattern: "Зачисление (?<amount>[\\d\\s]+[.,]\\d{2}) RUB",
            text_pattern: "Зачисление (?<amount>[\\d\\s]+[.,]\\d{2}) RUB",
            currency: CURRENCY,
          });
          let { merchant, trader, requisites } = await setup(
            ctx,
            bank.system_name,
          );

          let request = common.traderPaymentRequest(CURRENCY, REQUISITE_TYPE);
          let payment = await merchant.create_payment({
            ...request,
            bank_account: {
              ...request.bank_account,
              bank_name: bank.system_name,
            },
          });
          let approved = merchant.queue_notification((n) => {
            assert.strictEqual(n.status, "approved");
          });
          await payment
            .followFirstProcessingUrl()
            .then((r) => r.as_trader_requisites());

          // The trader never touches the payment, the bank sms settles it
          let amount = (common.amount / 100).toFixed(2).replace(".", ",");
          await trader.driver.send_sms({
            uuid: requisites.device_id,
            from: "VTB",
            text: `VTB. Зачисление ${amount} RUB. Счёт *5678`,
            sim,
          });
          await approved;

          let attempt = await await_settled_attempt(merchant.id, payment.token);
          assert(attempt, "attempt recorded");
          assert.strictEqual(attempt.status, "approved");
          assert.strictEqual(attempt.counted ?? true, true, "attempt counted");
        }),
    );

    test.concurrent("a payment declined in core manage counts in the conversion", ({
      ctx,
    }) =>
      ctx.track_bg_rejections(async () => {
        let { merchant } = await setup(ctx, "sberbank");

        let payment = await merchant.create_payment(
          common.traderPaymentRequest(CURRENCY, REQUISITE_TYPE),
        );
        await payment
          .followFirstProcessingUrl()
          .then((r) => r.as_trader_requisites());

        // The trader never answers, an operator declines the payment by hand
        let declined = merchant.queue_notification((n) => {
          assert.strictEqual(n.status, "declined");
        });
        await delay(TRADER_DELAY);
        await ctx.core_change_status(payment.token, "declined");
        await declined;

        let attempt = await await_settled_attempt(merchant.id, payment.token);
        assert(attempt, "attempt recorded");
        assert.strictEqual(attempt.status, "declined");
        assert.strictEqual(attempt.counted ?? true, true, "attempt counted");
      }));
  });
