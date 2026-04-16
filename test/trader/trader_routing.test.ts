import { CONFIG } from "@/config";
import { test } from "@/test_context";
import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as common from "@/common";

const TRADER_DELAY = 5_000;

describe
  .runIf(CONFIG.in_project(["reactivepay"]))
  .concurrent("trader routing tests", () => {
    test.concurrent("trader routing approved payin", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader_with_balance = await ctx.create_random_trader({
          usdt: false,
        });
        let trader_without_balance = await ctx.create_random_trader({
          usdt: false,
        });
        await trader_with_balance.setup({ card: true, bank: "sberbank" });
        await trader_without_balance.setup({ card: true, bank: "sberbank" });
        await trader_with_balance.cashin("main", "USDT", common.amount / 100);
        await merchant.set_settings({
          USDT: {
            gateways: {
              pay: {
                providers: [
                  {
                    trader: "trader",
                  },
                ],
              },
            },
          },
          convert_to: "USDT",
          gateways: {
            allow_host2host: true,
            skip_processing_url: true,
            trader1: {
              list: [trader_without_balance.id],
              class: "trader",
              pay_expired_minutes: 15,
              private_key: "1ccca8894bf0baabb47ef6695c0f0f18",
              wrapped_to_json_response: true,
            },
            trader_out: {
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
        let feed = await trader_with_balance.finalizeTransaction(res.token, "approved");
        await approve_cb;
      }),
    );
  });
