import type { PrimeBusinessStatus } from "@/db/business";
import * as common from "@/common";
import {
  BrusnikaPayment,
  type BrusnikaPaymentStatus,
} from "@/provider_mocks/brusnika";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  payformDataFlowTest,
  statusFinalizationSuite,
  type Callback,
  type Status,
} from "@/suite_interfaces";
import { providers } from "@/settings_builder";
import { CONFIG, test } from "@/test_context";
import { assert, describe } from "vitest";
import { EightpayRequisitesPage } from "@/pages/8pay_payform";

const CURRENCY = "RUB";

function brusnikaSuite() {
  let gw = new BrusnikaPayment();
  let statusMap: Record<PrimeBusinessStatus, BrusnikaPaymentStatus> = {
    approved: "success",
    declined: "failed",
    pending: "in_progress",
  };
  return {
    send_callback: async function (status, _) {
      await gw.send_callback(statusMap[status]);
    },
    create_handler: (s) => gw.create_handler(statusMap[s]),
    mock_options: BrusnikaPayment.mock_params,
    type: "payin",
    request: function () {
      return common.paymentRequest(CURRENCY);
    },
    settings: (secret) =>
      providers(CURRENCY, {
        ...BrusnikaPayment.settings(secret),
      }),
    status_handler: (s) => gw.status_handler(statusMap[s]),
    gw,
  } satisfies Callback & Status & { gw: BrusnikaPayment };
}

callbackFinalizationSuite(brusnikaSuite);
statusFinalizationSuite(brusnikaSuite);

test.concurrent("brusnika no requisities decline", async ({ ctx }) => {
  await ctx.track_bg_rejections(async () => {
    let merchant = await ctx.create_random_merchant();
    await merchant.set_settings(
      providers("RUB", {
        ...BrusnikaPayment.settings(ctx.uuid),
        wrapped_to_json_response: true,
      }),
    );
    let brusnika = ctx.mock_server(BrusnikaPayment.mock_params(ctx.uuid));
    brusnika.queue(BrusnikaPayment.no_requisites_handler());
    let notification = merchant.queue_notification((callback) => {
      assert.strictEqual(callback.status, "declined", "declined notification");
    });
    let response = await merchant
      .create_payment(common.paymentRequest("RUB"))
      .then((p) => p.followFirstProcessingUrl());
    let err = await response.as_error();
    err.assert_message(
      "gateway response error: Not found available payment details",
    );
    await notification;
  });
});

describe.concurrent("brusnika 8pay requisite", () => {
  dataFlowTest("extra_return_param sbp", {
    ...brusnikaSuite(),
    settings: (secret) =>
      providers(CURRENCY, {
        ...BrusnikaPayment.settings(secret),
        wrapped_to_json_response: true,
      }),
    request() {
      return { ...common.paymentRequest(CURRENCY), extra_return_param: "SBP" };
    },
    async check_merchant_response({ processing_response, create_response }) {
      assert.strictEqual(this.gw.request_data?.paymentMethod, "sbp");
      assert.strictEqual(this.gw.request_data?.amount, common.amount / 100);
      assert.strictEqual(
        this.gw.request_data?.idTransactionMerchant,
        create_response.token,
      );
      let res = await processing_response?.as_8pay_requisite();
      assert.strictEqual(res?.name_seller, common.fullName);
      assert.strictEqual(res?.pan, `+${common.phoneNumber}`);
    },
  });

  dataFlowTest("extra_return_param cards", {
    ...brusnikaSuite(),
    settings: (secret) =>
      providers(CURRENCY, {
        ...BrusnikaPayment.settings(secret),
        wrapped_to_json_response: true,
      }),
    request() {
      return {
        ...common.paymentRequest(CURRENCY),
        extra_return_param: "Cards",
      };
    },
    async check_merchant_response({ processing_response, create_response }) {
      assert.strictEqual(this.gw.request_data?.paymentMethod, "toCard");
      assert.strictEqual(this.gw.request_data?.amount, common.amount / 100);
      assert.strictEqual(
        this.gw.request_data?.idTransactionMerchant,
        create_response.token,
      );
      let res = await processing_response?.as_8pay_requisite();
      assert.strictEqual(res?.name_seller, common.fullName);
      assert.strictEqual(res?.pan, common.visaCard);
    },
  });
});

describe
  .skipIf(CONFIG.project !== "8pay")
  .concurrent("brusnika 8pay form", () => {
    payformDataFlowTest("card", {
      ...brusnikaSuite(),
      settings: (secret) =>
        providers(CURRENCY, {
          ...BrusnikaPayment.settings(secret),
          wrapped_to_json_response: false,
        }),
      request() {
        return {
          ...common.paymentRequest(CURRENCY),
          extra_return_param: "Cards",
        };
      },
      async check_pf_page(page) {
        let form = new EightpayRequisitesPage(page);
        await form.validateRequisites({
          type: "card",
          amount: common.amount,
          number: common.visaCard,
          name: common.fullName,
          bank: common.bankName,
        });
      },
    });

    payformDataFlowTest("sbp", {
      ...brusnikaSuite(),
      settings: (secret) =>
        providers(CURRENCY, {
          ...BrusnikaPayment.settings(secret),
          wrapped_to_json_response: false,
        }),
      request() {
        return {
          ...common.paymentRequest(CURRENCY),
          extra_return_param: "SBP",
        };
      },
      // FIX: phone requisite is not formatted properly on the payform
      async check_pf_page(page) {
        let form = new EightpayRequisitesPage(page);
        await form.validateRequisites({
          type: "sbp",
          amount: common.amount,
          number: `+${common.phoneNumber}`,
          name: common.fullName,
          bank: common.bankName,
        });
      },
    });
  });

describe
  .skipIf(CONFIG.project === "8pay")
  .concurrent("brusnika pcidss requisite", () => {
    dataFlowTest("bank_account sbp", {
      ...brusnikaSuite(),
      request() {
        return {
          ...common.paymentRequest(CURRENCY),
          bank_account: {
            requisite_type: "sbp",
          },
        };
      },
      async check_merchant_response({ processing_response }) {
        assert.strictEqual(this.gw.request_data?.paymentMethod, "sbp");
        assert.strictEqual(this.gw.request_data?.amount, common.amount / 100);
        await processing_response?.validateRequisites({
          type: "sbp",
          bank: common.bankName,
          name: common.fullName,
          number: `+${common.phoneNumber}`,
        });
      },
    });

    dataFlowTest("bank_account card", {
      ...brusnikaSuite(),
      request() {
        return {
          ...common.paymentRequest(CURRENCY),
          bank_account: {
            requisite_type: "card",
          },
        };
      },
      async check_merchant_response({ processing_response }) {
        assert.strictEqual(this.gw.request_data?.paymentMethod, "toCard");
        assert.strictEqual(this.gw.request_data?.amount, common.amount / 100);
        await processing_response?.validateRequisites({
          type: "card",
          bank: common.bankName,
          name: common.fullName,
          number: common.visaCard,
        });
      },
    });
  });
