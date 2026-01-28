import { test } from "@/test_context";
import { describe, assert } from "vitest";
import * as common from "@/common";
import { JusanPayment } from "@/provider_mocks/jusan";
import { defaultSettings } from "@/settings_builder";
import type { Context } from "@/test_context/context";
import type { ProviderInstance } from "@/mock_server/instance";
import type { ExtendedMerchant } from "@/entities/merchant";

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

describe.concurrent("limits tests", () => {
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
