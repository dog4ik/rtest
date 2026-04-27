import { CONFIG } from "@/config";
import { test } from "@/test_context";
import { describe, assert } from "vitest";
import * as common from "@/common";
import { BrusnikaPayment } from "@/provider_mocks/brusnika";
import { SettingsBuilder } from "@/settings_builder";
import type { Context } from "@/test_context/context";
import type { ProviderInstance } from "@/mock_server/instance";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { Handler } from "@/mock_server/api";

const CURRENCY = "RUB";

type RandomizerSettings = {
  random_range: [number, number];
  random_retries: number;
  random_step: number;
};

class RandomizerTester {
  private uuid: string;
  private brusnika: ProviderInstance;
  private merchant: ExtendedMerchant | undefined;
  private observed_amounts: number[] = [];
  private settings: RandomizerSettings;

  constructor(private ctx: Context) {
    this.uuid = crypto.randomUUID();
    this.settings = {
      random_step: 100,
      random_range: [100, 300],
      random_retries: 3,
    };
    this.brusnika = ctx.mock_server(BrusnikaPayment.mock_params(this.uuid));
  }

  async init(settings: RandomizerSettings) {
    this.settings = settings;
    this.merchant = await this.ctx.create_random_merchant();
    await this.merchant.set_settings(
      new SettingsBuilder()
        .addP2P(CURRENCY, "Brusnika", "gateway")
        .withGateway(
          { ...BrusnikaPayment.settings(this.uuid), ...settings },
          "Brusnika",
        )
        .build(),
    );
  }

  // Captures the amount from each gateway request and returns no_requisites,
  // which the business layer maps to a decline and triggers a randomizer retry.
  private capturing_decline_handler(): Handler {
    return async (c) => {
      let body = await c.req.json();
      this.observed_amounts.push(body.amount * 100);
      return c.json(BrusnikaPayment.no_requisites_response());
    };
  }

  queue_decline() {
    return this.brusnika.queue(this.capturing_decline_handler());
  }

  // Queues `n` decline handlers
  queue_declines(n: number) {
    for (let i = 0; i < n; i++) {
      this.queue_decline();
    }
  }

  async pay_expecting_decline() {
    assert(this.merchant);
    let notification = this.merchant.queue_notification((n) => {
      assert.strictEqual(n.status, "declined");
    });
    await this.merchant
      .create_payment(common.p2pPaymentRequest(CURRENCY, "card"))
      .then((p) => p.followFirstProcessingUrl());
    await notification;
  }

  // Queues an approve handler as the next gateway call, then creates a payment.
  // Any prior queued decline handlers fire first (triggering retries), and the
  // approve handler fires on the next retry. Finalizes via callback.
  async queue_and_pay_approve() {
    assert(this.merchant);
    let payment = new BrusnikaPayment();
    let notification = this.merchant.queue_notification((n) => {
      assert.strictEqual(n.status, "approved");
    });
    let provider_done = this.brusnika.queue(
      payment.create_handler("in_progress"),
    );
    await this.merchant
      .create_payment(common.p2pPaymentRequest(CURRENCY, "card"))
      .then((p) => p.followFirstProcessingUrl());
    await provider_done;
    // request_data is populated by create_handler once the gateway is called
    this.observed_amounts.push(payment.request_data!.amount * 100);
    await payment.send_callback("success");
    await notification;
  }

  get request_count() {
    return this.observed_amounts.length;
  }

  private assert_request_count(expected: number) {
    assert.strictEqual(
      this.observed_amounts.length,
      expected,
      `Expected ${expected} gateway request(s), got ${this.observed_amounts.length}. Amounts: [${this.observed_amounts.join(", ")}]`,
    );
  }

  private assert_all_amounts_unique() {
    let unique = new Set(this.observed_amounts);
    assert.strictEqual(
      unique.size,
      this.observed_amounts.length,
      `All amounts sent to the gateway must be unique. Got: [${this.observed_amounts.join(", ")}]`,
    );
  }

  private assert_all_amounts_are_valid() {
    for (let amount of this.observed_amounts) {
      let amount_delta = amount - common.amount;
      assert(
        amount_delta >= 0,
        `randomized amount sholud positive, got ${amount_delta}`,
      );
      assert(
        amount_delta % this.settings?.random_step === 0,
        `randomized amount should multiple of step (random_amound % random_step === 0), got ${amount_delta} (step ${this.settings?.random_step})`,
      );
    }
  }

  // Verifies that every retry amount (all except the first, which is the
  // unrandomized initial request) is within the configured random_range.
  private assert_retry_amounts_in_range() {
    let [lo, hi] = this.settings.random_range;
    let initial = this.observed_amounts[0];
    for (let amount of this.observed_amounts.slice(1)) {
      let added_cents = Math.round(amount - initial);
      assert(
        added_cents >= lo && added_cents <= hi,
        `Retry amount ${amount} is out of range: added ${added_cents} cents, expected [${lo}, ${hi}]`,
      );
    }
  }

  assert_state(request_count: number) {
    this.assert_request_count(request_count);
    this.assert_all_amounts_unique();
    this.assert_all_amounts_are_valid();
    this.assert_retry_amounts_in_range();
  }
}

describe
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("randomizer", () => {
    // range [100,200] step 100 -> candidate list has exactly 2 values.
    // random_retries:3 is capped to 2 by the list size.
    // Sequence: original -> original+a -> original+b -> final decline.
    // A repeated amount means a retry fired without actually changing the amount.
    test.concurrent(
      "all retries declined - unique amount on each gateway request",
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let tester = new RandomizerTester(ctx);
          await tester.init({
            random_range: [100, 200],
            random_retries: 3,
            random_step: 100,
          });

          // 1 initial + 2 retries (list has 2 elements) = 3 gateway calls.
          tester.queue_declines(3);

          await tester.pay_expecting_decline();
          tester.assert_state(3);
        }),
    );

    // First gateway call declined, randomizer retries with a different amount
    // which is approved. The two amounts must differ.
    test.concurrent(
      "approved on retry - retry amount differs from initial attempt",
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let tester = new RandomizerTester(ctx);
          await tester.init({
            random_range: [100, 200],
            random_retries: 3,
            random_step: 100,
          });

          tester.queue_decline();
          await tester.queue_and_pay_approve();

          tester.assert_state(2);
        }),
    );
  });

describe
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("randomizer settings combinations", () => {
    // range [100, 300] step 100 -> list = [100, 200, 300] (3 elements).
    // random_retries:3 matches list size exactly -> all 3 retries fire, each with
    // a unique amount. Total gateway calls: 1 initial + 3 retries = 4.
    test.concurrent(
      "range fills retries exactly - 3 retries all get unique amounts",
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let tester = new RandomizerTester(ctx);
          await tester.init({
            random_range: [100, 300],
            random_retries: 3,
            random_step: 100,
          });

          tester.queue_declines(4);

          await tester.pay_expecting_decline();
          tester.assert_state(4);
        }),
    );

    // range [100, 150] step 100 -> list = [100] (only 1 element fits).
    // random_retries:5 is capped to 1 by the list size.
    // Total gateway calls: 1 initial + 1 retry = 2.
    test.concurrent(
      "retries capped by list size when step is too large for range",
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let tester = new RandomizerTester(ctx);
          await tester.init({
            random_range: [100, 150],
            random_retries: 5,
            random_step: 100,
          });

          tester.queue_declines(2);

          await tester.pay_expecting_decline();
          tester.assert_state(2);
        }),
    );

    // range [200, 100]: start > end -> step produces an empty list.
    // No valid retry amounts exist, so no retries should be attempted.
    // Total gateway calls: 1 (initial), then immediate final decline.
    test.concurrent("inverted range - no retries attempted", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let tester = new RandomizerTester(ctx);
        await tester.init({
          random_range: [200, 100],
          random_retries: 3,
          random_step: 100,
        });

        tester.queue_declines(1);

        await tester.pay_expecting_decline();
        tester.assert_state(1);
      }),
    );

    // range [100, 200] step 50 -> list = [100, 150, 200] (3 elements).
    // random_retries:3 matches list size -> all 3 retries fire.
    // A smaller step produces more distinct candidate amounts from the same range.
    test.concurrent(
      "fine-grained step produces 3 unique retry amounts within same range",
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let tester = new RandomizerTester(ctx);
          await tester.init({
            random_range: [100, 200],
            random_retries: 3,
            random_step: 50,
          });

          tester.queue_declines(4);

          await tester.pay_expecting_decline();
          tester.assert_state(4);
        }),
    );

    // range [100, 300] step 100 -> list = [100, 200, 300] (3 elements).
    // random_retries:2 is less than list size -> only 2 elements are taken.
    // Total gateway calls: 1 initial + 2 retries = 3.
    test.concurrent(
      "random_retries caps list when it is smaller than available steps",
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let tester = new RandomizerTester(ctx);
          await tester.init({
            random_range: [100, 300],
            random_retries: 2,
            random_step: 100,
          });

          tester.queue_declines(3);

          await tester.pay_expecting_decline();
          tester.assert_state(3);
        }),
    );

    // random_retries:0 means no retries are configured at all.
    // The initial request is made, it is declined, and the payment finalises
    // immediately without the randomizer touching the amount.
    test.concurrent(
      "zero retries - declines immediately without attempting any retry",
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let tester = new RandomizerTester(ctx);
          await tester.init({
            random_range: [100, 200],
            random_retries: 0,
            random_step: 100,
          });

          tester.queue_declines(1);

          await tester.pay_expecting_decline();
          tester.assert_state(1);
        }),
    );

    // random_retries:0 means no retries are configured at all.
    // The initial request is made, it is approved, and the payment finalises
    // immediately without the randomizer touching the amount.
    test.concurrent(
      "zero retries - approves immediately without attempting any retry",
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let tester = new RandomizerTester(ctx);
          await tester.init({
            random_range: [100, 200],
            random_retries: 0,
            random_step: 100,
          });

          await tester.queue_and_pay_approve();
          tester.assert_state(1);
        }),
    );

    // range [100, 100]: start == end -> only one value in the list.
    // random_retries:3 is capped to 1 by list size.
    // Total gateway calls: 1 initial + 1 retry = 2.
    test.concurrent(
      "single-value range - only one retry possible regardless of retries setting",
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let tester = new RandomizerTester(ctx);
          await tester.init({
            random_range: [100, 100],
            random_retries: 3,
            random_step: 100,
          });

          tester.queue_declines(2);

          await tester.pay_expecting_decline();
          tester.assert_state(2);
        }),
    );

    // range [100, 300] step 100 -> 3 retry candidates.
    // First 2 are declined, 3rd is approved. All 3 gateway amounts must be
    // unique - the approve fires with a distinct amount, not the original.
    test.concurrent(
      "approved after 2 declines - all 3 gateway amounts are unique",
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let tester = new RandomizerTester(ctx);
          await tester.init({
            random_range: [100, 300],
            random_retries: 3,
            random_step: 100,
          });

          tester.queue_decline();
          tester.queue_decline();
          await tester.queue_and_pay_approve();

          tester.assert_state(3);
        }),
    );

    /// Common case with declined
    test.concurrent("common use case declined", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let tester = new RandomizerTester(ctx);
        await tester.init({
          random_range: [1000, 12000],
          random_retries: 5,
          random_step: 1000,
        });

        tester.queue_declines(6);
        await tester.pay_expecting_decline();

        tester.assert_state(6);
      }),
    );

    /// Common case with declined
    test.concurrent("common use case approved", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let tester = new RandomizerTester(ctx);
        await tester.init({
          random_range: [1000, 12000],
          random_retries: 5,
          random_step: 1000,
        });

        tester.queue_declines(5);
        await tester.queue_and_pay_approve();

        tester.assert_state(6);
      }),
    );

    /// Common case early approve
    test.concurrent("common use case early approved", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let tester = new RandomizerTester(ctx);
        await tester.init({
          random_range: [1000, 12000],
          random_retries: 5,
          random_step: 1000,
        });

        tester.queue_declines(2);
        await tester.queue_and_pay_approve();

        tester.assert_state(3);
      }),
    );
  });
