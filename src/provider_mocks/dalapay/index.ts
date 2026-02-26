import * as vitest from "vitest";
import { z } from "zod";
import * as sign from "./signature";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import { err_bad_status } from "@/fetch_utils";
import type { P2PSuite } from "@/suite_interfaces";
import type { PrimeBusinessStatus } from "@/db/business";
import * as common from "@/common";

export const OperationStatusMap = {
  UNDEFINED: -1,
  INITIATED: 0,
  IN_PROGRESS: 1,
  SUCCESS: 2,
  FAILED: 3,
  CANCELLED: 4,
  CANCELLED_PARTIALLY: 5,
  IN_TRANSIT: 6,
} as const;

export type OperationStatus =
  (typeof OperationStatusMap)[keyof typeof OperationStatusMap];

const RequestDataSchema = z.object({
  provider_id: z.number(),
  merchant_id: z.string(),
  customer_id: z.string(),
  order_id: z.string(),
  country: z.string(),
  amount: z.coerce.number(),
  currency: z.string(),
  callback_url: z.url(),
  extra: z.object({
    customer_name: z.string(),
    customer_email: z.email().optional(),
    otp: z.string().optional(),
  }),
  signature: z.string(),
});

const CALLBACK_SECRET =
  "1383f6037b23877f7412a8dd6c7c218fdc7b5702dd86e22a306ab90a23a64d9ba35ffd800c96d2c19f31d7d0c3ee12fdcd181c15a0bdfa9f989179b59602133d";

/**
 * Dalapay shares logic between payments and payouts
 */
export class DalapayTransaction {
  gateway_id: string;
  request_data?: z.infer<typeof RequestDataSchema>;

  constructor() {
    this.gateway_id = crypto.randomUUID();
    this.request_data = undefined;
  }

  private provider_message(status: OperationStatus) {
    return status == OperationStatusMap.FAILED ? "My fancy error" : "Good";
  }

  callback(status: OperationStatus) {
    if (!this.request_data) {
      throw new Error("request_data is nil");
    }

    let data: Record<string, any> = {
      merchant_id: this.request_data.merchant_id,
      operation_type: 17,
      customer_id: "2330900000001",
      amount: this.request_data.amount,
      currency: this.request_data.currency,
      order_id: this.request_data.order_id,
      transaction_id: this.gateway_id,
      transaction_ref: "",
      status,
      provider_id: this.request_data.provider_id,
      destination_id: "",
      result: {
        code: 0,
        message: "OK",
      },
      provider_result: {
        code: -8888,
        message: this.provider_message(status),
      },
      service_id: 1,
      service_version: "1.03/1.0|1.0/1.26|1.0/1.0|1.01/1.0|1.01/1.0||1.01/1.27",
      service_date_time: "2023-11-17 13:15:00.000000",
    };
    let signature = sign.calculateSignature(data, CALLBACK_SECRET);
    data["signature"] = signature;
    return data;
  }

  async send_callback(status: OperationStatus) {
    vitest.assert(this.request_data, "request data should not be null");
    const payload = this.callback(status);
    let callback_url = new URL(this.request_data.callback_url);
    console.log("callback body", payload);
    callback_url.protocol = "http";
    await fetch(callback_url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    }).then(err_bad_status);
  }

  status_response(status: OperationStatus) {
    vitest.assert(this.request_data, "request data can't be nil");

    let res = {
      order_id: this.request_data.order_id,
      transaction_id: this.gateway_id,
      transaction_ref: "",
      status,
      result: {
        code: 0,
        message: "OK",
      },
      provider_result: {
        code: 0,
        message: this.provider_message(status),
      },
      service_id: 1,
      service_version: "1.03/1.14|1.0/2.0|1.0/1.0|1.01/1.0|1.01/1.0||1.02/1.27",
      service_date_time: "2025-10-24 16:04:28.122732",
      confirm_type: 0,
    };
    return res;
  }

  status_handler(status: OperationStatus): Handler {
    return (c) => c.json(this.status_response(status));
  }

  create_response(status: OperationStatus, request: any) {
    this.request_data = RequestDataSchema.parse(request);
    return this.status_response(status);
  }

  create_handler(status: OperationStatus): Handler {
    return async (c) =>
      c.json(this.create_response(status, await c.req.json()));
  }

  static settings(uuid: string) {
    return {
      bank_list: {
        Airtel: 2002,
        "Orange Money": 827,
        Africel: 2004,
        Vodacom: 2003,
        default: 2002,
      },
      class: "dalapay",
      public_id: uuid,
      secret_key: CALLBACK_SECRET,
      merchant_id: uuid,
    };
  }

  static mock_params(merchant_id: string): MockProviderParams {
    return {
      alias: "dalapay_payment",
      filter_fn: async (c) => {
        let json = await c.json();
        return json.merchant_id === merchant_id;
      },
    };
  }
}

export function payinSuite(currency = "CDF"): P2PSuite<DalapayTransaction> {
  let gw = new DalapayTransaction();
  let statusMap: Record<PrimeBusinessStatus, OperationStatus> = {
    approved: OperationStatusMap.SUCCESS,
    declined: OperationStatusMap.FAILED,
    pending: OperationStatusMap.IN_PROGRESS,
  };
  return {
    type: "payin",
    send_callback: async (status, _) => {
      await gw.send_callback(statusMap[status]);
    },
    create_handler: (s) => gw.create_handler(statusMap[s]),
    mock_options: DalapayTransaction.mock_params,
    request: () => ({
      amount: common.amount,
      currency,
      customer: {
        country: "CD",
        email: common.email,
        first_name: common.firstName,
        ip: common.ip,
        last_name: common.lastName,
        phone: common.phoneNumber,
      },
      extra_return_param: "Orange Money",
      order_number: "Test order",
      product: "deposit",
    }),
    settings: (secret) => DalapayTransaction.settings(secret),
    status_handler: (s) => gw.status_handler(statusMap[s]),
    no_requisites_handler: () => {
      throw Error("No requestites handler in not available for dalapay");
    },
    gw,
  };
}
