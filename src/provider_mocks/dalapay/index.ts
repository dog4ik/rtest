import * as vitest from "vitest";
import * as sign from "./signature";
import type { MockProviderParams } from "@/mock_server/api";
import { err_bad_status } from "@/fetch_utils";


export const OperationStatus = {
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
  (typeof OperationStatus)[keyof typeof OperationStatus];

export type DalapayRequestData = {
  provider_id: number;
  merchant_id: string;
  customer_id: string;
  order_id: string;
  country: string;
  amount: string;
  currency: string;
  callback_url: string;
  email: string;
  name: string;
  signature: string;
};

const CALLBACK_SECRET =
  "1383f6037b23877f7412a8dd6c7c218fdc7b5702dd86e22a306ab90a23a64d9ba35ffd800c96d2c19f31d7d0c3ee12fdcd181c15a0bdfa9f989179b59602133d";

/**
 * Dalapay shares logic between payments and payouts
 */
export class DalapayTransaction {
  gateway_id: string;
  request_data?: DalapayRequestData;

  constructor() {
    this.gateway_id = crypto.randomUUID();
    this.request_data = undefined;
  }

  private provider_message(status: OperationStatus) {
    return status == OperationStatus.FAILED ? "My fancy error" : "Good";
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

  status_response(status: OperationStatus, request?: any) {
    if (request !== undefined) {
      let gatewayAmount = Number(request.amount);
      if (Number.isNaN(gatewayAmount)) {
        throw new Error("failed to parse gateway amount");
      }

      let method = Number(request.provider_id);
      if (Number.isNaN(method)) {
        throw new Error("failed to parse provider_id");
      }

      this.request_data = request;
    } else {
      if (!this.request_data) {
        throw new Error("Request data can't be nil");
      }
    }

    vitest.assert(this.request_data, "request data should be defined");

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

  static settings(uuid: string) {
    return {
      bank_list: {
        Airtel: 2002,
        Orange: 2001,
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
