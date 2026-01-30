import * as vitest from "vitest";
import * as common from "@/common";
import { defaultSettings } from "@/settings_builder";
import { CONFIG, test } from "@/test_context";
import { JusanPayment } from "@/provider_mocks/jusan";
import type { Context } from "@/test_context/context";

const CURRENCY = "RUB";

async function setupMerchant(ctx: Context) {
  let uuid = crypto.randomUUID();
  let merchant = await ctx.create_random_merchant();
  await merchant.set_settings(
    defaultSettings(CURRENCY, JusanPayment.settings(uuid)),
  );
  let jusan = ctx.mock_server(JusanPayment.mock_params(uuid));
  let payment = new JusanPayment();
  return { merchant, jusan, payment, uuid };
}

vitest.describe
  .runIf(CONFIG.project === "reactivepay")
  .concurrent("jusan gateway", () => {
    test.concurrent("Jusan 3ds approved", async ({ ctx, browser }) => {
      await ctx.track_bg_rejections(async () => {
        let { merchant, jusan, payment, uuid } = await setupMerchant(ctx);
        jusan.queue(
          payment.create_3ds_json_handler(
            ctx.local_mock_server_url(JusanPayment.mock_params(uuid).alias),
            uuid,
          ),
        );
        // We fake one of the jusan endpoints to render ACS page to the end-user.
        jusan.queue(payment.CReqhandler());

        // Jusan 3ds challenge verification calls to another jusan server to finalize payment
        ctx
          .mock_server(payment.threeds_verifier_mock_params())
          .queue(payment.threeds_challenge_verification_handler("approved"));

        let notification = merchant.queue_notification(async (notification) => {
          vitest.assert.strictEqual(
            notification.status,
            "approved",
            "merchant notification status",
          );
        });
        let result = await merchant.create_payment({
          ...common.paymentRequest(CURRENCY),
          card: common.cardObject(),
        });
        console.log(result);
        vitest.assert(
          typeof result.processingUrl === "string",
          "processing url should be string",
        );

        // We need a real browser to follow client side form redirect.
        let page = await browser.newPage();
        await page.goto(result.processingUrl);
        // Submit challenge
        await page.click("button#success");
        await notification;
      });
    });

    test.todo("Jusan 3ds threeDSSessionData approved", async ({ ctx, browser }) => {
      await ctx.track_bg_rejections(async () => {
        let { merchant, jusan, payment, uuid } = await setupMerchant(ctx);
        jusan.queue(
          payment.create_3ds_html_handler(
            ctx.local_mock_server_url(JusanPayment.mock_params(uuid).alias),
            uuid,
          ),
        );
        // We fake one of the jusan endpoints to render ACS page to the end-user.
        jusan.queue(payment.CReqhandler());

        // Jusan 3ds challenge verification calls to another jusan server to finalize payment
        ctx
          .mock_server(payment.threeds_verifier_mock_params())
          .queue(payment.threeds_challenge_verification_handler("approved"));

        let notification = merchant.queue_notification(async (notification) => {
          vitest.assert.strictEqual(
            notification.status,
            "approved",
            "merchant notification status",
          );
        });
        let result = await merchant.create_payment({
          ...common.paymentRequest(CURRENCY),
          card: common.cardObject(),
        });
        console.log(result);
        vitest.assert(
          typeof result.processingUrl === "string",
          "processing url should be string",
        );

        // We need a real browser to follow client side form redirect.
        let page = await browser.newPage();
        await page.goto(result.processingUrl);
        // Submit challenge
        await page.click("button#success");
        await notification;
      });
    });

    test.concurrent("jusan insta approved", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let { merchant, jusan, payment } = await setupMerchant(ctx);
        jusan.queue(payment.create_response_handler("approved"));

        let notification = merchant.queue_notification(async (notification) => {
          vitest.assert.strictEqual(
            notification.status,
            "approved",
            "merchant notification status",
          );
        });
        let result = await merchant.create_payment({
          ...common.paymentRequest(CURRENCY),
          card: common.cardObject(),
        });
        console.log(result);

        await notification;
      });
    });

    test.todo("jusan insta declined", { timeout: 70_000 }, async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let { merchant, jusan, payment } = await setupMerchant(ctx);
        jusan.queue(payment.create_response_handler("declined"));

        let notification = merchant.queue_notification(async (notification) => {
          vitest.assert.strictEqual(
            notification.status,
            "declined",
            "merchant notification status",
          );
        });
        let result = await merchant.create_payment({
          ...common.paymentRequest(CURRENCY),
          card: common.cardObject(),
        });
        // FIX(pcidss): 15 minutes status request delay
        jusan.queue(payment.status_handler("declined"));
        console.log(result);

        await notification;
      });
    });

    test.concurrent(
      "jusan refund with commission",
      async ({ ctx, merchant, jusan_pay }) => {
        await ctx.track_bg_rejections(async () => {
          await merchant.set_settings(
            defaultSettings(CURRENCY, JusanPayment.settings(ctx.uuid)),
          );
          let payment = new JusanPayment();
          await merchant.cashin("RUB", (common.amount / 100) * 0.1);
          await merchant.set_commission({
            operation: "RefundRequest",
            self_rate: "10",
            currency: "RUB",
            source: "jusan",
            comment: "jusan test",
          });
          jusan_pay.queue(payment.create_response_handler("approved"));
          jusan_pay.queue(payment.refund_handler("approved"));

          let notifications = [
            merchant.queue_notification((notification) => {
              vitest.assert.strictEqual(notification.status, "approved");
            }),
            merchant.queue_notification(
              (notification) => {
                vitest.assert.strictEqual(notification.status, "refunded");
              },
              { skip_healthcheck: true },
            ),
            merchant.queue_notification(
              (notification) => {
                vitest.assert.strictEqual(notification.type, "refund");
                vitest.assert.strictEqual(notification.status, "approved");
              },
              { skip_healthcheck: true },
            ),
          ];
          let result = await merchant.create_payment({
            ...common.paymentRequest(CURRENCY),
            card: common.cardObject(),
          });
          vitest.assert.strictEqual(result.payment.status, "approved");

          await merchant.create_refund({
            token: result.token,
          });

          let wallet = (await merchant.wallets())[0];
          vitest.assert.strictEqual(
            wallet.available,
            0,
            "refund commission should clear the balance",
          );

          await Promise.all(notifications);
        });
      },
    );
  });
