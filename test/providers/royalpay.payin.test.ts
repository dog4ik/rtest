import { defaultSettings } from "@/settings_builder";
import { test } from "@/test_context";
import { RoyalpayPayment } from "@/provider_mocks/royalpay";
import {
  callbackFinalizationSuite,
  statusFinalizationSuite,
  type Callback,
  type Status,
} from "@/suite_interfaces";
import { payinSuite } from "@/provider_mocks/royalpay";
import type { Context } from "@/test_context/context";
import { assert, describe } from "vitest";
import { delay } from "@std/async";
import { CONFIG } from "@/config";

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
          .queue(payment.refund_handler("pending"))
          .then(() => delay(5_000))
          .then(() => payment.send_refund_callback("ok", ctx.uuid));

        let payment_approved = merchant.queue_notification((notification) => {
          assert.strictEqual(notification.status, "approved");
        });

        let refunded_payment = merchant.queue_notification(
          (notification) => {
            assert.strictEqual(notification.type, "pay");
            assert.strictEqual(notification.status, "refunded");
          },
          { skip_healthcheck: true },
        );

        let approved_refund = merchant.queue_notification(
          (notification) => {
            assert.strictEqual(notification.type, "refund");
            assert.strictEqual(notification.status, "approved");
          },
          { skip_healthcheck: true },
        );

        let result = await merchant.create_payment(cardSuite().request());
        assert.strictEqual(result.payment.status, "pending");
        await payment_approved;

        await merchant.create_refund({
          token: result.token,
        });

        await refunded_payment;

        await approved_refund;
      }),
    );
  });
