import {
  GatewayConnectTransaction,
  payinSuite,
  type GcRequisiteType,
} from "@/provider_mocks/gateway_connect";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  defaultSuite,
  payformDataFlowTest,
  providersSuite,
  statusFinalizationSuite,
  type P2PSuite,
} from "@/suite_interfaces";
import * as common from "@/common";
import { assert } from "vitest";
import { CONFIG } from "@/config";
import { describe } from "vitest";
import { test } from "@/test_context";
import { EightpayRequisitesPage } from "@/pages/8pay_payform";
import { EightpayTpayQrForm } from "@/pages/8pay_tpayform";
import { SpinpayRequisitesPage } from "@/pages/spinpay_payform";
import type { Requisite } from "@/driver/trader";

let MAP: Record<GcRequisiteType, string> = {
  card: "Cards",
  sbp: "SBP",
  link: "sbp_aquiring",
  deeplink: "sbp_aquiring",
  tpay: "tpay",
  tpay_qr_data: "tpay",
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
          requisites?.support_bank_native?.["Octobank"],
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
  let formRequisitesP2PSuite = (requisite: GcRequisiteType) => {
    const MAP: Record<GcRequisiteType, Requisite> = {
      card: "card",
      deeplink: "link",
      link: "link",
      sbp: "sbp",
      tpay: "link",
      tpay_qr_data: "link",
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

function ecomRedirectPayinSuite(): P2PSuite<GatewayConnectTransaction> {
  let suite = payinSuite();
  return defaultSuite("RUB", {
    ...suite,
    create_handler() {
      return this.gw.redirect_3ds_response_handler();
    },
    settings: (s) => ({
      ...suite.settings(s),
    }),
    request: () => ({
      ...common.paymentRequest("RUB"),
      customer: {
        ip: "178.255.251.35",
        email: "18@gmail.com",
        phone: "+79992448838",
        first_name: "Test",
        last_name: "Test2",
        country: "AU",
        state: "Test",
        postcode: "100013",
        city: "Transmetropolitan",
        address: "126 Kichik Beshagach Street",
        browser: {
          tz_name: "Europe/Moscow",
          accept_header: "application/json, text/plain, */*",
          color_depth: "32",
          ip: "109.48.0.1",
          language: "us-US",
          screen_height: "1080",
          screen_width: "1920",
          tz: "-180",
          user_agent:
            "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:92.0) Gecko/20100101 Firefox/92.0",
          java_enabled: "true",
          window_width: "1240",
          window_height: "560",
        },
      },
      card: common.cardObject(),
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

function externalRedirectSuite(): P2PSuite<GatewayConnectTransaction> {
  let suite = payinSuite();
  return providersSuite("RUB", {
    ...suite,
    create_handler() {
      return this.gw.redirect_payin_handler("pending");
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

payformDataFlowTest(
  "get redirect request",
  {
    ...externalRedirectSuite(),
    create_handler() {
      let gw = this.gw as GatewayConnectTransaction;
      return gw.get_redirect_response();
    },
    check_pf_page(page) {
      let url = new URL(page.url());
      assert.strictEqual(url.hostname, "www.google.com");
    },
  },
  { browser_url_target: "processingUrl" },
);

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
    }),
  );

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
    }),
  );

  test.concurrent(
    "pending payin finalize to approved with commission",
    ({ ctx }) =>
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
      }),
  );

  test.concurrent(
    "pending payin finalize to declined with commission",
    ({ ctx }) =>
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
      }),
  );
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

  test.concurrent("approved refund", ({ ctx }) =>
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
        merchant.queue_refund_or_pay_notifictation("approved");

      await merchant.create_refund({ token, amount: common.amount });

      await provider.queue(suite.gw.status_handler("refunded"));
      await notification;
      await merchant_refund_notification;
    }),
  );

  test.concurrent("declined refund", ({ ctx }) =>
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
        merchant.queue_refund_or_pay_notifictation("declined");

      await merchant.create_refund({ token, amount: common.amount });

      await provider.queue(suite.gw.status_handler("declined"));
      await merchant_refund_notification;
    }),
  );
});
