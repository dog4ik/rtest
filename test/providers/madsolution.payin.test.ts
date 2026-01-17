import type { PrimeBusinessStatus } from "@/db/business";
import * as common from "@/common";
import {
  MadsolutionPayment,
  type MadsolutionStatus,
} from "@/provider_mocks/madsolution";
import {
  callbackFinalizationSuite,
  statusFinalizationSuite,
  type Callback,
  type Status,
} from "@/suite_interfaces";
import { providers } from "@/settings_builder";

const CURRENCY = "RUB";

function madsolutionSuite(): Callback & Status {
  let gw = new MadsolutionPayment();
  let statusMap: Record<PrimeBusinessStatus, MadsolutionStatus> = {
    approved: "CONFIRMED",
    declined: "CANCELED",
    pending: "PENDING",
  };
  return {
    type: "payin",
    send_callback: async function (status, _) {
      await gw.send_callback(statusMap[status]);
    },
    create_handler: (s) => gw.create_handler(statusMap[s]),
    mock_options: MadsolutionPayment.mock_params,
    request: function () {
      return {
        ...common.paymentRequest(CURRENCY),
        extra_return_param: "card",
      };
    },
    settings: (secret) =>
      providers(CURRENCY, MadsolutionPayment.settings(secret)),
    status_handler: (s) => gw.status_handler(statusMap[s]),
  };
}

callbackFinalizationSuite(madsolutionSuite);
statusFinalizationSuite(madsolutionSuite);
