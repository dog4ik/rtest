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
  });
