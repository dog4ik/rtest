import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { BrusnikaPayout, payoutSuite } from "@/provider_mocks/brusnika";
import { defaultSettings, providers } from "@/settings_builder";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  defaultSuite,
  payoutPendingSuite,
  providersSuite,
  statusFinalizationSuite,
} from "@/suite_interfaces";
import { test } from "@/test_context";

const CURRENCY = "UZS";

let brusnikaDefaultSuite = () => {
  let suite = defaultSuite(CURRENCY, payoutSuite());
  let settings = (secret: string) => {
    let settings = suite.settings(secret);
    settings.gateways.skip_card_payout_validation = true;
    settings.gateways.skip_processing_url = true;
    return settings;
  };
  let payoutRequest = common.payoutRequest("UZS");
  let request = () => ({
    ...payoutRequest,
    customer: {
      ...payoutRequest.customer,
      first_name: common.firstName,
      last_name: common.lastName,
    },
    bank_account: {
      requisite_type: "card",
      bank_name: "uzcard",
    } as const,
    card: { pan: common.visaCard },
  });
  return { ...suite, settings, request };
};

let brusnikaProvidersSuite = () => {
  let suite = providersSuite(CURRENCY, payoutSuite());
  let settings = (secret: string) => {
    let settings = suite.settings(secret);
    settings.payout_providers_card = true;
    return settings;
  };
  let payoutRequest = common.payoutRequest("UZS");
  let request = () => ({
    ...payoutRequest,
    customer: {
      ...payoutRequest.customer,
      first_name: common.firstName,
      last_name: common.lastName,
    },
    bank_account: {
      requisite_type: "card",
      bank_name: "uzcard",
    } as const,
    card: { pan: common.visaCard },
  });
  return { ...suite, settings, request };
};

describe
  .runIf(CONFIG.in_project("8pay"))
  .concurrent("brusnika 8pay payout", () => {
    callbackFinalizationSuite(brusnikaProvidersSuite, { tag: "providers" });
    statusFinalizationSuite(brusnikaProvidersSuite, { tag: "providers" });
    payoutPendingSuite(brusnikaProvidersSuite(), { tag: "providers" });

    callbackFinalizationSuite(brusnikaDefaultSuite, { tag: "default" });
    statusFinalizationSuite(brusnikaDefaultSuite, { tag: "default" });
    payoutPendingSuite(brusnikaDefaultSuite(), { tag: "default" });

    test.concurrent("brusnika no balance decline", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await ctx.create_random_merchant();
        await merchant.cashin("UZS", common.amount / 100);
        let settings = defaultSettings("UZS", {
          ...BrusnikaPayout.settings(ctx.uuid),
          wrapped_to_json_response: true,
        });
        settings.gateways.skip_card_payout_validation = true;
        await merchant.set_settings(settings);
        let brusnika = ctx.mock_server(
          BrusnikaPayout.mock_params_uzs(ctx.uuid),
        );
        brusnika.queue(BrusnikaPayout.no_balance_handler());
        let notification = merchant.queue_notification((callback) => {
          assert.strictEqual(
            callback.status,
            "declined",
            "declined notification",
          );
        });
        let response = await merchant.create_payout({
          ...common.payoutRequest("UZS"),
          extra_return_param: "card",
          card: { pan: common.visaCard },
          bank_account: {
            bank_name: "sberbank",
            requisite_type: "card",
          },
        });
        assert.strictEqual(
          response.payout?.status,
          "declined",
          "payout status should be decrlined",
        );
        assert.strictEqual(
          response.payout?.decline_reason,
          "gateway response error: Not enough money on balance",
        );
        await notification;
      });
    });

    test.concurrent("brusnika payout skip_processing_url", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await ctx.create_random_merchant();
        await merchant.cashin("UZS", common.amount / 100);
        let settings = providers("UZS", {
          ...BrusnikaPayout.settings(ctx.uuid),
          wrapped_to_json_response: true,
        });
        settings.payout_providers_card = true;
        settings.gateways.skip_processing_url = true;
        await merchant.set_settings(settings);
        let brusnika = ctx.mock_server(
          BrusnikaPayout.mock_params_uzs(ctx.uuid),
        );
        let payout = new BrusnikaPayout();
        brusnika.queue(payout.create_handler("in_progress"));
        // For unknown "reasons" we don't in p2p payout responses we get data in payment field.
        let response = await merchant.create_payout_raw({
          product: "Tests PayOut",
          amount: common.amount,
          currency: "UZS",
          card: {
            pan: common.visaCard,
          },
          bank_account: {
            bank_name: "sberbank",
            requisite_type: "card",
          },
          order_number: "123456789",
          customer: {
            email: common.email,
            ip: common.ip,
            first_name: common.firstName,
            last_name: common.lastName,
            phone: `+${common.phoneNumber}`,
          },
        });
        let raw_response = response.as_p2p_ok();
        assert(raw_response.payment);
        assert.strictEqual(raw_response.payment.amount, common.amount);
        assert.strictEqual(raw_response.payment.currency, "UZS");
        assert.strictEqual(raw_response.payment.gateway_amount, common.amount);
        assert.strictEqual(raw_response.payment.gateway_currency, "UZS");
        assert.strictEqual(raw_response.payment.status, "pending");
      });
    });

    dataFlowTest(
      "card",
      {
        ...brusnikaDefaultSuite(),
        after_create_check() {
          let gw = this.gw as BrusnikaPayout;
          assert(gw.request_data);
          assert(gw.request_data.amount, (common.amount / 100).toString());
          assert(gw.request_data.bankName, "uzcard");
          assert(gw.request_data.nameMediator, common.fullName);
          assert(gw.request_data.number, common.visaCard);
          assert(gw.request_data.paymentMethod, "toCard");
        },
      },
      { tag: "default" },
    );
    dataFlowTest(
      "card",
      {
        ...brusnikaProvidersSuite(),
        after_create_check() {
          let gw = this.gw as BrusnikaPayout;
          assert(gw.request_data);
          assert(gw.request_data.amount, (common.amount / 100).toString());
          assert(gw.request_data.bankName, "uzcard");
          assert(gw.request_data.nameMediator, common.fullName);
          assert(gw.request_data.number, common.visaCard);
          assert(gw.request_data.paymentMethod, "toCard");
        },
      },
      { tag: "providers" },
    );
  });
