import { z } from "zod";
import { err_bad_status } from "@/fetch_utils";
import type {
  Handler,
  HttpRequest,
  MockProviderParams,
} from "@/mock_server/api";
import * as vitest from "vitest";
import * as common from "@/common";
import { CurlBuilder } from "@/story/curl";
import type { PrimeBusinessStatus } from "@/db/business";
import type { P2PSuite } from "@/suite_interfaces";
import { CONFIG } from "@/config";

const PAYMENT_METHOD_SCHEMA = z.enum([
  "toCard",
  "sbp",
  "toAccount",
  "transgran",
  "transgranSBP",
  "nspk",
  "alfa_alfa",
  "sber_sber",
  "ozon_ozon",
  "tbank_tbank",
  "vtb_vtb",
  "gazprom_gazprom",
  "psb_psb",
]);

export type PixelwavePaymentMethod = z.infer<typeof PAYMENT_METHOD_SCHEMA>;

export type PixelwavePaymentStatus =
  | "created"
  | "in_progress"
  | "success"
  | "failed"
  | "precreated";

const PAYIN_REQUEST_SCHEMA = z.object({
  clientID: z.string(),
  clientIP: z.ipv4().or(z.ipv6()),
  clientDateCreated: z.string(),
  paymentMethod: PAYMENT_METHOD_SCHEMA,
  idTransactionMerchant: z.string(),
  amount: z.number(),
});

type RequestData = z.infer<typeof PAYIN_REQUEST_SCHEMA>;

const WEBHOOK_TOKEN = "+MWRinGhkXlYEBtJCp2aC0xKylZBoNJsx+KV\/X07KDA=";

function success_response(data: Record<string, any>) {
  return {
    result: {
      status: "success",
      "x-request-id": crypto.randomUUID(),
      codeError: "none",
      codeErrorExt: "none",
      message: "",
    },
    data,
    totalNumberRecords: 0,
  };
}

function requisite(method: PixelwavePaymentMethod): string {
  switch (method) {
    case "toCard":
      return "4242424242424242";
    case "sbp":
      return `+${common.phoneNumber}`;
    case "toAccount":
      return "7355608";
    case "transgran":
      return "5555555555554444";
    case "transgranSBP":
      return `+${common.phoneNumber}`;
    case "nspk":
      return `+${common.phoneNumber}`;
    case "alfa_alfa":
    case "sber_sber":
    case "ozon_ozon":
    case "tbank_tbank":
    case "vtb_vtb":
    case "gazprom_gazprom":
    case "psb_psb":
      return `+${common.phoneNumber}`;
    default:
      vitest.assert.fail(`unhandled payment method: ${method}`);
  }
}

export class PixelwavePayment {
  gateway_id: string;
  request_data?: RequestData;

  constructor() {
    this.gateway_id = crypto.randomUUID();
    this.request_data = undefined;
  }

  private operation_data(status: PixelwavePaymentStatus) {
    vitest.assert(
      this.request_data,
      "operation data can't be constructed without request",
    );

    const { amount, idTransactionMerchant } = this.request_data;

    return {
      id: this.gateway_id,
      dateAdded: "2025-11-18T14:53:31.0796033Z",
      dateUpdated: "2025-11-18T14:53:31.0796033Z",
      typeOperation: "payIn",
      status,
      idTransactionMerchant,
      amountInitial: amount,
      amountRandomized: 0,
      amount,
      amountComission: (amount / 100) * 10,
      currency: "RUB",
      amountInCurrencyBalance: 0,
      amountComissionInCurrencyBalance: 0,
      exchangeRate: 0,
    };
  }

  payment_response(status: PixelwavePaymentStatus, request: any) {
    this.request_data = PAYIN_REQUEST_SCHEMA.parse(request);
    console.log(this.request_data);

    const operationData = this.operation_data(status);

    let paymentDetailsData = {
      nameMediator: common.fullName,
      paymentMethod: this.request_data.paymentMethod,
      bankName: common.bankName,
      number: requisite(this.request_data.paymentMethod),
      numberAdditional: null,
      qRcode: null,
    };

    return success_response({ ...operationData, paymentDetailsData });
  }

  create_handler(status: PixelwavePaymentStatus): Handler {
    return async (c) =>
      c.json(this.payment_response(status, await c.req.json()));
  }

  status_response(status: PixelwavePaymentStatus) {
    return success_response(this.operation_data(status));
  }

  status_handler(status: PixelwavePaymentStatus): Handler {
    return (c) => {
      vitest.assert.strictEqual(c.req.method, "GET");

      let path_components = c.req.path.split("/");
      vitest.assert.strictEqual(path_components.at(-1), this.gateway_id);
      return c.json(this.status_response(status));
    };
  }

  static no_requisites_response() {
    return {
      result: {
        status: "warning",
        "x-request-id": crypto.randomUUID(),
        codeError: "none",
        codeErrorExt: "noPaymentDetailsAvailable",
        message: "Not found available payment details",
      },
      data: null,
      totalNumberRecords: 0,
    };
  }

  static no_requisites_handler(): Handler {
    return (c) =>
      c.json({
        result: {
          status: "warning",
          "x-request-id": crypto.randomUUID(),
          codeError: "none",
          codeErrorExt: "noPaymentDetailsAvailable",
          message: "Not found available payment details",
        },
        data: null,
        totalNumberRecords: 0,
      });
  }

  /**
   * Pixelwave callback payload
   *
   * Note: Don't forget to include webhook_jwt_token in the request headers
   */
  callback(status: PixelwavePaymentStatus) {
    return this.operation_data(status);
  }

  async send_callback(status: PixelwavePaymentStatus) {
    let payload = this.callback(status);
    let url = `http://127.0.0.1:4207/callback`;
    let curl = new CurlBuilder(url, "POST")
      .header("content-type", "application/json")
      .header("authorization", `Bearer ${WEBHOOK_TOKEN}`)
      .json_data(payload)
      .build();
    console.log("pixelwave callback", curl);
    return await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${WEBHOOK_TOKEN}`,
      },
      body: JSON.stringify(payload),
    }).then(err_bad_status);
  }

  static settings(secret: string) {
    return {
      sign_key: "f3b8c1de7a924f6d9e42ab70c58df913",
      auth_token: secret,
      callback_token: WEBHOOK_TOKEN,
      enable_routing: true,
      method: "toCard",
      class: "pixelwave",
    };
  }

  static mock_params(secret: string): MockProviderParams {
    return {
      alias: "pixelwave",
      filter_fn: (req) => {
        const auth = req.header("authorization");
        if (!auth) return false;
        const token = auth.replace(/^Bearer /, "");
        return token === secret;
      },
    };
  }
}

export function payinSuite(currency = "RUB"): P2PSuite<PixelwavePayment> {
  let gw = new PixelwavePayment();
  let statusMap: Record<PrimeBusinessStatus, PixelwavePaymentStatus> = {
    approved: "success",
    declined: "failed",
    pending: "in_progress",
  };
  return {
    type: "payin",
    send_callback: async (status, _) => {
      await gw.send_callback(statusMap[status]);
    },
    create_handler: (s) => gw.create_handler(statusMap[s]),
    mock_options: PixelwavePayment.mock_params,
    request: () => common.p2pPaymentRequest(currency, "card"),
    settings: (secret) => PixelwavePayment.settings(secret),
    status_handler: (s) => gw.status_handler(statusMap[s]),
    no_requisites_handler: () => PixelwavePayment.no_requisites_handler(),
    gw,
  };
}
