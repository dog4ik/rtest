import { delay } from "@std/async";
import { MongoClient } from "mongodb";
import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import type { BusinessStatus } from "@/db/business";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { ProviderInstance } from "@/mock_server/instance";
import { GatewayConnectTransaction } from "@/provider_mocks/gateway_connect";
import { SettingsBuilder } from "@/settings_builder";
import { test } from "@/test_context";
import type { Context } from "@/test_context/context";

const CURRENCY = "RUB";

const REQUISITE_TYPE = "card";

async function wait_for_settled(
  mid: number,
  acq_alias: string,
  expected: number,
): Promise<void> {
  let client = new MongoClient(CONFIG.urls().mongo);
  try {
    await client.connect();
    let attempts = client.db("counters").collection("attempts");

    for (let attempt = 0; attempt < 60; attempt++) {
      let settled = await attempts.countDocuments({
        mid,
        acq_alias,
        status: { $in: ["approved", "declined", "expired"] },
      });

      if (settled >= expected) {
        return;
      }

      await delay(500);
    }

    assert.fail(
      `only saw fewer than ${expected} settled transactions for ${acq_alias}`,
    );
  } finally {
    await client.close();
  }
}

class DispatchingTester {
  private gateways: GatewayConnectTransaction[];
  private instances: ProviderInstance[];
  private merchant: ExtendedMerchant | undefined;

  constructor(
    private ctx: Context,
    private n: number,
    private opts: {
      cascade?: boolean;
      accepted_only?: boolean;
      rate?: string;
    } = {},
  ) {
    this.gateways = [...Array(n)].map(
      () => new GatewayConnectTransaction("manypay", {}, crypto.randomUUID()),
    );
    this.instances = this.gateways.map((gw) =>
      ctx.mock_server(gw.mock_params(ctx.uuid)),
    );
  }

  private alias(i: number): string {
    return `gc_${i}`;
  }

  private aliases(): string[] {
    return [...Array(this.n)].map((_, i) => this.alias(i));
  }

  private makeRule(mid: number, i: number) {
    return {
      header: {
        mid,
        acq_alias: this.alias(i),
        type: "pay",
      },
      // A synchronous decline is the trigger; the route defers to the ranked list rather
      // than naming a gate, so one rule per gate replaces a chain of them.
      body: this.opts.cascade ? { status: { not_in: ["declined"] } } : {},
      routing: this.opts.cascade
        ? { "status:not_in": { dispatching: true } }
        : null,
      action: null,
      dispatching: {
        list: this.aliases(),
        method: "conversion",
        rate: this.opts.rate ?? "1d#approved",
        // Off by default: a gate that refuses up front is charged for it
        accepted_only: this.opts.accepted_only ?? false,
      },
    };
  }

  async init() {
    this.merchant = await this.ctx.create_random_merchant();

    for (let i = 0; i < this.n; i++) {
      await this.ctx.add_flexy_guard_rule(
        this.makeRule(this.merchant.id, i),
        `Conversion dispatching rule for ${this.alias(i)}`,
      );
    }

    let settings = new SettingsBuilder();
    for (let i = 0; i < this.n; i++) {
      settings.withGateway(
        this.gateways[i].settings(this.ctx.uuid),
        this.alias(i),
      );
    }
    await this.merchant.set_settings(
      settings.addP2P(CURRENCY, this.alias(0)).build(),
    );
  }

  private request() {
    return common.p2pPaymentRequest(CURRENCY, REQUISITE_TYPE);
  }

  /** Queue a handler on the expected gate, pay, and return the payment token. */
  async pay_via(
    expected_gateway_idx: number,
    status: "approved" | "declined",
  ): Promise<string> {
    assert(this.merchant);

    let gw = this.gateways[expected_gateway_idx];
    let instance = this.instances[expected_gateway_idx];

    // A declined gate answers on the very first request: no requisites, nothing to poll
    if (status === "declined") {
      let provider_done = instance.queue(
        gw.requisites_payin_handler("declined", REQUISITE_TYPE),
      );
      let response = await this.merchant.create_payment(this.request());
      await response.followFirstProcessingUrl().then((r) => r.as_error());
      await provider_done;

      return response.token;
    }

    let provider_done = instance.queue(
      gw.requisites_payin_handler("pending", REQUISITE_TYPE),
    );

    let payment = await this.merchant.create_payment(this.request());
    await payment
      .followFirstProcessingUrl()
      .then((r) => r.as_trader_requisites());
    await provider_done;

    let approved = this.merchant.queue_notification((n) => {
      assert.strictEqual(n.status, "approved");
    });
    await gw.send_callback("approved");
    await approved;

    return payment.token;
  }

  /**
   * The gate produces a requisite and the payment is declined only afterwards, which is
   * the decline conversion actually counts. Returns the payment token.
   */
  async pay_declined_after_requisite(gateway_idx: number): Promise<string> {
    assert(this.merchant);

    let gw = this.gateways[gateway_idx];
    let provider_done = this.instances[gateway_idx].queue(
      gw.requisites_payin_handler("pending", REQUISITE_TYPE),
    );

    let payment = await this.merchant.create_payment(this.request());
    await payment
      .followFirstProcessingUrl()
      .then((r) => r.as_trader_requisites());
    await provider_done;

    let declined = this.merchant.queue_notification((n) => {
      assert.strictEqual(n.status, "declined");
    });
    await gw.send_callback("declined");
    await declined;

    return payment.token;
  }

  /**
   * The first gate declines synchronously, so the merchant never sees a requisite and the
   * payment is handed to the next-ranked gate, which pays out. Returns the payment token.
   */
  async pay_cascading(
    declining_idx: number,
    approving_idx: number,
  ): Promise<string> {
    assert(this.merchant);

    let declining = this.gateways[declining_idx];
    let approving = this.gateways[approving_idx];

    let declined_done = this.instances[declining_idx].queue(
      declining.requisites_payin_handler("declined", REQUISITE_TYPE),
    );
    let approved_done = this.instances[approving_idx].queue(
      approving.requisites_payin_handler("pending", REQUISITE_TYPE),
    );

    let payment = await this.merchant.create_payment(this.request());
    // The requisite comes from the second gate; the first one never produced one
    await payment
      .followFirstProcessingUrl()
      .then((r) => r.as_trader_requisites());

    await declined_done;
    await approved_done;

    let approved = this.merchant.queue_notification((n) => {
      assert.strictEqual(n.status, "approved");
    });
    await approving.send_callback("approved");
    await approved;

    return payment.token;
  }

  async assert_routed_to(
    token: string,
    gateway_idx: number,
    status: BusinessStatus,
  ): Promise<void> {
    let payment = await this.ctx.get_payment(token);

    assert.strictEqual(payment.gateway_alias, this.alias(gateway_idx));
    assert.strictEqual(payment.status, status);
  }

  async await_settled(gateway_idx: number, expected: number): Promise<void> {
    assert(this.merchant);
    await wait_for_settled(this.merchant.id, this.alias(gateway_idx), expected);
  }
}

describe
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("conversion dispatching tests", () => {
    test.concurrent("dispatches to the best converting alias", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let tester = new DispatchingTester(ctx, 3);
        await tester.init();

        // Nothing has settled yet, every alias scores 50% and the tie falls back to the
        // listed order, so this stays on the gate the payment came in on. It hands over a
        // requisite and only then fails, so the decline is charged to it.
        let first = await tester.pay_declined_after_requisite(0);
        await tester.assert_routed_to(first, 0, "declined");
        await tester.await_settled(0, 1);

        // gc_0 is now 0/1 => 33%, the untried aliases still score 50%.
        let second = await tester.pay_via(1, "approved");
        await tester.assert_routed_to(second, 1, "approved");
        await tester.await_settled(1, 1);

        // gc_1 is now 1/1 => 67% and keeps the traffic.
        let third = await tester.pay_via(1, "approved");
        await tester.assert_routed_to(third, 1, "approved");

        let forth = await tester.pay_via(1, "approved");
        await tester.assert_routed_to(forth, 1, "approved");

        let fifith = await tester.pay_via(1, "approved");
        await tester.assert_routed_to(fifith, 1, "approved");
      }));

    test.concurrent("cascades to the next ranked gate when one declines instantly", ({
      ctx,
    }) =>
      ctx.track_bg_rejections(async () => {
        let tester = new DispatchingTester(ctx, 3, { cascade: true });
        await tester.init();

        // Everything is untried, so the tie keeps the payment on gc_0, which then fails
        // to produce a requisite and hands off to the next-ranked gate.
        let token = await tester.pay_cascading(0, 1);
        await tester.assert_routed_to(token, 1, "approved");

        // Both halves of the cascade are recorded, against the gate that earned them.
        // The rule does not set accepted_only, so gc_0's refusal is charged to it.
        await tester.await_settled(0, 1);
        await tester.await_settled(1, 1);

        // gc_0 is now 0/1 => 33% and gc_1 is 1/1 => 67%, so the next payment starts on gc_1
        let next = await tester.pay_via(1, "approved");
        await tester.assert_routed_to(next, 1, "approved");
      }));

    // The next three share an opening move - gc_0 refuses a payment up front - and differ
    // only in whether accepted_only is set, which is what decides where the next one goes.

    test.concurrent("without accepted_only, a refusing gate drops out of the rotation", ({
      ctx,
    }) =>
      ctx.track_bg_rejections(async () => {
        let tester = new DispatchingTester(ctx, 2);
        await tester.init();

        // Both untried at 50%, so the tie keeps this on gc_0, which refuses up front
        let first = await tester.pay_via(0, "declined");
        await tester.assert_routed_to(first, 0, "declined");
        await tester.await_settled(0, 1);

        // The refusal is charged to gc_0, dropping it to 0/1 => 33%, so the untried
        // gc_1 at 50% now wins
        let second = await tester.pay_via(1, "declined");
        await tester.assert_routed_to(second, 1, "declined");
      }));

    test.concurrent("with accepted_only, a refusing gate stays in the rotation", ({
      ctx,
    }) =>
      ctx.track_bg_rejections(async () => {
        let tester = new DispatchingTester(ctx, 2, { accepted_only: true });
        await tester.init();

        let first = await tester.pay_via(0, "declined");
        await tester.assert_routed_to(first, 0, "declined");
        await tester.await_settled(0, 1);

        // gc_0 never produced a requisite, so the attempt is not scored at all: it is
        // still on the 50% prior, still tied with gc_1, and still first in the list
        let second = await tester.pay_via(0, "declined");
        await tester.assert_routed_to(second, 0, "declined");
      }));

    test.concurrent("accepted_only still counts a decline that followed a requisite", ({
      ctx,
    }) =>
      ctx.track_bg_rejections(async () => {
        let tester = new DispatchingTester(ctx, 2, { accepted_only: true });
        await tester.init();

        // This time gc_0 hands over a requisite and only then loses the payment, which
        // accepted_only does not excuse
        let first = await tester.pay_declined_after_requisite(0);
        await tester.assert_routed_to(first, 0, "declined");
        await tester.await_settled(0, 1);

        // gc_0 is 0/1 => 33%, so gc_1 takes over on its untouched 50%
        let second = await tester.pay_via(1, "approved");
        await tester.assert_routed_to(second, 1, "approved");
      }));

    test.concurrent("a 10 second window ages attempts out of the conversion", ({
      ctx,
    }) =>
      ctx.track_bg_rejections(async () => {
        let tester = new DispatchingTester(ctx, 2, { rate: "10s#approved" });
        await tester.init();

        // gc_0 takes a payment on and loses it. The attempt is timestamped when the
        // gate first answers, so the clock on this decline starts here.
        let first = await tester.pay_declined_after_requisite(0);
        await tester.assert_routed_to(first, 0, "declined");
        await tester.await_settled(0, 1);

        // Still inside the window, so gc_0 is 0/1 => 33% and loses to gc_1's untouched
        // 50%. This has to run within 10s of the attempt above, which it comfortably
        // does - a payment takes a second or two.
        let second = await tester.pay_via(1, "approved");
        await tester.assert_routed_to(second, 1, "approved");

        // Outrun the window. Both attempts are now older than 10s, so neither is in
        // scope any more and both gates are back on the bare 50% prior.
        await delay(13_000);

        // The tie falls back to the listed order, so the gate that was losing traffic a
        // moment ago gets it again - which only happens if the window really expired.
        let third = await tester.pay_via(0, "approved");
        await tester.assert_routed_to(third, 0, "approved");
      }));

    test.concurrent("one gate dominates conversion", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let tester = new DispatchingTester(ctx, 3);
        await tester.init();

        // Nothing has settled yet, every alias scores 50% and the tie falls back to the
        // listed order, so this stays on the gate the payment came in on. It hands over a
        // requisite and only then fails, so the decline is charged to it.
        let first = await tester.pay_declined_after_requisite(0);
        await tester.assert_routed_to(first, 0, "declined");
        await tester.await_settled(0, 1);

        // gc_0 is now 0/1 => 33%, the untried aliases still score 50%.
        let second = await tester.pay_via(1, "approved");
        await tester.assert_routed_to(second, 1, "approved");
        await tester.await_settled(1, 1);

        // gc_1 is now 1/1 => 67% and keeps the traffic.
        let third = await tester.pay_via(1, "approved");
        await tester.assert_routed_to(third, 1, "approved");

        let forth = await tester.pay_via(1, "declined");
        await tester.assert_routed_to(forth, 1, "declined");
      }));
  });
