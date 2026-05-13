import { describe, assert } from "vitest";
import { test } from "@/test_context";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { defaultSettings } from "@/settings_builder";
import {
  ReactivepayTransaction,
  payoutSuite,
} from "@/provider_mocks/reactivepay";
import { payoutPendingSuite, callbackFinalizationSuite } from "@/suite_interfaces";

const CURRENCY = "USD";

describe
  .runIf(CONFIG.in_project(["reactivepay", "paysure", "8pay"]))
  .concurrent("reactivepay payout", () => {
    callbackFinalizationSuite(() => payoutSuite(CURRENCY));
    payoutPendingSuite(payoutSuite(CURRENCY));

    test.concurrent("insta approved payout", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let gw = new ReactivepayTransaction("reactivepay");
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          defaultSettings(CURRENCY, gw.settings(ctx.uuid)),
        );
        let provider = ctx.mock_server(
          ReactivepayTransaction.mock_params(ctx.uuid),
        );

        provider.queue(gw.payout_create_handler("approved"));

        let notification = merchant.queue_notification((callback) => {
          assert.strictEqual(callback.status, "approved");
        });

        await merchant.cashin(CURRENCY, common.amount / 100);
        await merchant.create_payout({
          ...common.payoutRequest(CURRENCY),
          card: { pan: common.visaCard },
        });
        await notification;
      });
    });

    test.concurrent("insta declined payout", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let gw = new ReactivepayTransaction("reactivepay");
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          defaultSettings(CURRENCY, gw.settings(ctx.uuid)),
        );
        let provider = ctx.mock_server(
          ReactivepayTransaction.mock_params(ctx.uuid),
        );

        provider.queue(gw.payout_create_handler("declined"));

        let notification = merchant.queue_notification((callback) => {
          assert.strictEqual(callback.status, "declined");
        });

        await merchant.cashin(CURRENCY, common.amount / 100);
        await merchant.create_payout({
          ...common.payoutRequest(CURRENCY),
          card: { pan: common.visaCard },
        });
        await notification;
      });
    });
  });
