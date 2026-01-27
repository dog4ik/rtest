import { describe, assert } from "vitest";
import * as common from "@/common";
import * as playwright from "playwright/test";
import { CONFIG, PROJECT, test } from "@/test_context";
import { providers } from "@/settings_builder";
import {
  MillenniumTransaction,
  type MillenniumStatus,
} from "@/provider_mocks/millennium";
import type { Context } from "@/test_context/context";
import { EightpayRequisitesPage } from "@/pages/8pay_payform";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  payformDataFlowTest,
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

describe.runIf(PROJECT === "8pay").concurrent("millennium 8pay payform", () => {
  payformDataFlowTest("cards", {
    ...millennumSuite(),
    settings(secret) {
      return providers(CURRENCY, {
        ...MillenniumTransaction.settings(secret),
        wrapped_to_json_response: false,
      });
    },
    request() {
      return {
        ...common.paymentRequest(CURRENCY),
        extra_return_param: "Cards",
      };
    },
    async check_pf_page(page) {
      let form = new EightpayRequisitesPage(page);
      await form?.validateRequisites({
        name: common.fullName,
        amount: common.amount,
        number: common.visaCard,
        type: "card",
        bank: common.bankName,
      });
    },
  });

  payformDataFlowTest("sbp", {
    ...millennumSuite(),
    settings(secret) {
      return providers(CURRENCY, {
        ...MillenniumTransaction.settings(secret),
        wrapped_to_json_response: false,
      });
    },
    request() {
      return {
        ...common.paymentRequest(CURRENCY),
        extra_return_param: "SBP",
      };
    },
    async check_pf_page(page) {
      let form = new EightpayRequisitesPage(page);
      await form?.validateRequisites({
        name: common.fullName,
        amount: common.amount,
        number: common.phoneNumber,
        type: "sbp",
        bank: common.bankName,
      });
    },
  });

  test.concurrent("millennium qr payform", async ({ ctx, browser }) => {
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

      await merchant.queue_notification(async (notification) => {
        assert.strictEqual(
          notification.status,
          "approved",
          "merchant notification status",
        );
      });
    });
  });
});

function millennumSuite() {
  let gw = new MillenniumTransaction();
  let statusMap: Record<PrimeBusinessStatus, MillenniumStatus> = {
    approved: "ACCEPTED",
    declined: "CANCELLED",
    pending: "WAIT",
  };
  return {
    type: "payin",
    send_callback: async function (status, unique_secret) {
      await gw.send_callback(statusMap[status], unique_secret);
    },
    create_handler: gw.payin_create_handler.bind(gw),
    mock_options: MillenniumTransaction.mock_params,
    request: function () {
      return common.paymentRequest(CURRENCY);
    },
    settings: (secret) =>
      providers(CURRENCY, MillenniumTransaction.settings(secret)),
    status_handler: gw.status_handler.bind(gw),
    gw,
  } satisfies Callback & Status & { gw: MillenniumTransaction };
}

describe
  .runIf(PROJECT === "8pay" || PROJECT === "reactivepay")
  .concurrent(() => {
    test.todo("millennium pending url", async ({ ctx, browser }) => {
      await ctx.track_bg_rejections(async () => {
        let { merchant, millennium, payment, uuid } = await setupMerchant(
          ctx,
          false,
        );
        millennium.queue(async (c) => {
          setTimeout(() => {
            payment.send_callback("CANCELLED", uuid);
          }, CALLBACK_DELAY);

          return c.json(
            payment.payin_create_response("WAIT", await c.req.json()),
          );
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

        await merchant.queue_notification(async (notification) => {
          assert.strictEqual(
            notification.status,
            "approved",
            "merchant notification status",
          );
        });
      });
    });

    callbackFinalizationSuite(millennumSuite);
    statusFinalizationSuite(millennumSuite);

    dataFlowTest("extra_return_param sbp", {
      ...millennumSuite(),
      settings: (secret) =>
        providers(CURRENCY, {
          ...MillenniumTransaction.settings(secret),
          wrapped_to_json_response: true,
        }),
      request() {
        return {
          ...common.paymentRequest(CURRENCY),
          extra_return_param: "SBP",
        };
      },
      async check_merchant_response({ processing_response, create_response }) {
        assert.strictEqual(this.gw.payin_data?.code, "sbp");
        assert.strictEqual(this.gw.payin_data?.amount, common.amount / 100);
        assert.strictEqual(this.gw.payin_data?.orderID, create_response.token);
        let res = await processing_response?.as_8pay_requisite();
        assert.strictEqual(res?.name_seller, common.fullName);
        assert.strictEqual(res?.pan, `+${common.phoneNumber}`);
      },
    });

    dataFlowTest("extra_return_param cards", {
      ...millennumSuite(),
      settings: (secret) =>
        providers(CURRENCY, {
          ...MillenniumTransaction.settings(secret),
          wrapped_to_json_response: true,
        }),
      request() {
        return {
          ...common.paymentRequest(CURRENCY),
          extra_return_param: "Cards",
        };
      },
      async check_merchant_response({ processing_response, create_response }) {
        assert.strictEqual(this.gw.payin_data?.code, "cards");
        assert.strictEqual(this.gw.payin_data?.amount, common.amount / 100);
        assert.strictEqual(this.gw.payin_data?.orderID, create_response.token);
        let res = await processing_response?.as_8pay_requisite();
        assert.strictEqual(res?.name_seller, common.fullName);
        assert.strictEqual(res?.pan, common.visaCard);
      },
    });
  });
