import type { PrimeBusinessStatus } from "@/db/business";
import * as common from "@/common";
import {
  PaysecureApmPayment,
  type PaysecureStatus,
} from "@/provider_mocks/paysecure/payin_apm";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  payformDataFlowTest,
  statusFinalizationSuite,
  type Callback,
  type Status,
} from "@/suite_interfaces";
import { providers } from "@/settings_builder";
import { CONFIG } from "@/config";
import { assert, describe } from "vitest";
import { test } from "@/test_context";

const CURRENCY = "RUB";

function paysecureSuite() {
  let gw = new PaysecureApmPayment();
  let statusMap: Record<PrimeBusinessStatus, PaysecureStatus> = {
    approved: "paid",
    declined: "error",
    pending: "payment_in_process",
  };
  return {
    send_callback: async function (status, secret) {
      await gw.send_callback(statusMap[status], secret);
    },
    create_handler: (s) => gw.create_purchase_handler(statusMap[s]),
    mock_options: PaysecureApmPayment.mock_params,
    type: "payin",
    request: function () {
      return {
        ...common.paymentRequest(CURRENCY),
        customer: {
          email: common.email,
          country: "GB",
          address: "10 New Burlington StreetApt. 214",
          postcode: "W1S 3BE",
          first_name: "Rahul",
          last_name: "Agarwal",
          city: "London",
        },
        extra_return_param: "APPLEPAY-REDIRECT",
      };
    },
    settings: (secret) =>
      providers(CURRENCY, {
        ...PaysecureApmPayment.settings(secret),
      }),
    status_handler: (s) => gw.status_handler(statusMap[s]),
    gw,
  } satisfies Callback & Status & { gw: PaysecureApmPayment };
}

describe
  .runIf(CONFIG.extra_mapping?.["paysecureapm"])
  .concurrent("paysecure apm", () => {
    callbackFinalizationSuite(paysecureSuite);
    statusFinalizationSuite(paysecureSuite);

    function convertToSuite(convert_to: string) {
      let suite = paysecureSuite();
      return {
        ...suite,
        settings: (secret) => {
          let settings = suite.settings(secret);
          settings["convert_to"] = convert_to;
          return settings;
        },
        request: () => {
          return { ...suite.request(), currency: "EUR" };
        },
      } satisfies Callback<PaysecureApmPayment> & Status<PaysecureApmPayment>;
    }
    callbackFinalizationSuite(() => convertToSuite("RUB"), {
      tag: "convert_to",
    });
    test.concurrent("gw connect payin convert_to", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let suite = convertToSuite("RUB");
        let provider = ctx.mock_server(suite.mock_options(ctx.uuid));
        provider.queue(suite.gw.create_purchase_handler("payment_in_process"));
        await merchant.cashin("EUR", 500);
        await merchant.set_settings(suite.settings(ctx.uuid));
        let res = await merchant.create_payment(suite.request());

        assert.notStrictEqual(
          res.payment.amount,
          res.payment.gateway_amount,
          "gateway amount with convert to should not match amount",
        );
      }),
    );
  });
