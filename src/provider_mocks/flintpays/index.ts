import { z } from "zod";
import * as common from "@/common";
import * as vitest from "vitest";
import type {
  Handler,
  HttpContext,
  MockProviderParams,
} from "@/mock_server/api";
import { err_bad_status } from "@/fetch_utils";
import type { P2PSuite } from "@/suite_interfaces";
import type { PrimeBusinessStatus } from "@/db/business";
import { providers } from "@/settings_builder";

export type FlintpayStatus = "created" | "confirmed" | "rejected";

const PAYMENT_TYPE_SCHEMA = z.enum([
  "any_bank",
  "sbp",
  "sber",
  "account_number",
]);

const PAYOUT_REQUEST_SCHEMA = z.object({
  merchant: z.string(),
  order_id: z.string(),
  cents: z.int(),
  currency: z.string(),
  payment_type: PAYMENT_TYPE_SCHEMA,
  payment_data_number: z.string(),
  payment_data_name: z.string(),
  callback_url: z.url(),
  customer: z.string(),
});

const PAYIN_REQUEST_SCHEMA = z.object({
  merchant: z.string(),
  order_id: z.string(),
  cents: z.int(),
  currency: z.string(),
  payment_type: PAYMENT_TYPE_SCHEMA,
  callback_url: z.url(),
  customer: z.string(),
});

export class FlintpayOperation {
  gateway_id: string;
  payout_request_data?: z.infer<typeof PAYOUT_REQUEST_SCHEMA>;
  payin_request_data?: z.infer<typeof PAYIN_REQUEST_SCHEMA>;

  constructor(private operation_type: "deposit" | "withdrawal") {
    this.gateway_id = crypto.randomUUID();
  }

  private requestData():
    | z.infer<typeof PAYOUT_REQUEST_SCHEMA>
    | z.infer<typeof PAYIN_REQUEST_SCHEMA> {
    if (!this.payout_request_data && !this.payin_request_data) {
      vitest.assert.fail("request data should be defined");
    }
    return this.payout_request_data ?? this.payin_request_data!;
  }

  status_response(status: FlintpayStatus) {
    return {
      id: this.gateway_id,
      external_id: this.requestData().order_id,
      merchant_id: this.requestData().merchant,
      state: status,
      kind: this.operation_type,
      amount_cents: this.requestData().cents,
      amount_currency: this.requestData().currency,
      payment_bill_url: null,
      payment_data: this.paymentData(),
    };
  }

  status_handler(status: FlintpayStatus): Handler {
    return (c) => c.json(this.status_response(status));
  }

  private paymentData() {
    if (this.operation_type === "withdrawal") {
      vitest.assert(this.payout_request_data, "payout data should be defined");
      return {
        name: null,
        number: this.payout_request_data.payment_data_number,
        bank_name: null,
        url: "https://securepaymentgateway.pro/payment/6603597e-845b-4d06-9543-78cb1aa55dea",
      };
    } else {
      return {
        name: "Azizov Abubakr",
        number: common.visaCard,
        bank_name: "Душанбе Сити Банк",
        url: "https://securepaymentgateway.pro/payment/eebfed02-df76-4c52-a983-e01d66123ac5",
      };
    }
  }

  create_response(status: FlintpayStatus, req: any) {
    console.log(req);

    if (this.operation_type === "deposit") {
      this.payin_request_data = PAYIN_REQUEST_SCHEMA.parse(req);
    } else if (this.operation_type === "withdrawal") {
      this.payout_request_data = PAYOUT_REQUEST_SCHEMA.parse(req);
    }
    return this.status_response(status);
  }

  create_response_handler(status: FlintpayStatus): Handler {
    return async (c) =>
      c.json(this.create_response(status, await c.req.json()));
  }

  static no_balance_response_handler() {
    return (c: HttpContext) => {
      c.status(422);
      return c.json({
        error: {
          message: "Validation error",
          details: ["Merchant has no enough money on balance"],
          status: 422,
        },
      });
    };
  }

  callback(status: FlintpayStatus) {
    let payment_data_fields = () => {
      if (this.operation_type === "withdrawal") {
        vitest.assert(
          this.payout_request_data,
          "request data should be defined",
        );
        return {
          payment_data_name: this.payout_request_data.payment_data_name,
          payment_data_number: this.payout_request_data.payment_data_number,
          payment_data_bank_name: null,
        };
      } else {
        let paymentData = this.paymentData();
        return {
          payment_data_name: paymentData.name,
          payment_data_number: paymentData.number,
          payment_data_bank_name: paymentData.bank_name,
        };
      }
    };

    return {
      uuid: this.gateway_id,
      order_id: this.requestData().order_id,
      merchant: this.requestData().merchant,
      kind: this.operation_type === "withdrawal" ? "pay_out" : "pay_in",
      amount_cents: this.requestData().cents,
      amount_currency: this.requestData().currency,
      rate: 9.26,
      rate_without_comission: 9.45,
      crypto_amount_currency: "USDT",
      crypto_amount_cents: 5775,
      seller: "Team 6 TJS",
      buyer: "1378184693@test.com",
      state: status,
      payment_type: this.requestData().payment_type,
      payment_bill_url:
        "https://19d88f83-yummypay-files.s3.timeweb.com/jww5aiofrvmxp0g2a8xapkjb514z",
      payment_page_link:
        "https://safe-payments.solutions/payment/6603597e-845b-4d06-9543-78cb1aa55dea",
      ...payment_data_fields(),
    };
  }

  async send_callback(status: FlintpayStatus) {
    return await fetch(this.requestData().callback_url, {
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
      body: JSON.stringify(this.callback(status)),
    }).then(err_bad_status);
  }

  static settings(uuid: string) {
    return {
      class: "flint_pays",
      merchant_id: uuid,
      method_list: {
        account: "account_number",
        card: "any_bank",
        sbp: "sbp",
      },
      secret: "11111111111111111111111111111111",
      wrapped_to_json_response: true,
    };
  }

  static mock_params(key: string): MockProviderParams {
    return {
      alias: "flint_pays",
      filter_fn: async (req) => {
        // status request
        if (req.method == "GET") {
          return req.query("merchant") === key;
        }
        try {
          let json = await req.json();
          return json["merchant"] === key;
        } catch {
          return false;
        }
      },
    };
  }
}

const StatusMapping: Record<PrimeBusinessStatus, FlintpayStatus> = {
  approved: "confirmed",
  declined: "rejected",
  pending: "created",
};

export function payoutSuite(currency = "RUB"): P2PSuite<FlintpayOperation> {
  let gw = new FlintpayOperation("withdrawal");
  return {
    type: "payout",
    send_callback: async (status, _) => {
      await gw.send_callback(StatusMapping[status]);
    },
    create_handler: (s) => gw.create_response_handler(StatusMapping[s]),
    mock_options: FlintpayOperation.mock_params,
    request: () => ({
      ...common.payoutRequest(currency),
      card: { pan: common.visaCard },
    }),
    settings: (secret) =>
      providers(currency, FlintpayOperation.settings(secret)),
    status_handler: (s) => gw.status_handler(StatusMapping[s]),
    no_requisites_handler: () =>
      FlintpayOperation.no_balance_response_handler(),
    gw,
  };
}

export function payinSuite(currency = "RUB"): P2PSuite<FlintpayOperation> {
  let gw = new FlintpayOperation("deposit");
  return {
    type: "payin",
    send_callback: async (status, _) => {
      await gw.send_callback(StatusMapping[status]);
    },
    create_handler: (s) => gw.create_response_handler(StatusMapping[s]),
    mock_options: FlintpayOperation.mock_params,
    request: () => common.p2pPaymentRequest(currency, "card"),
    settings: (secret) => FlintpayOperation.settings(secret),
    status_handler: (s) => gw.status_handler(StatusMapping[s]),
    no_requisites_handler: () =>
      FlintpayOperation.no_balance_response_handler(),
    gw,
  };
}
