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

const PAYMENT_METHOD_SCHEMA = z.enum([
  "toCard",
  "sbp",
  "toAccount",
  "transgran",
]);

export type BrusnikaPaymentMethod = z.infer<typeof PAYMENT_METHOD_SCHEMA>;

export type BrusnikaPaymentStatus =
  | "created"
  | "in_progress"
  | "success"
  | "failed";

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

function requisite(method: BrusnikaPaymentMethod): string {
  switch (method) {
    case "toCard":
      return "4242424242424242";
    case "sbp":
      return `+${common.phoneNumber}`;
    case "toAccount":
      return "7355608";
    case "transgran":
      return "5555555555554444";
    default:
      vitest.assert.fail(`unhandled payment method: ${method}`);
  }
}

export class BrusnikaPayment {
  gateway_id: string;
  request_data?: RequestData;

  constructor() {
    this.gateway_id = crypto.randomUUID();
    this.request_data = undefined;
  }

  private operation_data(status: BrusnikaPaymentStatus) {
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

  payment_response(status: BrusnikaPaymentStatus, request: any) {
    this.request_data = PAYIN_REQUEST_SCHEMA.parse(request);
    console.log(this.request_data);

    const operationData = this.operation_data(status);

    let paymentDetailsData = {
      nameMediator: common.fullName,
      paymentMethod: this.request_data.paymentMethod,
      bankName: "Ipak Bank",
      number: requisite(this.request_data.paymentMethod),
      numberAdditional: null,
      qRcode: null,
    };

    return success_response({ ...operationData, paymentDetailsData });
  }

  create_handler(status: BrusnikaPaymentStatus): Handler {
    return async (c) =>
      c.json(this.payment_response(status, await c.req.json()));
  }

  status_response(status: BrusnikaPaymentStatus) {
    return success_response(this.operation_data(status));
  }

  status_handler(status: BrusnikaPaymentStatus): Handler {
    return (c) => {
      vitest.assert.strictEqual(c.req.method, "GET");

      let path_components = c.req.path.split("/");
      vitest.assert.strictEqual(path_components.at(-1), this.gateway_id);
      vitest.assert.strictEqual(c.req.query("idPlatform"), this.gateway_id);
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
   * Brusnika callback payload
   *
   * Note: Don't forget to include webhook_jwt_token in the request headers
   */
  callback(status: BrusnikaPaymentStatus) {
    return this.operation_data(status);
  }

  async send_callback(status: BrusnikaPaymentStatus) {
    let payload = this.callback(status);
    let url = "http://127.0.0.1:4000/callback/brusnikapay";
    let curl = new CurlBuilder(url, "POST")
      .header("content-type", "application/json")
      .header("authorization", `Bearer ${WEBHOOK_TOKEN}`)
      .json_data(payload)
      .build();
    console.log("brusnkika callback", curl);
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
      api_token: secret,
      class: "brusnikapay",
      webhook_token: WEBHOOK_TOKEN,
    };
  }

  private static filter_fn(secret: string, req: HttpRequest) {
    const auth = req.header("authorization");
    if (!auth) return false;
    const token = auth.replace(/^Bearer /, "");
    return token === secret;
  }

  static mock_params(secret: string): MockProviderParams {
    return {
      alias: "brusnikapay",
      filter_fn: (req) => BrusnikaPayment.filter_fn(secret, req),
    };
  }

  mock_params_uzs(secret: string): MockProviderParams {
    return {
      alias: "brusnikapay_uzs",
      filter_fn: (req) => BrusnikaPayment.filter_fn(secret, req),
    };
  }
}
