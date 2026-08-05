import { delay } from "@std/async";
import { assert, describe } from "vitest";
import { CONFIG } from "@/config";
import { payinSuite, RoyalpayPayment } from "@/provider_mocks/royalpay";
import { defaultSettings } from "@/settings_builder";
import {
  type Callback,
  callbackFinalizationSuite,
  type Status,
  statusFinalizationSuite,
} from "@/suite_interfaces";
import { test } from "@/test_context";
import type { Context } from "@/test_context/context";

const CURRENCY = "EUR";

const cardSuite = () =>
  ({
    ...payinSuite(),
    settings: (secret) =>
      defaultSettings(CURRENCY, RoyalpayPayment.settings(secret)),
  }) as Callback & Status;

describe
  .runIf(CONFIG.in_project(["reactivepay", "8pay"]))
  .concurrent("royalpay tests", () => {
    callbackFinalizationSuite(cardSuite);
    statusFinalizationSuite(cardSuite);

    async function setupMerchant(ctx: Context) {
      let merchant = await ctx.create_random_merchant();
      await merchant.set_settings(
        defaultSettings(CURRENCY, RoyalpayPayment.settings(ctx.uuid)),
      );
      let royalpay = ctx.mock_server(RoyalpayPayment.mock_params(ctx.uuid));
      let payment = new RoyalpayPayment();
      return { merchant, royalpay, payment };
    }

    test.concurrent("royalpay successful refund", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { merchant, royalpay, payment } = await setupMerchant(ctx);
        royalpay
          .queue(payment.create_handler())
          .then(() => delay(2_000))
          .then(() => payment.send_callback("ok", ctx.uuid));
        royalpay
          .queue(payment.create_refund_handler("pending"))
          .then(() => delay(5_000))
          .then(() => payment.send_refund_callback("ok", ctx.uuid));

        let payment_approved = merchant.queue_notification((notification) => {
          assert.strictEqual(notification.status, "approved");
        });

        let refund_notifications =
          merchant.queue_refund_or_pay_notification("approved");

        let result = await merchant.create_payment(cardSuite().request());
        assert.strictEqual(result.payment.status, "pending");
        await payment_approved;

        await merchant.create_refund({
          token: result.token,
        });

        await refund_notifications;
      }));
  });
