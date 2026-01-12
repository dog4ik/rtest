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
  .skipIf(CONFIG.project === "8pay")
  .concurrent("jusan gateway", () => {
    test.concurrent("Jusan 3ds approved", async ({ ctx, browser }) => {
      await ctx.track_bg_rejections(async () => {
        let { merchant, jusan, payment, uuid } = await setupMerchant(ctx);
        jusan.queue(async (c) => {
          return c.json(
            payment.create_3ds_response(
              await c.req.parseBody(),
              ctx.local_mock_server_url(JusanPayment.mock_params(uuid).alias),
              uuid,
            ),
          );
        });
        // We fake one of the jusan endpoints to render ACS page to the end-user.
        jusan.queue(payment.CReqhandler());

        // Jusan 3ds challenge verification calls to another jusan server to finalize payment
        ctx
          .mock_server(payment.threeds_verifier_mock_params())
          .queue(payment.threeds_challenge_verification_handler("approved"));

        let notification = merchant.notification_handler(
          async (notification) => {
            vitest.assert.strictEqual(
              notification.status,
              "approved",
              "merchant notification status",
            );
          },
        );
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

        let notification = merchant.notification_handler(
          async (notification) => {
            vitest.assert.strictEqual(
              notification.status,
              "approved",
              "merchant notification status",
            );
          },
        );
        let result = await merchant.create_payment({
          ...common.paymentRequest(CURRENCY),
          card: common.cardObject(),
        });
        console.log(result);

        await notification;
      });
    });

    test.concurrent(
      "jusan insta declined",
      { timeout: 70_000 },
      async ({ ctx }) => {
        await ctx.track_bg_rejections(async () => {
          let { merchant, jusan, payment } = await setupMerchant(ctx);
          jusan.queue(payment.create_response_handler("declined"));

          let notification = merchant.notification_handler(
            async (notification) => {
              vitest.assert.strictEqual(
                notification.status,
                "declined",
                "merchant notification status",
              );
            },
          );
          let result = await merchant.create_payment({
            ...common.paymentRequest(CURRENCY),
            card: common.cardObject(),
          });
          // FIX(pcidss): 15 minutes status request delay
          jusan.queue(payment.status_handler("declined"));
          console.log(result);

          await notification;
        });
      },
    );
  });
