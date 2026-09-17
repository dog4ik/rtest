import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { payinSuite, RoyalpayPayment } from "@/provider_mocks/royalpay";
import { defaultSettings, providers } from "@/settings_builder";
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
  }) as Callback<RoyalpayPayment> & Status<RoyalpayPayment>;

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

const applePaySuite = () =>
  ({
    ...payinSuite(),
    settings: (secret) => providers(CURRENCY, RoyalpayPayment.settings(secret)),
    request: () => ({
      ...common.paymentRequest(CURRENCY),
      extra_return_param: "applepay",
      customer: {
        email: common.email,
        first_name: common.firstName,
        last_name: common.lastName,
        ip: common.ip,
      },
    }),
  }) as Callback & Status;

describe
  .runIf(CONFIG.in_project(["reactivepay", "8pay"]))
  .concurrent("royalpay applepay", () => {
    callbackFinalizationSuite(applePaySuite);
    statusFinalizationSuite(applePaySuite);
  });

describe
  .runIf(CONFIG.in_project(["reactivepay", "8pay"]))
  .concurrent("royalpay declined callback", () => {
    test.concurrent("insta callback with declined", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let suite = cardSuite();
        await merchant.set_commission();
        let gw = suite.gw;
        await merchant.set_settings(suite.settings(ctx.uuid));
        let server = ctx.mock_server(suite.mock_options(ctx.uuid));
        server.queue(async (c) => {
          gw.parse_deposit(await c.req.json());
          await gw.send_callback("error", ctx.uuid);
          return c.json(gw.error_response(), 201);
        });
        let declined = merchant.queue_notification(
          (cb) => {
            assert.strictEqual(
              cb.gatewayDetails?.decline_reason,
              "gateway response error: Declined",
            );
          },
          {
            expect: { status: 2 },
          },
        );
        await merchant.create_payment({
          ...suite.request(),
          card: common.cardObject(),
        });
        await declined;
      }));
  });
