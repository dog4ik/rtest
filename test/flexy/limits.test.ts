import { CONFIG, test } from "@/test_context";
import { describe, assert, assertType } from "vitest";
import * as common from "@/common";
import { JusanPayment } from "@/provider_mocks/jusan";
import { defaultSettings, SettingsBuilder } from "@/settings_builder";
import type { Context } from "@/test_context/context";
import type { ProviderInstance } from "@/mock_server/instance";
import type { ExtendedMerchant } from "@/entities/merchant";
import { BrusnikaPayment } from "@/provider_mocks/brusnika";
import { IronpayPayment } from "@/provider_mocks/ironpay";
import { delay } from "@std/async";

const CURRENCY = "RUB";

class LimitTester {
  private jusan_pay: ProviderInstance;
  private uuid: string;
  private merchant: ExtendedMerchant | undefined;
  constructor(private ctx: Context) {
    this.uuid = crypto.randomUUID();
    this.jusan_pay = ctx.mock_server(JusanPayment.mock_params(this.uuid));
  }

  async init(rule: (mid: number) => {}) {
    this.merchant = await this.ctx.create_random_merchant();
    await this.ctx.add_flexy_guard_rule(
      rule(this.merchant.id),
      "Limite tester rule",
    );
    await this.merchant.set_settings(
      defaultSettings(CURRENCY, JusanPayment.settings(this.uuid)),
    );
  }

  async run_n_approves(n: number) {
    assert(this.merchant);
    for (let i = 0; i < n; ++i) {
      let payment = new JusanPayment();
      let provider_approve = this.jusan_pay.queue(
        payment.create_response_handler("approved"),
      );
      let res = await this.merchant.create_payment({
        ...common.paymentRequest(CURRENCY),
        card: common.cardObject(),
      });
      assert.strictEqual(res.payment.status, "approved");
      await provider_approve;
    }

    for (let i = 0; i < 2; ++i) {
      await this.merchant.create_payment_err({
        ...common.paymentRequest(CURRENCY),
        card: common.cardObject(),
      });
    }
  }
}

describe
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("limits tests", () => {
    test.concurrent("daily approve limit", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let rule = (mid: number) => ({
          header: {
            mid,
            currency: "RUB",
            type: "pay",
          },
          body: {
            amount: {
              value: [0, 10000000],
            },
            status: {
              sum: {
                "1Europe/Moscow#approved#amount": [0, 99900000],
              },
            },
            card: {
              status: {
                count: {
                  "1Europe/Moscow#approved": [0, 2],
                },
              },
            },
          },
          routing: {},
          action: null,
          dispatching: null,
        });
        let tester = new LimitTester(ctx);
        await tester.init(rule);
        await tester.run_n_approves(2);
      }),
    );
  });

describe.runIf(CONFIG.in_project("spinpay")).concurrent("limits tests", () => {
  test.concurrent(
    "daily p2p approve routing",
    ({ ctx, merchant, brusnika, ironpay }) =>
      ctx.track_bg_rejections(async () => {
        let brusnika_payment = new BrusnikaPayment();
        let brusnika_payment2 = new BrusnikaPayment();
        let ironpay_payment = new IronpayPayment();
        let ironpay_payment2 = new IronpayPayment();
        let settings = new SettingsBuilder()
          .withGateway(IronpayPayment.settings(ctx.uuid), "ironpay")
          .withGateway(BrusnikaPayment.settings(ctx.uuid), "brusnika")
          .addP2P(CURRENCY, "brusnika");
        await merchant.set_settings(settings.build());
        let rule = {
          header: {
            mid: merchant.id.toString(),
            acq_alias: "brusnika",
          },
          body: {
            status: {
              sum: {
                "1Europe/Moscow#approved#amount": [0, 100],
              },
            },
          },
          routing: {
            "status:sum:1Europe/Moscow#approved#amount": {
              acq_alias: "ironpay",
            },
          },
          action: null,
          dispatching: null,
        };
        await ctx.add_flexy_guard_rule(rule, "test rule", 1);

        let brusnika_approved = merchant.queue_notification((n) => {
          assert.strictEqual(n.status, "approved");
        });
        brusnika
          .queue(brusnika_payment.create_handler("success"))
          .then(async () => {
            await delay(5_000);
            brusnika_payment.send_callback("success");
          });

        await merchant
          .create_payment({
            ...common.paymentRequest(CURRENCY),
            amount: 90,
            bank_account: { requisite_type: "sbp" },
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        await brusnika_approved;
        await delay(3_000);

        let ironpay_approved1 = merchant.queue_notification((n) => {
          assert.strictEqual(n.status, "approved");
        });
        // ironpay.queue(IronpayPayment.login_handler(ctx.uuid));
        // ironpay.queue(ironpay_payment.create_handler()).then(async () => {
        //   await delay(5_000);
        //   ironpay_payment.send_callback("Approved", ctx.uuid);
        // });
        brusnika
          .queue(brusnika_payment2.create_handler("in_progress"))
          .then(async () => {
            await delay(5_000);
            brusnika_payment2.send_callback("success");
          });

        await merchant
          .create_payment({
            ...common.paymentRequest(CURRENCY),
            amount: 90,
            bank_account: { requisite_type: "sbp" },
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        await ironpay_approved1;

        let ironpay_approved2 = merchant.queue_notification((n) => {
          assert.strictEqual(n.status, "approved");
        });
        ironpay.queue(IronpayPayment.login_handler(ctx.uuid));
        ironpay.queue(ironpay_payment2.create_handler());
        ironpay.queue(ironpay_payment2.status_handler("Approved"));

        await merchant
          .create_payment({
            ...common.paymentRequest(CURRENCY),
            amount: 100,
            bank_account: { requisite_type: "sbp" },
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        await ironpay_approved2;
      }),
  );
});
