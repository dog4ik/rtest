import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { BrusnikaPayment } from "@/provider_mocks/brusnika";
import { test } from "@/test_context";
import { STATIC_RATE } from "@/provider_mocks/rate";

const TRADER_DELAY = 5_000;

// Routing trader -> trader does not work
describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("trader routing tests", () => {
    test.concurrent("trader -> trader routing approved payin", ({
      ctx,
      merchant,
    }) =>
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

    test.concurrent("trader -> trader routing by amount", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader1 = await ctx.create_random_trader({
          usdt: true,
        });
        let trader2 = await ctx.create_random_trader({
          usdt: true,
        });
        await trader1.setup({ card: true, bank: "sberbank" });
        await trader2.setup({ card: true, bank: "tbank" });
        await trader1.cashin("main", "USDT", common.amount);
        await trader2.cashin("main", "USDT", common.amount);
        await ctx.add_flexy_guard_rule({
          header: {
            mid: merchant.id,
            acq_alias: "trader1",
          },
          body: {
            amount: {
              value: [0, 50000],
            },
          },
          routing: {
            "amount:value": {
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
              list: [trader1.id],
              class: "trader",
              pay_expired_minutes: 15,
              private_key: "1ccca8894bf0baabb47ef6695c0f0f18",
              wrapped_to_json_response: true,
            },
            trader2: {
              list: [trader2.id],
              class: "trader",
              pay_expired_minutes: 15,
              private_key: "1ccca8894bf0baabb47ef6695c0f0f18",
              wrapped_to_json_response: true,
            },
          },
        });
        let approve_cb = merchant.queue_notification(
          (n) => {
            assert.strictEqual(n.type, "pay");
            assert.strictEqual(n.status, "approved");
          },
          { expect: { status: 1, type: "PayinRequest" } },
        );
        let res = await merchant
          .create_payment({
            ...common.traderPaymentRequest("RUB", "card"),
            amount: 50005,
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        await delay(TRADER_DELAY);
        await trader2.finalizeTransaction(res.token, "approved");
        await approve_cb;
      }));

    test.concurrent("trader -> trader routing with randomizer", ({
      ctx,
      merchant,
    }) =>
      ctx.track_bg_rejections(async () => {
        let trader1 = await ctx.create_random_trader({
          usdt: true,
        });
        let trader2 = await ctx.create_random_trader({
          usdt: true,
        });
        let trader1_setup = await trader1.setup({
          card: true,
          bank: "sberbank",
        });
        await trader2.setup({ card: true, bank: "tbank" });
        await trader1_setup.card.edit({
          min_amount_float: (common.amount * STATIC_RATE) / 100 + 1,
          max_amount_float: (common.amount * STATIC_RATE) / 100 + 400,
        });
        await trader1.cashin("main", "USDT", common.amount);
        await trader2.cashin("main", "USDT", common.amount);
        await ctx.add_flexy_guard_rule({
          header: {
            mid: merchant.id,
            type: "pay",
            amount: {
              range: [
                common.amount * STATIC_RATE + 1,
                common.amount * STATIC_RATE + 99999,
              ],
            },
            acq_alias: "trader1",
          },
          body: {
            amount: {
              value: [0, 0],
            },
          },
          routing: {
            "amount:value": {
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
              list: [trader1.id],
              class: "trader",
              pay_expired_minutes: 1,
              random_step: 100,
              random_range: [100, 300],
              random_retries: 3,
              private_key: "1ccca8894bf0baabb47ef6695c0f0f18",
              wrapped_to_json_response: true,
            },
            trader2: {
              list: [trader2.id],
              class: "trader",
              pay_expired_minutes: 1,
              random_step: 100,
              random_range: [100, 300],
              random_retries: 3,
              private_key: "1ccca8894bf0baabb47ef6695c0f0f18",
              wrapped_to_json_response: true,
            },
          },
        });
        let res = await merchant.create_payment({
          ...common.traderPaymentRequest("RUB", "card"),
          amount: common.amount * STATIC_RATE,
        });
        await res.followFirstProcessingUrl().then((r) => r.as_trader_requisites());
        await delay(TRADER_DELAY);
        await ctx.healthcheck(res.token);
      }));

    test.concurrent("brusnika -> trader routing approved payin", ({
      ctx,
      merchant,
    }) =>
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
