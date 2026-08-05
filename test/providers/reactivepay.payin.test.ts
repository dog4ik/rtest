import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import {
  payinSuite,
  ReactivepayTransaction,
} from "@/provider_mocks/reactivepay";
import { defaultSettings, providers } from "@/settings_builder";
import { callbackFinalizationSuite } from "@/suite_interfaces";
import { test } from "@/test_context";

const CURRENCY = "USD";

describe
  .runIf(CONFIG.in_project(["reactivepay", "paysure", "8pay", "spinpay"]))
  .concurrent("reactivepay payin", () => {
    callbackFinalizationSuite(() => payinSuite(CURRENCY));

    test.concurrent("declined response with immediate declined callback sends single notification", async ({
      ctx,
    }) => {
      await ctx.track_bg_rejections(async () => {
        let gw = new ReactivepayTransaction("reactivepay");
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          defaultSettings(CURRENCY, gw.settings(ctx.uuid)),
        );
        let provider = ctx.mock_server(
          ReactivepayTransaction.mock_params(ctx.uuid),
        );

        provider.queue(gw.h2h_create_handler("declined")).then(async () => {
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
    });

    test.concurrent("insta approved transaction", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let gw = new ReactivepayTransaction("reactivepay");
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          defaultSettings(CURRENCY, gw.settings(ctx.uuid)),
        );
        let provider = ctx.mock_server(
          ReactivepayTransaction.mock_params(ctx.uuid),
        );

        provider.queue(gw.h2h_create_handler("approved"));

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
        let gw = new ReactivepayTransaction("reactivepay");
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          defaultSettings(CURRENCY, gw.settings(ctx.uuid)),
        );
        let provider = ctx.mock_server(
          ReactivepayTransaction.mock_params(ctx.uuid),
        );

        provider.queue(gw.h2h_create_handler("declined"));

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

describe
  .runIf(CONFIG.in_project(["reactivepay", "paysure", "spinpay"]))
  .concurrent("reactivepayp2p payin", () => {
    test.concurrent("approved with provider redirect", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let gw = new ReactivepayTransaction("reactivepayp2p");
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(providers(CURRENCY, gw.settings(ctx.uuid)));
        let provider = ctx.mock_server(
          ReactivepayTransaction.mock_params(ctx.uuid),
        );

        provider.queue(gw.p2p_create_handler());

        provider
          .queue(gw.processing_requisite_handler("pending", "card"))
          .then(async () => {
            await delay(5_000);
            await gw.send_callback("approved", ctx.uuid);
          });

        let notification = merchant.queue_notification((callback) => {
          assert.strictEqual(callback.status, "approved");
        });
        let second_notification = merchant.queue_notification(() => {
          assert.fail("merchant should get only one notification");
        });

        await merchant
          .create_payment({
            ...common.p2pPaymentRequest(CURRENCY, "card"),
          })
          .then((p) => p.followFirstProcessingUrl())
          .then((p) => p.as_trader_requisites());
        await notification;
        await Promise.race([delay(4_000), second_notification]);
      });
    });
  });
