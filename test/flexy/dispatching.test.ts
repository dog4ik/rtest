import { CONFIG } from "@/config";
import { test } from "@/test_context";
import { describe, assert } from "vitest";
import * as common from "@/common";
import { JusanPayment } from "@/provider_mocks/jusan";
import type { Context } from "@/test_context/context";
import type { ProviderInstance } from "@/mock_server/instance";
import type { ExtendedMerchant } from "@/entities/merchant";

const CURRENCY = "RUB";

class DispatchingTester {
  private secrets: string[];
  private instances: ProviderInstance[];
  private merchant: ExtendedMerchant | undefined;

  constructor(
    private ctx: Context,
    private n: number,
  ) {
    this.secrets = [...Array(n)].map(() => crypto.randomUUID());
    this.instances = this.secrets.map((secret) =>
      ctx.mock_server(JusanPayment.mock_params(secret)),
    );
  }

  private alias(i: number): string {
    return `jusan_${i}`;
  }

  private makeRule(mid: number, i: number) {
    const aliases = [...Array(this.n)].map((_, j) => this.alias(j));
    return {
      header: {
        mid: mid.toString(),
        acq_alias: this.alias(i),
        type: "pay",
      },
      body: {
        amount: {
          value: [0, Math.floor(Math.random() * 10000000000)],
        },
      },
      routing: null,
      action: null,
      dispatching: {
        list: aliases,
        method: "queue",
      },
    };
  }

  private makeSettings() {
    const gateways: Record<string, any> = { allow_host2host: true };
    for (let i = 0; i < this.n; i++) {
      gateways[this.alias(i)] = JusanPayment.settings(this.secrets[i]);
    }
    return {
      [CURRENCY]: {
        gateways: {
          pay: {
            default: this.alias(0),
          },
        },
      },
      gateways,
    };
  }

  async init() {
    this.merchant = await this.ctx.create_random_merchant();
    for (let i = 0; i < this.n; i++) {
      await this.ctx.add_flexy_guard_rule(
        this.makeRule(this.merchant.id, i),
        `Dispatching rule for jusan_${i}`,
      );
    }
    await this.merchant.set_settings(this.makeSettings());
  }

  // Queue a handler on the expected gateway and make a payment request.
  async pay_via(expected_gateway_idx: number): Promise<void> {
    assert(this.merchant);
    const payment = new JusanPayment();
    const provider_done = this.instances[expected_gateway_idx].queue(
      payment.create_response_handler("approved"),
    );
    const res = await this.merchant.create_payment({
      ...common.paymentRequest(CURRENCY),
      card: common.cardObject(),
    });
    assert.strictEqual(res.payment.status, "approved");
    await provider_done;
  }
}

describe
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("dispatching tests", () => {
    test.concurrent("cycles through 3 gateways in queue order", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        const tester = new DispatchingTester(ctx, 3);
        await tester.init();

        await tester.pay_via(0);
        await tester.pay_via(1);
        await tester.pay_via(2);

        await tester.pay_via(0);
        await tester.pay_via(1);
        await tester.pay_via(2);

        await tester.pay_via(0);
      }),
    );
  });
