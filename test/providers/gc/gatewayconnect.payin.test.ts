import { delay } from "@std/async";
import type * as playwright from "playwright";
import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import type { Bank, Requisite } from "@/driver/trader";
import { EightpayRequisitesPage } from "@/pages/8pay_payform";
import { EightpayTpayQrForm } from "@/pages/8pay_tpayform";
import { CheckoutCardForm } from "@/pages/checkout_card_form";
import { SpinpayRequisitesPage } from "@/pages/spinpay_payform";
import {
  type GatewayConnectTransaction,
  type GcRequisiteType,
  payinSuite,
  SETTINGS_INTERNAL_SECRET_KEY,
} from "@/provider_mocks/gateway_connect";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  defaultSuite,
  type P2PSuite,
  payformDataFlowTest,
  providersSuite,
  statusFinalizationSuite,
} from "@/suite_interfaces";
import { test } from "@/test_context";

async function assertPostToGoogle(
  page: playwright.Page,
  {
    inIframe = false,
    params,
  }: { inIframe?: boolean; params?: Record<string, string> } = {},
) {
  let post = (await page.requests()).find(
    (req) =>
      req.isNavigationRequest() &&
      req.method() === "POST" &&
      new URL(req.url()).hostname.endsWith("google.com") &&
      (!inIframe || req.frame().parentFrame() !== null),
  );
  assert(
    post,
    inIframe
      ? "expected a POST navigation request to google inside an iframe"
      : "expected a POST navigation request to google",
  );
  if (params) {
    // Form submits default to application/x-www-form-urlencoded, which
    // postDataJSON() parses into a key/value object.
    let body = post.postDataJSON() as Record<string, unknown> | null;
    for (let [key, value] of Object.entries(params)) {
      assert.strictEqual(
        body?.[key],
        value,
        `POST form field "${key}" should equal "${value}"`,
      );
    }
  }
}

let MAP: Record<GcRequisiteType, string> = {
  card: "Cards",
  sbp: "SBP",
  link: "sbp_aquiring",
  deeplink: "sbp_aquiring",
  tpay: "tpay",
  tpay_qr_data: "tpay",
  account: "account",
};

let providersP2PSuite = () => providersSuite("RUB", payinSuite());

let methodPayformSuite = (
  requisite: GcRequisiteType,
  method: "card" | "sbp" | "sbp_aquiring" | "tpay",
) => {
  let suite = payinSuite();
  return providersSuite("RUB", {
    ...suite,
    create_handler(s) {
      return this.gw.requisites_payin_handler(s, requisite);
    },
    request: () => common.paymentRequest("RUB"),
    settings: (s) => ({
      ...suite.settings(s),
      wrapped_to_json_response: false,
      method,
    }),
  }) as P2PSuite<GatewayConnectTransaction>;
};

let methodH2HSuite = (
  requisite: GcRequisiteType,
  method: "card" | "sbp" | "sbp_aquiring" | "tpay",
) => {
  let suite = payinSuite();
  return providersSuite("RUB", {
    ...suite,
    create_handler(s) {
      return this.gw.requisites_payin_handler(s, requisite);
    },
    request: () => common.paymentRequest("RUB"),
    settings: (s) => ({
      ...suite.settings(s),
      wrapped_to_json_response: true,
      method,
    }),
  }) as P2PSuite<GatewayConnectTransaction>;
};

callbackFinalizationSuite(providersP2PSuite);
statusFinalizationSuite(providersP2PSuite);

describe
  .runIf(CONFIG.in_project(["8pay", "reactivepay", "spinpay"]))
  .concurrent("gateway amount change", () => {
    function enableChangeStatusSuite(currency?: string) {
      let suite = payinSuite();
      return providersSuite(currency ?? "RUB", {
        ...suite,
        settings: (secret) => ({
          ...suite.settings(secret),
          enable_change_final_status: true,
          enable_update_amount: true,
        }),
      });
    }

    test.concurrent("second callback with approved with enable_change_final_status", ({
      ctx,
    }) =>
      ctx.track_bg_rejections(async () => {
        let suite = enableChangeStatusSuite();
        let merchant = await ctx.create_random_merchant();
        await merchant.set_commission({ operation: "PayinRequest" });
        await merchant.set_settings(suite.settings(ctx.uuid));
        // Default handler absorbs extra status-check requests the engine sends after an H2H approval
        let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

        let notification = merchant.queue_notification(
          (cb) => {
            assert.strictEqual(cb.status, "declined");
          },
          { skip_interaction_log_card_check: true },
        );

        provider.queue(suite.gw.requisites_payin_handler("pending", "card"));

        await merchant
          .create_payment(common.p2pPaymentRequest("RUB", "card"))
          .then((res) => res.followFirstProcessingUrl());
        await delay(3_000);
        await ctx.annotate("Sending declined callback");
        await suite.gw.send_callback("declined");
        await notification;
        await delay(2_000);

        let new_amount = 54321;
        let approved_notification = merchant.queue_notification(
          (cb) => {
            assert.strictEqual(cb.status, "approved");
          },
          {
            skip_interaction_log_card_check: true,
            expect: {
              status: 1,
              target_amount: new_amount / 100,
              commission_amount: 54.321,
            },
          },
        );

        await ctx.annotate("Sending approved callback");
        await suite.gw.send_callback("approved", new_amount);
        await approved_notification;
      }));

    test.concurrent(
      "callback with approved with enable_change_final_status after expired",
      { timeout: 120_000 },
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let suite = enableChangeStatusSuite();
          let merchant = await ctx.create_random_merchant();
          await merchant.set_commission({ operation: "PayinRequest" });
          let settings = suite.settings(ctx.uuid) as Record<string, any>;
          settings.gateways.gateway.pay_expired_minutes = 1;
          await merchant.set_settings(settings);
          let new_amount = 54321;
          let provider = ctx.mock_server(
            suite.mock_options(ctx.uuid),
            suite.gw.status_handler("pending", new_amount),
          );

          let notification = merchant.queue_notification(
            (cb) => {
              assert.strictEqual(cb.status, "expired");
            },
            { skip_interaction_log_card_check: true, skip_healthcheck: true },
          );

          provider.queue(suite.gw.requisites_payin_handler("pending", "card"));

          await merchant
            .create_payment(common.p2pPaymentRequest("RUB", "card"))
            .then((res) => res.followFirstProcessingUrl());
          await delay(3_000);
          await notification;
          await ctx.annotate("Sending approved callback");

          await notification;
          await delay(2_000);

          let approved_notification = merchant.queue_notification(
            (cb) => {
              assert.strictEqual(cb.status, "approved");
            },
            {
              skip_interaction_log_card_check: true,
              expect: {
                status: 1,
                target_amount: new_amount / 100,
                commission_amount: 54.321,
              },
            },
          );

          await suite.gw.send_callback("approved", new_amount);
          await approved_notification;
        }),
    );

    test.todo("enable_change_final_status with convert_to", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let _suite = payinSuite();
        let suite = providersSuite(
          "USD",
          {
            ..._suite,
            settings: (secret) => ({
              ..._suite.settings(secret),
              enable_change_final_status: true,
              enable_update_amount: true,
            }),
          },
          { convert_to: true },
        );
        let merchant = await ctx.create_random_merchant();
        await merchant.set_commission({ operation: "PayinRequest" });
        await merchant.set_settings(suite.settings(ctx.uuid));
        let new_amount = 54321;
        let provider = ctx.mock_server(
          suite.mock_options(ctx.uuid),
          suite.gw.status_handler("pending"),
        );

        provider.queue(suite.gw.requisites_payin_handler("pending", "card"));

        await merchant
          .create_payment(common.p2pPaymentRequest("INR", "card"))
          .then((res) => res.followFirstProcessingUrl())
          .then((res) => res.as_trader_requisites());

        let approved_notification = merchant.queue_notification(
          (cb) => {
            assert.strictEqual(cb.status, "approved");
          },
          {
            skip_interaction_log_card_check: true,
            expect: {
              status: 1,
              target_amount: new_amount / 100,
              commission_amount: 54.321,
            },
          },
        );
        await delay(2000);

        await suite.gw.send_callback("approved", new_amount);

        await approved_notification;
      }));

    test.concurrent(
      "racy expired with declined callback",
      { timeout: 150_000 },
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let suite = enableChangeStatusSuite("INR");
          let merchant = await ctx.create_random_merchant();
          await merchant.set_commission({ operation: "PayinRequest" });
          let settings = suite.settings(ctx.uuid) as Record<string, any>;
          settings.gateways.gateway.pay_expired_minutes = 1;
          await merchant.set_settings(settings);
          let new_amount = 54321;
          let provider = ctx.mock_server(
            suite.mock_options(ctx.uuid),
            suite.gw.status_handler("pending"),
          );

          provider.queue(suite.gw.requisites_payin_handler("pending", "card"));
          let rate = ctx.rate_driver();
          let rate_request = rate.queue_rate_handler(
            merchant.id,
            common.nginx500,
          );

          await merchant
            .create_payment(common.p2pPaymentRequest("INR", "card"))
            .then((res) => res.followFirstProcessingUrl());
          await delay(100_000);
          await suite.gw
            .send_callback("declined", new_amount)
            .catch(() => undefined);
          merchant.queue_notification(
            (cb) => {
              assert.strictEqual(cb.status, "expired");
            },
            {
              skip_interaction_log_card_check: true,
              skip_healthcheck: true,
            },
          );

          await delay(20_000);
          let approved_notification = merchant.queue_notification(
            (cb) => {
              assert.strictEqual(cb.status, "approved");
            },
            {
              skip_interaction_log_card_check: true,
              expect: {
                status: 1,
                target_amount: new_amount / 100,
                commission_amount: 54.321,
              },
            },
          );

          await suite.gw
            .send_callback("approved", new_amount)
            .catch(() => undefined);

          await approved_notification;
          await Promise.race([rate_request, delay(5_000)]);
        }),
    );

    test.concurrent("initial callback with approved with enable_change_final_status", ({
      ctx,
    }) =>
      ctx.track_bg_rejections(async () => {
        let suite = enableChangeStatusSuite();
        let merchant = await ctx.create_random_merchant();
        await merchant.set_commission({ operation: "PayinRequest" });
        await merchant.set_settings(suite.settings(ctx.uuid));
        let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

        provider.queue(suite.gw.requisites_payin_handler("pending", "card"));

        await merchant
          .create_payment(common.p2pPaymentRequest("RUB", "card"))
          .then((res) => res.followFirstProcessingUrl());
        await delay(2_000);

        let new_amount = 54321;
        let approved_notification = merchant.queue_notification(
          (cb) => {
            assert.strictEqual(cb.status, "approved");
          },
          {
            skip_interaction_log_card_check: true,
            expect: {
              status: 1,
              target_amount: new_amount / 100,
              commission_amount: 54.321,
            },
          },
        );

        await ctx.annotate("Sending approved callback");
        await suite.gw.send_callback("approved", new_amount);
        await approved_notification;
      }));

    test.concurrent("status with approved with enable_change_final_status", ({
      ctx,
    }) =>
      ctx.track_bg_rejections(async () => {
        let suite = enableChangeStatusSuite();
        let merchant = await ctx.create_random_merchant();
        await merchant.set_commission({ operation: "PayinRequest" });
        await merchant.set_settings(suite.settings(ctx.uuid));
        let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

        provider.queue(suite.gw.requisites_payin_handler("pending", "card"));
        let new_amount = 54321;
        provider.queue(suite.gw.status_handler("approved", new_amount));

        await merchant
          .create_payment(common.p2pPaymentRequest("RUB", "card"))
          .then((res) => res.followFirstProcessingUrl());
        await delay(2_000);

        let approved_notification = merchant.queue_notification(
          (cb) => {
            assert.strictEqual(cb.status, "approved");
          },
          {
            skip_interaction_log_card_check: true,
            expect: {
              status: 1,
              target_amount: new_amount / 100,
              commission_amount: 54.321,
            },
          },
        );

        await approved_notification;
      }));

    test.concurrent("create enable_change_final_status", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let suite = enableChangeStatusSuite();
        let merchant = await ctx.create_random_merchant();
        await merchant.set_commission({ operation: "PayinRequest" });
        await merchant.set_settings(suite.settings(ctx.uuid));
        let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

        let new_amount = 54321;
        provider.queue(
          suite.gw.requisites_payin_handler("pending", "card", {
            amount: new_amount,
          }),
        );
        provider.queue(suite.gw.status_handler("approved", new_amount));

        let res = await merchant
          .create_payment(common.p2pPaymentRequest("RUB", "card"))
          .then((res) => res.followFirstProcessingUrl())
          .then((res) => res.as_trader_requisites());
        assert.strictEqual(res.payment.amount, new_amount);
        assert.strictEqual(res.payment.gateway_amount, new_amount);
        await delay(2_000);

        let approved_notification = merchant.queue_notification(
          (cb) => {
            assert.strictEqual(cb.status, "approved");
          },
          {
            skip_interaction_log_card_check: true,
            expect: {
              status: 1,
              target_amount: new_amount / 100,
              commission_amount: 54.321,
            },
          },
        );

        await approved_notification;
      }));
  });
let requisitesP2PSuite = (requisite: GcRequisiteType) => {
  let suite = payinSuite();
  return providersSuite("RUB", {
    ...suite,
    create_handler(s) {
      return this.gw.requisites_payin_handler(s, requisite);
    },
    settings: (s) => ({
      ...suite.settings(s),
      wrapped_to_json_response: true,
    }),
  }) as P2PSuite<GatewayConnectTransaction>;
};

dataFlowTest(
  "tpay 8pay",
  {
    ...requisitesP2PSuite("tpay"),
    request: () => common.p2pPaymentRequest("RUB", "tpay"),
    async check_merchant_response({ processing_response, create_response }) {
      let json = (await processing_response?.as_raw_json()) as any;
      assert.isNotEmpty(json.link?.deeplink);
      assert.isNotEmpty(json.deeplink);
      assert.strictEqual(json.name_seller, common.fullName);
      assert.strictEqual(json.id, create_response.token);
    },
  },
  { skip_if: !CONFIG.in_project("8pay") },
);

dataFlowTest(
  "tpay_qr_data 8pay",
  {
    ...requisitesP2PSuite("tpay_qr_data"),
    request: () => common.p2pPaymentRequest("RUB", "tpay"),
    async check_merchant_response({ processing_response, create_response }) {
      let json = (await processing_response?.as_raw_json()) as any;
      assert.isNotEmpty(json.link?.deeplink);
      assert.isNotEmpty(json.deeplink);
      assert.strictEqual(json.name_seller, common.fullName);
      assert.strictEqual(json.id, create_response.token);
    },
  },
  { skip_if: !CONFIG.in_project("8pay") },
);

dataFlowTest("card", {
  ...requisitesP2PSuite("card"),
  request: () => common.p2pPaymentRequest("RUB", "card"),
  check_merchant_response: async (data) => {
    await data.processing_response?.validateRequisites({
      bank: common.bankName,
      name: common.fullName,
      type: "card",
      number: common.visaCard,
    });
  },
});

dataFlowTest("sbp", {
  ...requisitesP2PSuite("sbp"),
  request: () => common.p2pPaymentRequest("RUB", "sbp"),
  check_merchant_response: async (data) => {
    await data.processing_response?.validateRequisites({
      bank: common.bankName,
      name: common.fullName,
      type: "sbp",
      number: common.phoneNumber,
    });
  },
});

dataFlowTest("link", {
  ...requisitesP2PSuite("link"),
  request: () => common.p2pPaymentRequest("RUB", "link"),
  async check_merchant_response(data) {
    if (CONFIG.in_project("8pay")) {
      let json = (await data.processing_response?.as_raw_json()) as any;
      assert.strictEqual(json.link?.deeplink, common.redirectPayUrl);
      assert.strictEqual(json.deeplink, common.redirectPayUrl);
      assert.strictEqual(json.name_seller, common.fullName);
      assert.strictEqual(json.id, data.create_response.token);
    } else {
      let response = await data.processing_response?.as_trader_requisites();
      assert.strictEqual(response?.link?.url, common.redirectPayUrl);
    }
  },
});

describe
  .runIf(CONFIG.in_project("8pay"))
  .concurrent("8pay specific tests", () => {
    function bankWithCountrySuite(): P2PSuite<GatewayConnectTransaction> {
      let suite = payinSuite();
      return providersSuite("RUB", {
        ...suite,
        create_handler() {
          return this.gw.requisites_payin_handler("pending", "card", {
            bank: "oktobank",
          });
        },
        settings: (s) => ({
          ...suite.settings(s),
          wrapped_to_json_response: true,
          show_country_in_bank_name: true,
        }),
        request: () => ({
          ...common.p2pPaymentRequest("RUB", "card"),
        }),
      }) as P2PSuite<GatewayConnectTransaction>;
    }

    dataFlowTest("show_country_in_bank_name setting", {
      ...bankWithCountrySuite(),
      async check_merchant_response({ processing_response }) {
        let requisites = await processing_response?.as_8pay_requisite();
        assert.strictEqual(
          requisites?.support_bank_native?.Octobank,
          "Октобанк (Узбекистан)",
        );
      },
    });

    dataFlowTest("payment_form_url response field", {
      ...requisitesP2PSuite("card"),
      create_handler(s) {
        let gw = this.gw as GatewayConnectTransaction;
        return gw.requisites_payin_handler(s, "card", {
          payment_form_url: common.redirectPayUrl,
        });
      },
      async check_merchant_response({ processing_response }) {
        let requisites = (await processing_response?.as_raw_json()) as Record<
          string,
          any
        >;
        assert.strictEqual(requisites.payment_form_url, common.redirectPayUrl);
      },
    });
  });

describe.runIf(CONFIG.in_project("8pay")).concurrent("8pay form", () => {
  let formRequisitesP2PSuite = (requisite: GcRequisiteType) => {
    let suite = payinSuite();
    return providersSuite("RUB", {
      ...suite,
      create_handler(s) {
        return this.gw.requisites_payin_handler(s, requisite);
      },
      request: () => {
        let req = suite.request();
        return {
          ...req,
          extra_return_param: MAP[requisite],
        };
      },
      settings: (s) => ({
        ...suite.settings(s),
        wrapped_to_json_response: false,
      }),
    }) as P2PSuite<GatewayConnectTransaction>;
  };

  payformDataFlowTest("sbp", {
    ...formRequisitesP2PSuite("sbp"),
    check_pf_page: async (page) => {
      let form = new EightpayRequisitesPage(page);
      await form.validateRequisites({
        amount: common.amount,
        bank: common.bankName,
        name: common.fullName,
        number: common.phoneNumber,
        type: "sbp",
      });
    },
  });

  payformDataFlowTest("link", {
    ...formRequisitesP2PSuite("link"),
    check_pf_page: async (page) => {
      let form = new EightpayRequisitesPage(page);
      await form.validate_qr();
    },
  });

  payformDataFlowTest("card", {
    ...formRequisitesP2PSuite("card"),
    check_pf_page: async (page) => {
      let form = new EightpayRequisitesPage(page);
      await form.validateRequisites({
        amount: common.amount,
        bank: common.bankName,
        name: common.fullName,
        number: common.visaCard,
        type: "card",
      });
    },
  });

  payformDataFlowTest("tpay", {
    ...methodPayformSuite("tpay", "tpay"),
    request: () => common.p2pPaymentRequest("RUB", "tpay"),
    check_pf_page: async (page) => {
      let form = new EightpayTpayQrForm(page, "android");
      await form.validateRequisites({
        amount: common.amount,
        bank: common.bankName,
        name: common.fullName,
        number: common.phoneNumber,
      });
    },
  });

  payformDataFlowTest("tpay_qr_data", {
    ...methodPayformSuite("tpay_qr_data", "tpay"),
    request: () => common.p2pPaymentRequest("RUB", "tpay"),
    check_pf_page: async (page) => {
      let form = new EightpayTpayQrForm(page, "android");
      await form.validateRequisites({
        amount: common.amount,
        bank: common.bankName,
        name: common.fullName,
        number: common.phoneNumber,
      });
    },
  });
});

describe.runIf(CONFIG.in_project("spinpay")).concurrent("spinpay form", () => {
  let formRequisitesP2PSuite = (
    requisite: GcRequisiteType,
    custom_payform?: string,
  ) => {
    const MAP: Record<GcRequisiteType, Requisite> = {
      card: "card",
      deeplink: "link",
      link: "link",
      sbp: "sbp",
      tpay: "link",
      tpay_qr_data: "link",
      account: "account",
    };
    let suite = payinSuite();
    return providersSuite("RUB", {
      ...suite,
      create_handler(s) {
        return this.gw.requisites_payin_handler(s, requisite);
      },
      request: () => {
        let req = suite.request();
        return {
          ...req,
          bank_account: {
            requisite_type: MAP[requisite],
          },
        };
      },
      settings: (s) => ({
        ...suite.settings(s),
        wrapped_to_json_response: true,
        custom_payform,
      }),
    }) as P2PSuite<GatewayConnectTransaction>;
  };

  payformDataFlowTest(
    "sbp",
    {
      ...formRequisitesP2PSuite("sbp"),
      check_pf_page: async (page) => {
        let form = new SpinpayRequisitesPage(page);
        await form.validateRequisites({
          amount: common.amount,
          bank: common.bankName,
          name: common.fullName,
          number: common.phoneNumber,
          type: "sbp",
        });
      },
    },
    { browser_url_target: "selectorUrl" },
  );

  payformDataFlowTest(
    "card",
    {
      ...formRequisitesP2PSuite("card"),
      check_pf_page: async (page) => {
        let form = new SpinpayRequisitesPage(page);
        await form.validateRequisites({
          amount: common.amount,
          bank: common.bankName,
          name: common.fullName,
          number: common.visaCard,
          type: "card",
        });
      },
    },
    { browser_url_target: "selectorUrl" },
  );
});

dataFlowTest(
  "sbp pcidss",
  {
    ...requisitesP2PSuite("sbp"),
    check_merchant_response: async (data) => {
      let req = await data.processing_response?.as_trader_requisites();
      assert.strictEqual(req?.card?.pan, common.phoneNumber);
      assert.strictEqual(req?.card?.name, common.fullName);
      assert.strictEqual(req?.card?.bank, common.bankName);
    },
  },
  { skip_if: !CONFIG.in_project(["reactivepay", "spinpay"]) },
);

describe
  .runIf(CONFIG.in_project("8pay"))
  .concurrent("8pay method setting", () => {
    payformDataFlowTest("card method setting", {
      ...methodPayformSuite("card", "card"),
      check_pf_page: async (page) => {
        let form = new EightpayRequisitesPage(page);
        await form.validateRequisites({
          amount: common.amount,
          bank: common.bankName,
          name: common.fullName,
          number: common.visaCard,
          type: "card",
        });
      },
    });

    payformDataFlowTest("tpay method setting", {
      ...methodPayformSuite("tpay", "tpay"),
      check_pf_page: async (page) => {
        let form = new EightpayTpayQrForm(page, "android");
        await form.validateRequisites({
          amount: common.amount,
          bank: common.bankName,
          name: common.fullName,
          number: common.phoneNumber,
        });
      },
    });

    payformDataFlowTest("link method setting", {
      ...methodPayformSuite("link", "sbp_aquiring"),
      check_pf_page: async (page) => {
        let form = new EightpayRequisitesPage(page);
        await form.validate_qr();
      },
    });

    dataFlowTest("card method setting", {
      ...methodH2HSuite("card", "card"),
      async check_merchant_response({ processing_response, create_response }) {
        let req = await processing_response?.as_8pay_requisite();
        assert.strictEqual(req?.pan, common.visaCard);
        assert.strictEqual(req?.name_seller, common.fullName);
        assert.strictEqual(req?.id, create_response.token);
      },
    });

    dataFlowTest("sbp method setting", {
      ...methodH2HSuite("sbp", "sbp"),
      async check_merchant_response({ processing_response, create_response }) {
        let req = await processing_response?.as_8pay_requisite();
        assert.strictEqual(req?.pan, common.phoneNumber);
        assert.strictEqual(req?.name_seller, common.fullName);
        assert.strictEqual(req?.id, create_response.token);
      },
    });

    dataFlowTest("link method setting", {
      ...methodH2HSuite("link", "sbp_aquiring"),
      async check_merchant_response({ processing_response, create_response }) {
        let json = (await processing_response?.as_raw_json()) as any;
        assert.strictEqual(json.link?.deeplink, common.redirectPayUrl);
        assert.strictEqual(json.deeplink, common.redirectPayUrl);
        assert.strictEqual(json.name_seller, common.fullName);
        assert.strictEqual(json.id, create_response.token);
      },
    });

    dataFlowTest("tpay method setting", {
      ...methodH2HSuite("tpay", "tpay"),
      async check_merchant_response({ processing_response, create_response }) {
        let json = (await processing_response?.as_raw_json()) as any;
        assert.isNotEmpty(json.link?.deeplink);
        assert.isNotEmpty(json.deeplink);
        assert.strictEqual(json.name_seller, common.fullName);
        assert.strictEqual(json.id, create_response.token);
      },
    });

    function methodPriorityH2HSuite(
      requisite_type: GcRequisiteType,
      extra_return_param:
        | "card"
        | "sbp"
        | "sbp_aquiring"
        | "tpay"
        | (string & {}),
    ) {
      let suite = payinSuite();
      return providersSuite("RUB", {
        ...suite,
        create_handler() {
          return this.gw.requisites_payin_handler("pending", requisite_type);
        },
        request: () => common.p2pPaymentRequest("RUB", extra_return_param),
        settings: (s) => ({
          ...suite.settings(s),
          wrapped_to_json_response: true,
          use_setting_method_priority: true,
          method: requisite_type,
        }),
      });
    }

    dataFlowTest("unknown extra_return_param with method priority setting", {
      ...methodPriorityH2HSuite("card", "UnrecognizedExtraReturnParam"),
      async check_merchant_response({ processing_response, create_response }) {
        let req = await processing_response?.as_8pay_requisite();
        assert.strictEqual(req?.pan, common.visaCard);
        assert.strictEqual(req?.name_seller, common.fullName);
        assert.strictEqual(req?.id, create_response.token);
      },
    });
  });

function payformLinkRedirectSuite() {
  let suite = payinSuite();
  return providersSuite("RUB", {
    ...suite,
    create_handler(s) {
      return this.gw.requisites_payin_handler(s, "link");
    },
    settings: (s) => ({
      ...suite.settings(s),
      wrapped_to_json_response: false,
      payment_type: "redirect",
    }),
  }) as P2PSuite<GatewayConnectTransaction>;
}

payformDataFlowTest(
  "link npsk redirect",
  {
    ...payformLinkRedirectSuite(),
    request: () => common.p2pPaymentRequest("RUB", "link"),
  },
  { skip_if: !CONFIG.in_project("8pay") },
);

function ecomRedirectPayinSuite(
  card_in_request = true,
): P2PSuite<GatewayConnectTransaction> {
  let suite = payinSuite();
  return defaultSuite("RUB", {
    ...suite,
    create_handler() {
      return this.gw.redirect_payin_handler("pending", {
        url: common.redirectPayUrl,
        type: "get_with_processing",
      });
    },
    settings: (s) => ({
      ...suite.settings(s),
    }),
    request: () => ({
      ...common.paymentRequest("RUB"),
      customer: {
        ...common.extraCustomersParams(),
        ip: common.ip,
        email: common.email,
        browser: common.browserObject(),
      },
      card: card_in_request ? common.cardObject() : undefined,
      extra_return_param: "test_param",
    }),
  }) as P2PSuite<GatewayConnectTransaction>;
}

dataFlowTest("ecom redirect 3ds", {
  ...ecomRedirectPayinSuite(),
  check_merchant_response(data) {
    data.create_response;
  },
});

dataFlowTest("ecom post redirect 3ds", {
  ...ecomRedirectPayinSuite(),
  create_handler() {
    let gw = this.gw as GatewayConnectTransaction;
    return gw.redirect_payin_handler("pending", {
      params: { TermUrl: `${common.redirectPayUrl}/TermUrl` },
      url: common.redirectPayUrl,
      type: "post",
    });
  },
  check_merchant_response(data) {
    data.create_response;
  },
});

function externalRedirectSuite(): P2PSuite<GatewayConnectTransaction> {
  let suite = payinSuite();
  return providersSuite("RUB", {
    ...suite,
    create_handler() {
      return this.gw.redirect_payin_handler("pending", {
        url: common.redirectPayUrl,
        type: "get_with_processing",
      });
    },
    settings: (s) => ({
      ...suite.settings(s),
      wrapped_to_json_response: false,
    }),
    request: () => ({
      ...common.paymentRequest("RUB"),
    }),
  }) as P2PSuite<GatewayConnectTransaction>;
}

payformDataFlowTest(
  "external redirect",
  {
    ...externalRedirectSuite(),
    check_pf_page(page) {
      let url = new URL(page.url());
      assert.strictEqual(url.hostname, "www.google.com");
    },
  },
  { browser_url_target: "processingUrl" },
);

describe.runIf(CONFIG.in_project(["reactivepay"])).skip("rp 1xbet", () => {
  type SuiteConfig = {
    gw_bank: string;
    gw_requisite: GcRequisiteType;
    request_requisite: Requisite;
    request_bank: Bank | {};
    locale?: string;
  };
  function customPayformSuite(
    config: SuiteConfig,
  ): P2PSuite<GatewayConnectTransaction> {
    let suite = payinSuite();
    return providersSuite("RUB", {
      ...suite,
      create_handler(s) {
        return this.gw.requisites_payin_handler(s, config.gw_requisite, {
          bank: config.gw_bank,
          qr_data: common.redirectPayUrl,
        });
        // return this.gw.error_handler("Requisite was not found");
      },
      request: () => ({
        ...suite.request(),
        bank_account: {
          requisite_type: config.request_requisite,
          bank_name: config.request_bank,
        },
        ...(config.locale ? { locale: config.locale } : {}),
      }),
      settings: (s) => ({
        ...suite.settings(s),
        wrapped_to_json_response: true,
        custom_payform: "1xbet",
      }),
    }) as P2PSuite<GatewayConnectTransaction>;
  }
  // for (let requisite of ["card", "sbp"] as const) {
  //   for (let gw_bank of [
  //     "sber",
  //     "vtb",
  //     "alfa",
  //     "tbank",
  //     "ozon",
  //     "gazprom",
  //     "raif",
  //     "otkritie",
  //     "rosbank",
  //     "rshb",
  //     "uralsib",
  //     "akbars",
  //     "ubrir",
  //     "mts",
  //     "sinara",
  //     "solidarnost",
  //     "orenburg",
  //     "default",
  //   ]) {
  //     payformDataFlowTest(`1xbet payform test ${requisite}, ${gw_bank}`, {
  //       ...customPayformSuite({
  //         gw_requisite: requisite,
  //         request_requisite: requisite,
  //         gw_bank: "hoopla_bank",
  //         request_bank: gw_bank,
  //         locale: "ru",
  //       }),
  //       check_pf_page(page) {},
  //     });
  //   }
  // }
  payformDataFlowTest(`1xbet payform test (only) `, {
    ...customPayformSuite({
      gw_requisite: "card",
      request_requisite: "card",
      gw_bank: "sber",
      request_bank: "sber",
      locale: "ru",
    }),
    check_pf_page(_page) {},
  });
});

describe
  .runIf(CONFIG.in_project("spinpay"))
  .concurrent("spinpay locale", () => {
    function localeCardSuite(
      locale?: string,
    ): P2PSuite<GatewayConnectTransaction> {
      let suite = payinSuite();
      return providersSuite("RUB", {
        ...suite,
        create_handler(s) {
          return this.gw.requisites_payin_handler(s, "card");
        },
        request: () => ({
          ...suite.request(),
          bank_account: { requisite_type: "card" },
          ...(locale ? { locale } : {}),
        }),
        settings: (s) => ({
          ...suite.settings(s),
          wrapped_to_json_response: true,
        }),
      }) as P2PSuite<GatewayConnectTransaction>;
    }

    payformDataFlowTest(
      "ru browser locale shows russian",
      {
        ...localeCardSuite(),
        browser_context(browser) {
          return browser.newContext({ locale: "ru-RU" });
        },
        check_pf_page: async (page) => {
          let form = new SpinpayRequisitesPage(page);
          await form.validateLanguage("ru");
        },
      },
      { browser_url_target: "selectorUrl", skip_if: true },
    );

    payformDataFlowTest(
      "en browser locale shows english",
      {
        ...localeCardSuite(),
        browser_context(browser) {
          return browser.newContext({ locale: "en-US" });
        },
        check_pf_page: async (page) => {
          let form = new SpinpayRequisitesPage(page);
          await form.validateLanguage("en");
        },
      },
      { browser_url_target: "selectorUrl" },
    );

    payformDataFlowTest(
      "merchant locale ru overrides browser en",
      {
        ...localeCardSuite("ru"),
        browser_context(browser) {
          return browser.newContext({ locale: "en-US" });
        },
        check_pf_page: async (page) => {
          let form = new SpinpayRequisitesPage(page);
          await form.validateLanguage("ru");
        },
      },
      { browser_url_target: "selectorUrl" },
    );

    payformDataFlowTest(
      "merchant locale en overrides browser ru",
      {
        ...localeCardSuite("en"),
        browser_context(browser) {
          return browser.newContext({ locale: "ru-RU" });
        },
        check_pf_page: async (page) => {
          let form = new SpinpayRequisitesPage(page);
          await form.validateLanguage("en");
        },
      },
      { browser_url_target: "selectorUrl" },
    );

    payformDataFlowTest(
      "merchant locale en overrides browser kz",
      {
        ...localeCardSuite("en"),
        browser_context(browser) {
          return browser.newContext({ locale: "kk-KZ" });
        },
        check_pf_page: async (page) => {
          let form = new SpinpayRequisitesPage(page);
          await form.validateLanguage("en");
        },
      },
      { browser_url_target: "selectorUrl" },
    );

    payformDataFlowTest(
      "kk-KZ browser locale shows russian",
      {
        ...localeCardSuite(),
        browser_context(browser) {
          return browser.newContext({ locale: "kk-KZ" });
        },
        check_pf_page: async (page) => {
          let form = new SpinpayRequisitesPage(page);
          await form.validateLanguage("ru");
        },
      },
      { browser_url_target: "selectorUrl" },
    );

    payformDataFlowTest(
      "merchant locale kk shows russian",
      {
        ...localeCardSuite("kk"),
        check_pf_page: async (page) => {
          let form = new SpinpayRequisitesPage(page);
          await form.validateLanguage("ru");
        },
      },
      { browser_url_target: "selectorUrl", skip_if: true },
    );
  });

describe.concurrent("providers redirect_request", () => {
  payformDataFlowTest(
    "get redirect request (providers)",
    {
      ...externalRedirectSuite(),
      create_handler() {
        let gw = this.gw as GatewayConnectTransaction;
        return gw.redirect_payin_handler("pending", {
          type: "get",
          url: common.redirectPayUrl,
        });
      },
      check_pf_page(page) {
        let url = new URL(page.url());
        assert.strictEqual(url.hostname, "www.google.com");
      },
    },
    { browser_url_target: "processingUrl" },
  );

  payformDataFlowTest(
    "get_with_processing redirect request (providers)",
    {
      ...externalRedirectSuite(),
      create_handler() {
        let gw = this.gw as GatewayConnectTransaction;
        return gw.redirect_payin_handler("pending", {
          url: common.redirectPayUrl,
          type: "get_with_processing",
        });
      },
      check_pf_page(page) {
        let url = new URL(page.url());
        assert.strictEqual(url.hostname, "www.google.com");
      },
    },
    { browser_url_target: "processingUrl" },
  );
});

describe.concurrent("default redirect_request", () => {
  payformDataFlowTest(
    "get redirect request (default)",
    {
      ...ecomRedirectPayinSuite(true),
      create_handler() {
        let gw = this.gw as GatewayConnectTransaction;
        return gw.redirect_payin_handler("pending", {
          type: "get",
          url: common.redirectPayUrl,
        });
      },
      check_pf_page(p) {
        let url = new URL(p.url());
        assert.strictEqual(
          String(url),
          "https://www.google.com/",
          "merchant should get redirect",
        );
      },
    },
    { browser_url_target: "processingUrl" },
  );

  payformDataFlowTest(
    "get_with_processing redirect request (default)",
    {
      ...ecomRedirectPayinSuite(true),
      create_handler() {
        let gw = this.gw as GatewayConnectTransaction;
        return gw.redirect_payin_handler("pending", {
          url: common.redirectPayUrl,
          type: "get_with_processing",
        });
      },
      check_pf_page(p) {
        let url = new URL(p.url());
        assert.strictEqual(
          String(url),
          "https://www.google.com/",
          "merchant should get redirect",
        );
      },
    },
    { browser_url_target: "processingUrl" },
  );

  payformDataFlowTest(
    "get redirect request (default, no card)",
    {
      ...ecomRedirectPayinSuite(false),
      create_handler() {
        let gw = this.gw as GatewayConnectTransaction;
        return gw.redirect_payin_handler("pending", {
          url: common.redirectPayUrl,
          type: "get",
        });
      },
      async check_pf_page(p) {
        let checkout_page = new CheckoutCardForm(p);
        await checkout_page.submit_card_object(common.cardObject());
        await p.waitForURL("https://www.google.com/", { timeout: 5_000 });
      },
    },
    { browser_url_target: "processingUrl" },
  );

  payformDataFlowTest(
    "get_with_processing redirect request (default, no card)",
    {
      ...ecomRedirectPayinSuite(false),
      create_handler() {
        let gw = this.gw as GatewayConnectTransaction;
        return gw.redirect_payin_handler("pending", {
          url: common.redirectPayUrl,
          type: "get_with_processing",
        });
      },
      async check_pf_page(p) {
        let checkout_page = new CheckoutCardForm(p);
        await checkout_page.submit_card_object(common.cardObject());
        await p.waitForURL("https://www.google.com/", { timeout: 5_000 });
      },
    },
    { browser_url_target: "processingUrl" },
  );
});

const POST_PARAMS = { test: "success", creq: "test creq" };

describe.concurrent("default post redirect_request", () => {
  payformDataFlowTest(
    "post redirect request (default)",
    {
      ...ecomRedirectPayinSuite(true),
      create_handler() {
        let gw = this.gw as GatewayConnectTransaction;
        return gw.redirect_payin_handler("pending", {
          type: "post",
          url: common.redirectPayUrl,
          params: POST_PARAMS,
        });
      },
      async check_pf_page(p) {
        let url = new URL(p.url());
        assert.strictEqual(
          String(url),
          "https://google.com/",
          "merchant should get redirect",
        );
        await assertPostToGoogle(p, { params: POST_PARAMS });
      },
    },
    { browser_url_target: "processingUrl" },
  );

  payformDataFlowTest(
    "post_iframes redirect request (default)",
    {
      ...ecomRedirectPayinSuite(true),
      create_handler() {
        let gw = this.gw as GatewayConnectTransaction;
        return gw.redirect_payin_handler("pending", {
          type: "post_iframes",
          iframes: [{ url: common.redirectPayUrl, data: POST_PARAMS }],
        });
      },
      async check_pf_page(p) {
        await assertPostToGoogle(p, { inIframe: true, params: POST_PARAMS });
      },
    },
    { browser_url_target: "processingUrl" },
  );

  payformDataFlowTest(
    "post redirect request (default, no card)",
    {
      ...ecomRedirectPayinSuite(false),
      create_handler() {
        let gw = this.gw as GatewayConnectTransaction;
        return gw.redirect_payin_handler("pending", {
          type: "post",
          url: common.redirectPayUrl,
          params: POST_PARAMS,
        });
      },
      async check_pf_page(p) {
        let checkout_page = new CheckoutCardForm(p);
        await checkout_page.submit_card_object(common.cardObject());
        await p.waitForURL("https://www.google.com/", { timeout: 5_000 });
        await assertPostToGoogle(p, { params: POST_PARAMS });
      },
    },
    { browser_url_target: "processingUrl" },
  );

  payformDataFlowTest(
    "post_iframes redirect request (default, no card)",
    {
      ...ecomRedirectPayinSuite(false),
      create_handler() {
        let gw = this.gw as GatewayConnectTransaction;
        return gw.redirect_payin_handler("pending", {
          type: "post_iframes",
          iframes: [{ url: common.redirectPayUrl, data: POST_PARAMS }],
        });
      },
      async check_pf_page(p) {
        let checkout_page = new CheckoutCardForm(p);
        await checkout_page.submit_card_object(common.cardObject());
        await p.waitForLoadState("networkidle");
        await assertPostToGoogle(p, { inIframe: true, params: POST_PARAMS });
      },
    },
    { browser_url_target: "processingUrl" },
  );

  const REDIRECT_HTML = `<h1 data-testid="redirect-html">provider redirect html</h1>`;

  payformDataFlowTest(
    "redirect_html redirect request (default)",
    {
      ...ecomRedirectPayinSuite(true),
      create_handler() {
        let gw = this.gw as GatewayConnectTransaction;
        return gw.redirect_payin_handler("pending", {
          type: "redirect_html",
          html: REDIRECT_HTML,
        });
      },
      async check_pf_page(p) {
        let marker = p.locator("[data-testid=redirect-html]");
        await marker.waitFor();
        assert.strictEqual(
          await marker.textContent(),
          "provider redirect html",
        );
      },
    },
    { browser_url_target: "processingUrl" },
  );

  payformDataFlowTest(
    "redirect_html redirect request (default, no card)",
    {
      ...ecomRedirectPayinSuite(false),
      create_handler() {
        let gw = this.gw as GatewayConnectTransaction;
        return gw.redirect_payin_handler("pending", {
          type: "redirect_html",
          html: REDIRECT_HTML,
        });
      },
      async check_pf_page(p) {
        let checkout_page = new CheckoutCardForm(p);
        await checkout_page.submit_card_object(common.cardObject());
        let marker = p.locator("[data-testid=redirect-html]");
        await marker.waitFor();
        assert.strictEqual(
          await marker.textContent(),
          "provider redirect html",
        );
      },
    },
    { browser_url_target: "processingUrl" },
  );
});

describe.concurrent("commission healthcheck payins", () => {
  const AMOUNT = 100_000; // 1000 RUB in kopeyki
  const AMOUNT_RUB = AMOUNT / 100; // 1000 RUB
  const SELF_RATE = 0.1; // 10%
  const COMMISSION_RUB = AMOUNT_RUB * SELF_RATE; // 100 RUB

  async function rubWallet(merchant: {
    wallets(
      c: string,
    ): Promise<
      Array<{ available: number; held: number; currency: string | null }>
    >;
  }) {
    let ws = await merchant.wallets("RUB");
    let w = ws.find((w) => w.currency === "RUB");
    return { available: w?.available ?? 0, held: w?.held ?? 0 };
  }

  function commissionH2HSuite(): P2PSuite<GatewayConnectTransaction> {
    let suite = payinSuite();
    return defaultSuite("RUB", {
      ...suite,
      create_handler: (s) => suite.gw.basic_payin_handler(s),
      request: () => ({
        ...common.paymentRequest("RUB"),
        amount: AMOUNT,
        card: common.cardObject(),
      }),
    }) as P2PSuite<GatewayConnectTransaction>;
  }

  test.concurrent("instantly approved payin with commission", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let suite = commissionH2HSuite();
      let merchant = await ctx.create_random_merchant();
      await merchant.set_commission({ operation: "PayinRequest" });
      await merchant.set_settings(suite.settings(ctx.uuid));
      // Default handler absorbs extra status-check requests the engine sends after an H2H approval
      let provider = ctx.mock_server(suite.mock_options(ctx.uuid), (c) =>
        c.json({
          status: "approved",
          amount: common.amount,
          currency: "RUB",
          result: true,
          logs: [],
        }),
      );

      let notification = merchant.queue_notification(
        (cb) => {
          assert.strictEqual(cb.status, "approved");
        },
        { skip_interaction_log_card_check: true },
      );

      provider.queue(suite.gw.basic_payin_handler("approved"));

      await merchant.create_payment(suite.request());
      await notification;
      assert.deepEqual(
        await rubWallet(merchant),
        { available: AMOUNT_RUB - COMMISSION_RUB, held: 0 },
        "approved: merchant receives amount minus commission",
      );
    }));

  test.concurrent("instantly declined payin with commission", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let suite = commissionH2HSuite();
      let merchant = await ctx.create_random_merchant();
      await merchant.set_commission({ operation: "PayinRequest" });
      await merchant.set_settings(suite.settings(ctx.uuid));
      let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

      provider.queue(suite.gw.basic_payin_handler("declined"));

      // Declined H2H responses have an invalid processingUrl — use create_payment_raw to avoid schema failure.
      // No merchant callback is sent for immediately-declined H2H payments; healthcheck manually instead.
      let response = await merchant.create_payment_raw(suite.request());
      let token = response.json.token as string;
      await ctx.healthcheck(token, { skip_interaction_log_card_check: true });
      assert.deepEqual(
        await rubWallet(merchant),
        { available: 0, held: 0 },
        "declined: wallet unchanged",
      );
    }));

  test.concurrent("commission_in_callback setting", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let suite = commissionH2HSuite();
      let merchant = await ctx.create_random_merchant();
      await merchant.set_commission({ operation: "PayinRequest" });
      let settings = suite.settings(ctx.uuid);
      settings.gateways.gateway.commission_in_callback = true;
      await merchant.set_settings(settings);
      let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

      let provider_request = provider.queue(
        suite.gw.basic_payin_handler("pending"),
      );

      let response = await merchant.create_payment(suite.request());
      let token = response.token;

      await provider_request;
      assert.deepEqual(
        await rubWallet(merchant),
        { available: 0, held: 0 },
        "pending: payin does not hold merchant funds",
      );

      await ctx.healthcheck(token, { skip_interaction_log_card_check: true });

      let notification = merchant.queue_notification(
        (cb) => {
          assert.strictEqual(cb.status, "approved");
          assert.strictEqual(cb.commission_amount, 100);
          assert.strictEqual(cb.commission_value, 10);
          assert.strictEqual(cb.commission_fee, 0);
        },
        { skip_interaction_log_card_check: true },
      );

      await suite.gw.send_callback("approved");
      await notification;
      assert.deepEqual(
        await rubWallet(merchant),
        { available: AMOUNT_RUB - COMMISSION_RUB, held: 0 },
        "approved: merchant receives amount minus commission",
      );
    }));

  test.concurrent("pending payin finalize to approved with commission", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let suite = commissionH2HSuite();
      let merchant = await ctx.create_random_merchant();
      await merchant.set_commission({ operation: "PayinRequest" });
      await merchant.set_settings(suite.settings(ctx.uuid));
      let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

      let provider_request = provider.queue(
        suite.gw.basic_payin_handler("pending"),
      );

      let response = await merchant.create_payment(suite.request());
      let token = response.token;

      await provider_request;
      assert.deepEqual(
        await rubWallet(merchant),
        { available: 0, held: 0 },
        "pending: payin does not hold merchant funds",
      );

      await ctx.healthcheck(token, { skip_interaction_log_card_check: true });

      let notification = merchant.queue_notification(
        (cb) => {
          assert.strictEqual(cb.status, "approved");
        },
        { skip_interaction_log_card_check: true },
      );

      await suite.gw.send_callback("approved");
      await notification;
      assert.deepEqual(
        await rubWallet(merchant),
        { available: AMOUNT_RUB - COMMISSION_RUB, held: 0 },
        "approved: merchant receives amount minus commission",
      );
    }));

  test.concurrent("pending payin finalize to declined with commission", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let suite = commissionH2HSuite();
      let merchant = await ctx.create_random_merchant();
      await merchant.set_commission({ operation: "PayinRequest" });
      await merchant.set_settings(suite.settings(ctx.uuid));
      let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

      let provider_request = provider.queue(
        suite.gw.basic_payin_handler("pending"),
      );

      let response = await merchant.create_payment(suite.request());
      let token = response.token;

      await provider_request;

      await ctx.healthcheck(token, { skip_interaction_log_card_check: true });

      let notification = merchant.queue_notification(
        (cb) => {
          assert.strictEqual(cb.status, "declined");
        },
        { skip_interaction_log_card_check: true },
      );

      await suite.gw.send_callback("declined");
      await notification;
      assert.deepEqual(
        await rubWallet(merchant),
        { available: 0, held: 0 },
        "declined: wallet unchanged",
      );
    }));
});

describe.concurrent("gateway connect refund", () => {
  function h2hSuite(): P2PSuite<GatewayConnectTransaction> {
    let suite = payinSuite();
    return defaultSuite("RUB", {
      ...suite,
      create_handler: (s) => suite.gw.basic_payin_handler(s),
      request: () => ({
        ...common.paymentRequest("RUB"),
        card: common.cardObject(),
      }),
    }) as P2PSuite<GatewayConnectTransaction>;
  }

  test.concurrent("approved refund (status)", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let suite = h2hSuite();
      let merchant = await ctx.create_random_merchant();
      await merchant.set_settings(suite.settings(ctx.uuid));
      let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

      let provider_request = provider.queue(
        suite.gw.basic_payin_handler("pending"),
      );

      let status_request = provider.queue(suite.gw.status_handler("approved"));

      let response = await merchant.create_payment(suite.request());
      let token = response.token;

      await provider_request;

      await status_request;

      let notification = merchant.queue_notification(
        (cb) => {
          assert.strictEqual(cb.status, "approved");
        },
        { skip_interaction_log_card_check: true },
      );

      provider.queue(suite.gw.refund_handler("approved"));
      let merchant_refund_notification =
        merchant.queue_refund_or_pay_notification("approved", {
          skip_interaction_log_card_check: true,
        });

      await delay(500);
      await merchant.create_refund({ token, amount: common.amount });

      await provider.queue(suite.gw.status_handler("refunded"));
      await notification;
      await merchant_refund_notification;
    }));

  test.concurrent("approved refund (callback)", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let suite = h2hSuite();
      let merchant = await ctx.create_random_merchant();
      await merchant.set_settings(suite.settings(ctx.uuid));
      let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

      let provider_request = provider.queue(
        suite.gw.basic_payin_handler("pending"),
      );

      let status_request = provider.queue(suite.gw.status_handler("approved"));

      let response = await merchant.create_payment(suite.request());
      let token = response.token;

      await provider_request;

      await status_request;

      let notification = merchant.queue_notification(
        (cb) => {
          assert.strictEqual(cb.status, "approved");
        },
        { skip_interaction_log_card_check: true },
      );

      provider.queue(suite.gw.refund_handler("approved"));
      let merchant_refund_notification =
        merchant.queue_refund_or_pay_notification("approved", {
          skip_interaction_log_card_check: true,
        });
      await delay(500);

      await merchant.create_refund({ token, amount: common.amount });

      await delay(500);

      await suite.gw.send_callback("refunded");
      await notification;
      await merchant_refund_notification;
    }));

  test.concurrent("declined refund (status)", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let suite = h2hSuite();
      let merchant = await ctx.create_random_merchant();
      await merchant.set_settings(suite.settings(ctx.uuid));
      let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

      let provider_request = provider.queue(
        suite.gw.basic_payin_handler("pending"),
      );

      let status_request = provider.queue(suite.gw.status_handler("approved"));

      let response = await merchant.create_payment(suite.request());
      let token = response.token;

      await provider_request;

      let notification = merchant.queue_notification(
        (cb) => {
          assert.strictEqual(cb.status, "approved");
        },
        { skip_interaction_log_card_check: true },
      );

      await status_request;
      await notification;

      provider.queue(suite.gw.refund_handler("pending"));
      let merchant_refund_notification =
        merchant.queue_refund_or_pay_notification("declined", {
          skip_interaction_log_card_check: true,
        });

      await delay(500);
      await merchant.create_refund({ token, amount: common.amount });

      await provider.queue(suite.gw.status_handler("declined"));
      await merchant_refund_notification;
    }));

  test.skip("declined refund (callback)", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let suite = h2hSuite();
      let merchant = await ctx.create_random_merchant();
      await merchant.set_settings(suite.settings(ctx.uuid));
      let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

      let provider_request = provider.queue(
        suite.gw.basic_payin_handler("pending"),
      );

      let status_request = provider.queue(suite.gw.status_handler("approved"));

      let response = await merchant.create_payment(suite.request());
      let token = response.token;

      await provider_request;

      let notification = merchant.queue_notification(
        (cb) => {
          assert.strictEqual(cb.status, "approved");
        },
        { skip_interaction_log_card_check: true },
      );

      await status_request;
      await notification;

      provider.queue(suite.gw.refund_handler("pending"));
      let merchant_refund_notification =
        merchant.queue_refund_or_pay_notification("declined", {
          skip_interaction_log_card_check: true,
        });

      await delay(500);
      await merchant.create_refund({ token, amount: common.amount });

      await delay(500);
      await suite.gw.send_callback("refunded");
      await merchant_refund_notification;
    }));
});

function h2hSuite(): P2PSuite<GatewayConnectTransaction> {
  let suite = payinSuite("RUB");
  return defaultSuite(
    "RUB",
    {
      ...suite,
      create_handler: (s) => suite.gw.basic_payin_handler(s),
      settings: (s) => {
        let settings = suite.settings(s);
        let { full_link, gateway_key } = settings.gateway_settings;
        settings.gateway_settings = {
          bypass_processing_url: true,
          callback: true,
          enable: true,
          full_link,
          gateway_key,
          methods: {
            pay: {
              enable_status_checker: true,
              final_waiting_seconds: 10,
              params_fields: {
                params: ["pan", "expires", "holder", "cvv"],
                payment: ["gateway_currency", "gateway_amount"],
                settings: [SETTINGS_INTERNAL_SECRET_KEY, "api_key"],
              },
            },
            payout: {
              enable_status_checker: true,
              final_waiting_seconds: 10,
              params_fields: {
                params: ["pan", "expires", "holder", "cvv"],
                payment: ["gateway_currency", "gateway_amount"],
                settings: [SETTINGS_INTERNAL_SECRET_KEY, "api_key"],
              },
            },
            status: {
              params_fields: {
                params: [],
                payment: [],
                settings: [SETTINGS_INTERNAL_SECRET_KEY, "api_key"],
              },
            },
            refund: {
              enable_status_checker: true,
              params_fields: {
                params: [],
                payment: [],
                settings: [SETTINGS_INTERNAL_SECRET_KEY, "api_key"],
              },
            },
          },
          processing_method: "http_requests",
          status_checker_time_rates: {
            "1-3": 30,
            "4-6": 60,
            "7-14": 120,
            "15-": 3600,
          },
        };
        settings.api_key = "0266e225-4225-4ed1-94f7-1b612d15e948";

        return settings;
      },

      request: () => ({
        ...common.paymentRequest("RUB"),
        card: common.cardObject(),
      }),
    },
    { convert_to: false },
  ) as P2PSuite<GatewayConnectTransaction>;
}

test.skip("test gateway connect payin2", ({ ctx }) =>
  ctx.track_bg_rejections(async () => {
    let gw_suite = payinSuite("INR");
    let new_amount = 2000000;
    let suite = providersSuite("INR", {
      ...gw_suite,
      settings: (s) => ({
        ...gw_suite.settings(s),
        enable_change_final_status: true,
        enable_update_amount: true,
      }),
    });
    let merchant = await ctx.create_random_merchant();
    await merchant.set_commission();
    await merchant.set_settings(suite.settings(ctx.uuid));
    let provider = ctx.mock_server(suite.mock_options(ctx.uuid));
    let provider_request = provider.queue(
      suite.gw.requisites_payin_handler("pending", "account", {
        amount: new_amount,
      }),
    );

    let status_request = provider.queue(
      suite.gw.status_handler("approved", new_amount),
    );

    let _response = await merchant
      .create_payment(common.p2pPaymentRequest("INR", "account"))
      .then((r) => r.followFirstProcessingUrl())
      .then((r) => r.as_trader_requisites());

    await provider_request;

    let notification = merchant.queue_notification(
      (cb) => {
        assert.strictEqual(cb.status, "approved");
      },
      { skip_interaction_log_card_check: true },
    );

    await status_request;
    await notification;
  }));
test.skip("test gateway connect payin", ({ ctx }) =>
  ctx.track_bg_rejections(async () => {
    let suite = h2hSuite();
    let merchant = await ctx.create_random_merchant();
    await merchant.set_settings(suite.settings(ctx.uuid));
    let provider = ctx.mock_server(suite.mock_options(ctx.uuid));
    await merchant.set_commission({ self_rate: "10", provider_rate: "5" });

    let provider_request = provider.queue(async (c) =>
      c.json({
        status: "approved",
        amount: common.amount,
        currency: "RUB",
        details: undefined,
        result: true,
        gateway_token: suite.gw.gateway_id,
        logs: [],
      }),
    );

    let status_request = provider.queue(async (c) =>
      c.json({
        status: "approved",
        amount: common.amount,
        currency: "RUB",
        details: undefined,
        logs: [],
        result: true,
      }),
    );

    let _response = await merchant.create_payment(suite.request());

    await provider_request;

    let notification = merchant.queue_notification(
      (cb) => {
        assert.strictEqual(cb.status, "approved");
      },
      { skip_interaction_log_card_check: true },
    );

    await status_request;
    await notification;
  }));

test.skip("test gateway connect payout", ({ ctx }) =>
  ctx.track_bg_rejections(async () => {
    let suite = h2hSuite();
    let merchant = await ctx.create_random_merchant();
    await merchant.set_settings(suite.settings(ctx.uuid));
    let provider = ctx.mock_server(suite.mock_options(ctx.uuid));
    await merchant.cashin("RUB", common.amount / 100);
    await merchant.set_commission();

    let provider_request = provider.queue(async (c) =>
      c.json({
        status: "pending",
        amount: common.amount,
        currency: "RUB",
        details: undefined,
        result: true,
        gateway_token: suite.gw.gateway_id,
        logs: [],
      }),
    );

    let status_request = provider.queue(async (c) =>
      c.json({
        status: "approved",
        amount: common.amount,
        currency: "RUB",
        details: undefined,
        logs: [],
        result: true,
      }),
    );

    let _response = await merchant.create_payout({
      ...common.payoutRequest("RUB"),
      card: { pan: common.visaCard },
    });

    await provider_request;

    let notification = merchant.queue_notification(
      (cb) => {
        assert.strictEqual(cb.status, "approved");
      },
      { skip_interaction_log_card_check: true },
    );

    await status_request;
    await notification;
  }));
