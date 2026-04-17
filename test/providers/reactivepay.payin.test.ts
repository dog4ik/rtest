import { callbackFinalizationSuite } from "@/suite_interfaces";
import {
  payinSuite,
  ReactivepayTransaction,
} from "@/provider_mocks/reactivepay";
import { CONFIG } from "@/config";
import { assert, describe } from "vitest";
import { test } from "@/test_context";
import * as common from "@/common";
import { defaultSettings } from "@/settings_builder";
import { delay } from "@std/async";

const CURRENCY = "USD";

describe
  .runIf(CONFIG.in_project(["reactivepay", "paysure"]))
  .concurrent("reactivepay payin", () => {
    callbackFinalizationSuite(() => payinSuite(CURRENCY));

    test.concurrent(
      "declined response with immediate declined callback sends single notification",
      async ({ ctx }) => {
        await ctx.track_bg_rejections(async () => {
          let gw = new ReactivepayTransaction();
          let merchant = await ctx.create_random_merchant();
          await merchant.set_settings(
            defaultSettings(
              CURRENCY,
              ReactivepayTransaction.settings(ctx.uuid),
            ),
          );
          let provider = ctx.mock_server(
            ReactivepayTransaction.mock_params(ctx.uuid),
          );

          provider.queue(gw.create_handler("declined")).then(async () => {
            await gw.send_callback("declined", ctx.uuid);
          });

          let notification = merchant.queue_notification((callback) => {
            assert.strictEqual(callback.status, "declined");
          });
          let second_notification = merchant.queue_notification(() => {
            assert.fail("merchant should get only one notification");
          });

          await merchant.create_payment({
            ...common.paymentRequest(CURRENCY),
            card: common.cardObject(),
          });
          await notification;
          await Promise.race([delay(4_000), second_notification]);
        });
      },
    );

    test.concurrent("insta approved transaction", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let gw = new ReactivepayTransaction();
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          defaultSettings(CURRENCY, ReactivepayTransaction.settings(ctx.uuid)),
        );
        let provider = ctx.mock_server(
          ReactivepayTransaction.mock_params(ctx.uuid),
        );

        provider.queue(gw.create_handler("approved"));

        let notification = merchant.queue_notification((callback) => {
          assert.strictEqual(callback.status, "approved");
        });
        await merchant.create_payment({
          ...common.paymentRequest(CURRENCY),
          card: common.cardObject(),
        });
        await notification;
      });
    });

    test.concurrent("insta declined transaction", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let gw = new ReactivepayTransaction();
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          defaultSettings(CURRENCY, ReactivepayTransaction.settings(ctx.uuid)),
        );
        let provider = ctx.mock_server(
          ReactivepayTransaction.mock_params(ctx.uuid),
        );

        provider.queue(gw.create_handler("declined"));

        let notification = merchant.queue_notification((callback) => {
          assert.strictEqual(callback.status, "declined");
        });
        await merchant.create_payment({
          ...common.paymentRequest(CURRENCY),
          card: common.cardObject(),
        });
        await notification;
      });
    });
  });
