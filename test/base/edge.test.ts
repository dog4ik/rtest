import { BrusnikaPayment } from "@/provider_mocks/brusnika";
import * as common from "@/common";
import { providers } from "@/settings_builder";
import * as default_gateway from "@/provider_mocks/default";
import { test } from "@/test_context";
import { delay } from "@std/async";
import { assert } from "vitest";

test.concurrent(
  "payin insufficient balance p2p",
  { timeout: 20_000 },
  async ({ ctx, merchant, brusnika: _, onTestFailed }) => {
    onTestFailed(async (ctx) => {
      await ctx.annotate(
        "This test can fail if required commission definitions are missing",
      );
    });
    await ctx.track_bg_rejections(async () => {
      await merchant.set_settings(
        providers("RUB", BrusnikaPayment.settings(ctx.uuid)),
      );
      await merchant.set_commission({
        self_fee: "10000",
        operation: "PayinRequest",
      });
      let res = await merchant.create_payment(common.paymentRequest("RUB"));
      let notification = merchant.queue_notification((notification) => {
        assert.strictEqual(notification.status, "approved");
      });
      console.log(
        await res
          .followFirstProcessingUrl()
          .then((r) => r.as_trader_requisites()),
      );
      await notification;
    });
  },
);

test.concurrent(
  "payin insufficient balance default",
  async ({ ctx, merchant, onTestFailed }) => {
    await ctx.track_bg_rejections(async () => {
      onTestFailed(async (ctx) => {
        await ctx.annotate(
          "This test can fail if required commission definitions are missing",
        );
      });
      await merchant.set_settings(default_gateway.fullSettings("RUB"));
      await merchant.set_commission({
        self_fee: "10000",
        operation: "PayinRequest",
      });
      let notification = merchant.queue_notification((notification) => {
        assert.strictEqual(notification.status, "declined");
      });
      await merchant.create_payment(
        default_gateway.request("RUB", 1000, "pay", true),
      );
      await notification;
    });
  },
);
