import * as vitest from "vitest";
import * as common from "@/common";
import * as playwright from "playwright/test";
import { CONFIG, test } from "@/test_context";
import { providers } from "@/settings_builder";
import {
  MillenniumTransaction,
  type MillenniumStatus,
} from "@/provider_mocks/millennium";
import type { Context } from "@/test_context/context";
import { EightpayRequisitesPage } from "@/pages/8pay_payform";
import {
  callbackFinalizationSuite,
  statusFinalizationSuite,
  type Callback,
  type Status,
} from "@/suite_interfaces";
import type { PrimeBusinessStatus } from "@/db/business";

const CURRENCY = "RUB";
const CALLBACK_DELAY = CONFIG.project == "8pay" ? 11_000 : 4_000;

async function setupMerchant(ctx: Context, wrapped_to_json_response: boolean) {
  let uuid = crypto.randomUUID();
  let merchant = await ctx.create_random_merchant();
  await merchant.set_settings(
    providers(CURRENCY, {
      ...MillenniumTransaction.settings(uuid),
      wrapped_to_json_response,
    }),
  );
  let millennium = ctx.mock_server(MillenniumTransaction.mock_params(uuid));
  let payment = new MillenniumTransaction();
  return { merchant, millennium, payment, uuid };
}

test
  .skipIf(CONFIG.project !== "8pay")
  .concurrent("millennium sbp payform", async ({ ctx, browser }) => {
    await ctx.track_bg_rejections(async () => {
      let { merchant, millennium, payment } = await setupMerchant(ctx, false);
      millennium.queue(async (c) =>
        c.json(payment.payin_create_response("WAIT", await c.req.json())),
      );
      millennium.queue((c) => c.json(payment.status_response("ACCEPTED")));

      let result = await merchant.create_payment(
        common.paymentRequest(CURRENCY),
      );

      let page = await browser.newPage();
      await page.goto(result.firstProcessingUrl());

      let pf = new EightpayRequisitesPage(page);
      await Promise.all([
        playwright.expect(pf.pageTitle()).toBeVisible(),
        playwright.expect(pf.pageTitle()).toHaveText("Оплата по СБП"),
        playwright.expect(pf.amountSpan()).toBeVisible(),
        playwright.expect(pf.amountSpan()).toHaveText("1 234.56 Р"),
        playwright.expect(pf.paymentPhone()).toBeVisible(),
        playwright.expect(pf.paymentPhone()).toHaveText("+7 999 555 35 35"),
      ]);

      await merchant.notification_handler(async (notification) => {
        vitest.assert.strictEqual(
          notification.status,
          "approved",
          "merchant notification status",
        );
      });
    });
  });

test
  .skipIf(CONFIG.project !== "8pay")
  .concurrent("millennium qr payform", async ({ ctx, browser }) => {
    await ctx.track_bg_rejections(async () => {
      let { merchant, millennium, payment } = await setupMerchant(ctx, false);
      millennium.queue(async (c) =>
        c.json(payment.payin_create_response("WAIT", await c.req.json())),
      );
      millennium.queue((c) => c.json(payment.status_response("ACCEPTED")));

      let result = await merchant.create_payment({
        ...common.paymentRequest(CURRENCY),
        extra_return_param: "SBP_aquiring",
      });

      let page = await browser.newPage();
      await page.goto(result.firstProcessingUrl());

      let pf = new EightpayRequisitesPage(page);
      await Promise.all([
        playwright.expect(pf.amountSpan()).toBeVisible(),
        playwright.expect(pf.amountSpan()).toHaveText("1 234.56 Р"),
        playwright.expect(pf.qrPayLink()).toBeVisible(),
        playwright.expect(pf.qrPayLink()).toHaveText("Оплатить"),
        playwright
          .expect(pf.qrPayLink())
          .toHaveAttribute("href", common.redirectPayUrl),
      ]);

      await merchant.notification_handler(async (notification) => {
        vitest.assert.strictEqual(
          notification.status,
          "approved",
          "merchant notification status",
        );
      });
    });
  });

function millennumSuite(): Callback & Status {
  let gw = new MillenniumTransaction();
  let statusMap: Record<PrimeBusinessStatus, MillenniumStatus> = {
    approved: "ACCEPTED",
    declined: "CANCELLED",
    pending: "WAIT",
  };
  return {
    suite_send_callback: async function (status, unique_secret) {
      await gw.send_callback(statusMap[status], unique_secret);
    },
    suite_create_handler: gw.payin_create_handler.bind(gw),
    mock_options: MillenniumTransaction.mock_params,
    suite_merchant_request: function () {
      return common.paymentRequest(CURRENCY);
    },
    suite_merchant_settings: (secret) =>
      providers(CURRENCY, MillenniumTransaction.settings(secret)),
    suite_status_handler: gw.status_handler.bind(gw),
  };
}

test.skip("millennium pending url", async ({ ctx, browser }) => {
  await ctx.track_bg_rejections(async () => {
    let { merchant, millennium, payment, uuid } = await setupMerchant(
      ctx,
      false,
    );
    millennium.queue(async (c) => {
      setTimeout(() => {
        payment.send_callback("CANCELLED", uuid);
      }, CALLBACK_DELAY);

      return c.json(payment.payin_create_response("WAIT", await c.req.json()));
    });
    millennium.queue((c) => c.json(payment.status_response("ACCEPTED")));

    let result = await merchant.create_payment({
      ...common.paymentRequest(CURRENCY),
      redirect_success_url: "https://google.com/success",
      redirect_fail_url: "https://google.com/fail",
      pending_url: "https://google.com/pending",
    });

    console.log(result);
    let page = await browser.newPage();
    // await page.goto(result.firstProcessingUrl());

    let pf = new EightpayRequisitesPage(page);
    await Promise.all([]);

    await merchant.notification_handler(async (notification) => {
      vitest.assert.strictEqual(
        notification.status,
        "approved",
        "merchant notification status",
      );
    });
  });
});

callbackFinalizationSuite(millennumSuite);
statusFinalizationSuite(millennumSuite);
