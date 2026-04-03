import { CONFIG } from "@/config";
import { test } from "@/test_context";
import { describe, assert } from "vitest";
import * as common from "@/common";
import { JusanPayment } from "@/provider_mocks/jusan";
import { MongoClient } from "mongodb";
import type { Context } from "@/test_context/context";
import type { ProviderInstance } from "@/mock_server/instance";
import type { ExtendedMerchant } from "@/entities/merchant";

// nasty solition to remove flaky tests
async function reset_dispatching_queue(aliases: string[]): Promise<void> {
  let client = new MongoClient("mongodb://localhost:27017");
  try {
    await client.connect();
    await client
      .db("counters")
      .collection("dispatching")
      .deleteOne({ dispatching: aliases });
  } finally {
    await client.close();
  }
}

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
    let aliases = this.aliases();
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
    let gateways: Record<string, any> = { allow_host2host: true };
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

  private aliases(): string[] {
    return [...Array(this.n)].map((_, i) => this.alias(i));
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
    await reset_dispatching_queue(this.aliases());
  }

  // Queue a handler on the expected gateway and make a payment request.
  async pay_via(expected_gateway_idx: number): Promise<void> {
    assert(this.merchant);
    let payment = new JusanPayment();
    let provider_done = this.instances[expected_gateway_idx].queue(
      payment.create_response_handler("approved"),
    );
    let res = await this.merchant.create_payment({
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
        let tester = new DispatchingTester(ctx, 3);
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
