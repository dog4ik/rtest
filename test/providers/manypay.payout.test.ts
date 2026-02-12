import * as common from "@/common";
import { ManypayPayout, ManypayStatusMap } from "@/provider_mocks/manypay";
import { payoutSuite } from "@/provider_mocks/manypay";
import {
  callbackFinalizationSuite,
  concurrentCallbackSuite,
  dataFlowTest,
  statusFinalizationSuite,
  type TestCaseOptions,
} from "@/suite_interfaces";
import { defaultSettings, providers } from "@/settings_builder";
import { CONFIG } from "@/config";
import { test } from "@/test_context";
import { assert, describe } from "vitest";
import { delay } from "@std/async";

const CURRENCY = "RUB";

function manypaySuite() {
  return payoutSuite(CURRENCY);
}

const OPTS: TestCaseOptions = { skip_if: !CONFIG.extra_mapping?.["manypay"] };

callbackFinalizationSuite(manypaySuite, OPTS);
statusFinalizationSuite(manypaySuite, OPTS);

dataFlowTest(
  "bank_list mapping",
  {
    ...payoutSuite(CURRENCY),
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
    ...payoutSuite(CURRENCY),
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
    ...payoutSuite(CURRENCY),
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
    ...payoutSuite(CURRENCY),
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
    ...payoutSuite(CURRENCY),
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
    ...payoutSuite(CURRENCY),
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
    ...payoutSuite(CURRENCY),
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
    ...payoutSuite(CURRENCY),
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
    ...payoutSuite(CURRENCY),
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
      let suite = payoutSuite(CURRENCY);
      let payout = suite.gw;
      let manypay = ctx.mock_server(suite.mock_options(ctx.uuid));
      manypay.queue(payout.create_handler(ManypayStatusMap.PENDING));

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

describe
  .runIf(CONFIG.extra_mapping?.["manypay"])
  .concurrent("concurrent calbacks", () => {
    concurrentCallbackSuite(manypaySuite);
  });
