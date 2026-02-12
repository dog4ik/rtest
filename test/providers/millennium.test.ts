import { describe, assert } from "vitest";
import * as common from "@/common";
import * as playwright from "playwright/test";
import { CONFIG, PROJECT } from "@/config";
import { test } from "@/test_context";
import { providers } from "@/settings_builder";
import { MillenniumTransaction } from "@/provider_mocks/millennium";
import { payinSuite } from "@/provider_mocks/millennium";
import type { Context } from "@/test_context/context";
import { EightpayRequisitesPage } from "@/pages/8pay_payform";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  payformDataFlowTest,
  statusFinalizationSuite,
  providersSuite,
} from "@/suite_interfaces";

const CURRENCY = "RUB";
const CALLBACK_DELAY = CONFIG.project == "8pay" ? 11_000 : 4_000;

let millenniumSuite = () => providersSuite(CURRENCY, payinSuite);

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
    ...millenniumSuite(),
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
    ...millenniumSuite(),
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

  payformDataFlowTest("qr", {
    ...millenniumSuite(),
    settings(secret) {
      return providers(CURRENCY, {
        ...MillenniumTransaction.settings(secret),
        wrapped_to_json_response: false,
      });
    },
    request() {
      return {
        ...common.paymentRequest(CURRENCY),
        extra_return_param: "SBP_aquiring",
      };
    },
    async check_pf_page(page) {
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
    },
  });
});

function millennumSuite() {
  return millenniumSuite();
}

describe
  .runIf(PROJECT === "8pay" || PROJECT === "reactivepay")
  .concurrent("millennium pending url", () => {
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
      ...millenniumSuite(),
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
      ...millenniumSuite(),
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
