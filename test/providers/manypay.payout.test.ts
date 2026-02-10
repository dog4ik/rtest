import type { PrimeBusinessStatus } from "@/db/business";
import * as common from "@/common";
import {
  ManypayPayout,
  type ManypayStatus,
  ManypayStatusMap,
} from "@/provider_mocks/manypay";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  statusFinalizationSuite,
  type Callback,
  type Status,
  type TestCaseOptions,
} from "@/suite_interfaces";
import {
  defaultSettings,
  providers,
  SettingsBuilder,
} from "@/settings_builder";
import { CONFIG, test } from "@/test_context";
import { assert } from "vitest";
import { delay } from "@std/async";

const CURRENCY = "RUB";

function manypaySuite() {
  let gw = new ManypayPayout();
  let statusMap: Record<PrimeBusinessStatus, ManypayStatus> = {
    approved: ManypayStatusMap.SUCCESSFUL,
    declined: ManypayStatusMap.CANCELED,
    pending: ManypayStatusMap.PENDING,
  };
  return {
    type: "payout",
    send_callback: async function (status, _) {
      await gw.send_callback(statusMap[status]);
    },
    create_handler: (s) => gw.create_handler(statusMap[s]),
    mock_options: ManypayPayout.mock_params,
    request: function () {
      return {
        ...common.payoutRequest(CURRENCY),
        card: { pan: common.visaCard },
      };
    },
    settings: (secret) =>
      new SettingsBuilder()
        .addP2P(CURRENCY, "manypay")
        .withGateway(ManypayPayout.settings(secret), "manypay")
        .withGatewayParam("skip_card_payout_validation", true)
        .build(),
    status_handler: (s) => gw.status_handler(statusMap[s]),
    gw,
  } satisfies Callback & Status & { gw: ManypayPayout };
}

const OPTS: TestCaseOptions = { skip_if: !CONFIG.extra_mapping?.["manypay"] };

callbackFinalizationSuite(manypaySuite, OPTS);
statusFinalizationSuite(manypaySuite, OPTS);

dataFlowTest(
  "bank_list mapping",
  {
    ...manypaySuite(),
    settings(secret) {
      return defaultSettings(CURRENCY, {
        ...ManypayPayout.settings(secret),
        bank_list: {
          Сбербанк: "sberbank",
        },
      });
    },
    request() {
      return {
        ...common.payoutRequest(CURRENCY),
        card: { pan: common.visaCard },
        extra_return_param: "Сбербанк",
      };
    },
    after_create_check() {
      assert.strictEqual(this.gw.request_data?.payment.number, common.visaCard);
      assert.strictEqual(this.gw.request_data?.payment.bank, "sberbank");
      assert.strictEqual(
        this.gw.request_data?.payment.payment_method,
        "card2card",
      );
    },
  },
  OPTS,
);

dataFlowTest(
  "bank_list mapping miss",
  {
    ...manypaySuite(),
    settings(secret) {
      return defaultSettings(CURRENCY, {
        ...ManypayPayout.settings(secret),
        bank_list: {
          Сбербанк: "sberbank",
        },
      });
    },
    request() {
      return {
        ...common.payoutRequest(CURRENCY),
        card: { pan: common.visaCard },
        extra_return_param: "tbank",
      };
    },
    after_create_check() {
      assert.strictEqual(this.gw.request_data?.payment.number, common.visaCard);
      assert.strictEqual(this.gw.request_data?.payment.bank, "tbank");
      assert.strictEqual(
        this.gw.request_data?.payment.payment_method,
        "card2card",
      );
    },
  },
  OPTS,
);

dataFlowTest(
  "bank_list mapping default",
  {
    ...manypaySuite(),
    settings(secret) {
      return defaultSettings(CURRENCY, {
        ...ManypayPayout.settings(secret),
        bank_list: {
          Сбербанк: "sberbank",
          default: "default_bank",
        },
      });
    },
    request() {
      return {
        ...common.payoutRequest(CURRENCY),
        card: { pan: common.visaCard },
        extra_return_param: "unspecified_bank",
      };
    },
    after_create_check() {
      assert.strictEqual(this.gw.request_data?.payment.number, common.visaCard);
      assert.strictEqual(this.gw.request_data?.payment.bank, "default_bank");
      assert.strictEqual(
        this.gw.request_data?.payment.payment_method,
        "card2card",
      );
    },
  },
  OPTS,
);

dataFlowTest(
  "bank_list mapping default empty bank",
  {
    ...manypaySuite(),
    settings(secret) {
      return defaultSettings(CURRENCY, {
        ...ManypayPayout.settings(secret),
        bank_list: {
          Сбербанк: "sberbank",
          default: "default_bank",
        },
      });
    },
    request() {
      return {
        ...common.payoutRequest(CURRENCY),
        card: { pan: common.visaCard },
      };
    },
    after_create_check() {
      assert.strictEqual(this.gw.request_data?.payment.number, common.visaCard);
      assert.strictEqual(this.gw.request_data?.payment.bank, "default_bank");
      assert.strictEqual(
        this.gw.request_data?.payment.payment_method,
        "card2card",
      );
    },
  },
  OPTS,
);

dataFlowTest(
  "card extra_return_param",
  {
    ...manypaySuite(),
    request() {
      return {
        ...common.payoutRequest(CURRENCY),
        card: { pan: common.visaCard },
        extra_return_param: "sberbank",
      };
    },
    after_create_check() {
      assert.strictEqual(this.gw.request_data?.payment.number, common.visaCard);
      assert.strictEqual(this.gw.request_data?.payment.bank, "sberbank");
      assert.strictEqual(
        this.gw.request_data?.payment.payment_method,
        "card2card",
      );
    },
  },
  OPTS,
);

dataFlowTest(
  "card no bank",
  {
    ...manypaySuite(),
    request() {
      return {
        ...common.payoutRequest(CURRENCY),
        card: { pan: common.visaCard },
      };
    },
    after_create_check() {
      assert.strictEqual(this.gw.request_data?.payment.number, common.visaCard);
      assert.isUndefined(this.gw.request_data?.payment.bank);
      assert.strictEqual(
        this.gw.request_data?.payment.payment_method,
        "card2card",
      );
    },
  },
  OPTS,
);

dataFlowTest(
  "sbp extra_return_param",
  {
    ...manypaySuite(),
    request() {
      let req = common.payoutRequest(CURRENCY);
      return {
        ...req,
        customer: {
          ...req.customer,
          phone: common.phoneNumber,
        },
        extra_return_param: "tbank",
      };
    },
    after_create_check() {
      assert.strictEqual(
        this.gw.request_data?.payment.number,
        common.phoneNumber,
      );
      assert.strictEqual(this.gw.request_data?.payment.bank, "tbank");
      assert.strictEqual(this.gw.request_data?.payment.payment_method, "sbp");
    },
  },
  OPTS,
);

dataFlowTest(
  "sbp bank_account",
  {
    ...manypaySuite(),
    settings(secret) {
      return providers(CURRENCY, ManypayPayout.settings(secret));
    },
    request() {
      let req = common.payoutRequest(CURRENCY);
      return {
        ...req,
        customer: {
          ...req.customer,
          phone: common.phoneNumber,
        },
        bank_account: {
          requisite_type: "sbp",
          bank_name: "tbank",
        },
      };
    },
    after_create_check() {
      assert.strictEqual(
        this.gw.request_data?.payment.number,
        common.phoneNumber,
      );
      assert.strictEqual(this.gw.request_data?.payment.bank, "tbank");
      assert.strictEqual(this.gw.request_data?.payment.payment_method, "sbp");
    },
  },
  OPTS,
);

dataFlowTest(
  "card bank_account",
  {
    ...manypaySuite(),
    settings(secret) {
      return providers(CURRENCY, ManypayPayout.settings(secret));
    },
    request() {
      let req = common.payoutRequest(CURRENCY);
      return {
        ...req,
        customer: {
          ...req.customer,
          phone: common.phoneNumber,
        },
        bank_account: {
          requisite_type: "card",
        },
        card: { pan: common.visaCard },
      };
    },
    after_create_check() {
      assert.strictEqual(this.gw.request_data?.payment.number, common.visaCard);
      assert.strictEqual(this.gw.request_data?.payment.bank, undefined);
      assert.strictEqual(
        this.gw.request_data?.payment.payment_method,
        "card2card",
      );
    },
  },
  OPTS,
);

test
  .runIf(CONFIG.extra_mapping?.["manypay"])
  .concurrent("concurrent status and callback", ({ ctx, merchant }) =>
    ctx.track_bg_rejections(async () => {
      await merchant.cashin(CURRENCY, common.amount / 100);
      await merchant.set_settings(
        providers(CURRENCY, ManypayPayout.settings(ctx.uuid)),
      );
      let suite = manypaySuite();
      let payout = suite.gw;
      let manypay = ctx.mock_server(suite.mock_options(ctx.uuid));
      manypay.queue(
        payout.create_handler(ManypayStatusMap.PENDING),
      );

      let notification = merchant.queue_notification((n) => {
        assert.strictEqual(
          n.status,
          "approved",
          "merchant should get approved notifaction",
        );
      });

      let res = await merchant.create_payout({
        ...common.payoutRequest(CURRENCY),
        card: { pan: common.visaCard },
      });
      await res.followFirstProcessingUrl();

      let status = manypay
        .queue(payout.status_handler(ManypayStatusMap.SUCCESSFUL))
        .then(async () => {
          await payout.send_callback(ManypayStatusMap.SUCCESSFUL);
        });
      await status;
      await notification;

      await delay(1_000);
      let payment = await ctx.get_payment(res.token);
      assert.strictEqual(payment.status, "approved");
    }),
  );
