import { CONFIG } from "@/config";
import { test } from "@/test_context";
import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as common from "@/common";
import { BrusnikaPayment } from "@/provider_mocks/brusnika";

const TRADER_DELAY = 5_000;

// Routing trader -> trader does not work
describe.runIf(CONFIG.in_project(["reactivepay"])).skip("trader routing tests", () => {
  test.concurrent("trader routing approved payin", ({ ctx, merchant }) =>
    ctx.track_bg_rejections(async () => {
      let trader_with_balance = await ctx.create_random_trader({
        usdt: true,
      });
      let trader_without_balance = await ctx.create_random_trader({
        usdt: true,
      });
      await trader_with_balance.setup({ card: true, bank: "sberbank" });
      await trader_without_balance.setup({ card: true, bank: "sberbank" });
      await trader_with_balance.cashin("main", "USDT", common.amount / 100);
      await ctx.add_flexy_guard_rule({
        header: {
          mid: merchant.id.toString(),
          acq_alias: "trader1",
        },
        body: {
          status: {
            not_in: ["declined"],
          },
        },
        routing: {
          "status:not_in": {
            acq_alias: "trader2",
          },
        },
        action: null,
        dispatching: null,
      });
      await merchant.set_settings({
        USDT: {
          gateways: {
            pay: {
              providers: [
                {
                  trader: "trader1",
                },
              ],
            },
          },
        },
        convert_to: "USDT",
        gateways: {
          allow_host2host: true,
          trader1: {
            list: [trader_without_balance.id],
            class: "trader",
            pay_expired_minutes: 15,
            private_key: "1ccca8894bf0baabb47ef6695c0f0f18",
            wrapped_to_json_response: true,
          },
          trader2: {
            list: [trader_with_balance.id],
            class: "trader",
            pay_expired_minutes: 15,
            private_key: "1ccca8894bf0baabb47ef6695c0f0f18",
            wrapped_to_json_response: true,
          },
        },
      });
      let approve_cb = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "pay");
        assert.strictEqual(n.status, "approved");
      });
      let res = await merchant
        .create_payment({
          ...common.traderPaymentRequest("RUB", "card"),
        })
        .then((r) => r.followFirstProcessingUrl())
        .then((r) => r.as_trader_requisites());

      await delay(TRADER_DELAY);
      await trader_with_balance.finalizeTransaction(res.token, "approved");
      await approve_cb;
    }));

  test.concurrent("trader routing approved payin", ({ ctx, merchant }) =>
    ctx.track_bg_rejections(async () => {
      let trader_with_balance = await ctx.create_random_trader({
        usdt: true,
      });
      await trader_with_balance.setup({ card: true, bank: "sberbank" });
      await trader_with_balance.cashin("main", "USDT", common.amount / 100);
      await ctx.add_flexy_guard_rule({
        header: {
          mid: merchant.id.toString(),
          acq_alias: "brus",
        },
        body: {
          status: {
            not_in: ["declined"],
          },
        },
        routing: {
          "status:not_in": {
            acq_alias: "trader1",
          },
        },
        action: null,
        dispatching: null,
      });
      await merchant.set_settings({
        USDT: {
          gateways: {
            pay: {
              providers: [
                {
                  trader: "brus",
                },
              ],
            },
          },
        },
        convert_to: "USDT",
        gateways: {
          allow_host2host: true,
          trader1: {
            list: [trader_with_balance.id],
            class: "trader",
            pay_expired_minutes: 15,
            private_key: "1ccca8894bf0baabb47ef6695c0f0f18",
            wrapped_to_json_response: true,
          },
          brus: {
            ...BrusnikaPayment.settings(ctx.uuid),
          },
        },
      });
      let approve_cb = merchant.queue_notification((n) => {
        assert.strictEqual(n.type, "pay");
        assert.strictEqual(n.status, "approved");
      });
      let brusnika = ctx.mock_server(BrusnikaPayment.mock_params(ctx.uuid));
      brusnika.queue(BrusnikaPayment.no_requisites_handler());
      let res = await merchant
        .create_payment({
          ...common.traderPaymentRequest("RUB", "card"),
        })
        .then((r) => r.followFirstProcessingUrl())
        .then((r) => r.as_trader_requisites());

      await delay(TRADER_DELAY);
      await trader_with_balance.finalizeTransaction(res.token, "approved");
      await approve_cb;
    }));
});
