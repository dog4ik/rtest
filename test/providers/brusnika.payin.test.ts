import type { PrimeBusinessStatus } from "@/db/business";
import * as common from "@/common";
import {
  BrusnikaPayment,
  type BrusnikaPaymentStatus,
} from "@/provider_mocks/brusnika";
import {
  callbackFinalizationSuite,
  statusFinalizationSuite,
  type Callback,
  type Status,
} from "@/suite_interfaces";
import { providers } from "@/settings_builder";

const CURRENCY = "RUB";

function brusnikaSuite(): Callback & Status {
  let gw = new BrusnikaPayment();
  let statusMap: Record<PrimeBusinessStatus, BrusnikaPaymentStatus> = {
    approved: "success",
    declined: "failed",
    pending: "in_progress",
  };
  return {
    suite_send_callback: async function (status, _) {
      await gw.send_callback(statusMap[status]);
    },
    suite_create_handler: (s) => gw.create_handler(statusMap[s]),
    mock_options: BrusnikaPayment.mock_params,
    suite_merchant_request: function () {
      return common.paymentRequest(CURRENCY);
    },
    suite_merchant_settings: (secret) =>
      providers(CURRENCY, BrusnikaPayment.settings(secret)),
    suite_status_handler: (s) => gw.status_handler(statusMap[s]),
  };
}

callbackFinalizationSuite(brusnikaSuite);
statusFinalizationSuite(brusnikaSuite);
