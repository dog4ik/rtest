import { err_bad_status } from "@/fetch_utils";
import { z } from "zod";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import { assert } from "vitest";
import type { PrimeBusinessStatus } from "@/db/business";
import type { Callback, Status } from "@/suite_interfaces";
import * as common from "@/common";
import crypto from "node:crypto";
import { CurlBuilder } from "@/story/curl";

export type RoyalpayStatus = "ok" | "pending" | "error" | "cancel" | "created";

const RoyalpayStatusMap: Record<PrimeBusinessStatus, RoyalpayStatus> = {
  approved: "ok",
  declined: "error",
  pending: "pending",
};

const UrlFields = z.object({
  callback_url: z.string(),
  fail_url: z.string(),
  pending_url: z.string(),
  success_url: z.string(),
});

const BaseDepositRequestSchema = z.object({
  transaction_id: z.string(),
  amount: z.number(),
  currency: z.string(),
  payment_system: z.string(),
  note: z.string().optional(),
  url: UrlFields,
  three_ds_v2: z.record(z.string(), z.any()).optional(),
});

const SystemFieldsCard = z.object({
  client_id: z.string().optional(),
  card_number: z.string(),
  card_month: z.string(),
  card_year: z.string(),
  cardholder_name: z.string(),
  card_cvv: z.string(),
  client_first_name: z.string().optional(),
  client_last_name: z.string().optional(),
  client_email: z.string().optional(),
  client_country_code: z.string().nullish(),
  client_ip: z.string().nullish(),
  rules: z.string().optional(),
});

const SystemFieldsApm = z.object({
  client_id: z.string().optional(),
  client_email: z.string().optional(),
  client_country_code: z.string().nullish(),
  client_ip: z.string().nullish(),
});

const CardDepositRequestSchema = BaseDepositRequestSchema.extend({
  system_fields: SystemFieldsCard,
});

const ApmDepositRequestSchema = BaseDepositRequestSchema.extend({
  system_fields: SystemFieldsApm,
});

const DepositRequestSchema = z.union([
  CardDepositRequestSchema,
  ApmDepositRequestSchema,
]);

const RefundRequestSchema = z.object({
  transaction_id: z.string(),
  original_transaction_id: z.string(),
  amount: z.number(),
  currency: z.string(),
  url: z.object({
    callback_url: z.string(),
  }),
});

type DepositRequest = z.infer<typeof DepositRequestSchema>;
type RefundRequestData = z.infer<typeof RefundRequestSchema>;

function isCardMethod(payment_system: string): boolean {
  return payment_system.toLowerCase().startsWith("cardgate");
}

export class RoyalpayPayment {
  gateway_id: number;
  refund_gateway_id?: number;
  request_data?: DepositRequest;
  refund_request_data?: RefundRequestData;

  constructor() {
    this.gateway_id = Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000;
  }

  create_response(request: any) {
    this.request_data = DepositRequestSchema.parse(request);
    let r = this.request_data;

    let amount_merchant = (r.amount * 0.88).toFixed(2);

    let redirect: Record<string, any>;
    let token = Buffer.from(
      JSON.stringify({
        id: this.gateway_id,
        control: crypto.randomBytes(16).toString("hex"),
      }),
    ).toString("base64");
    if (isCardMethod(r.payment_system)) {
      redirect = {
        url: `https://aliumpay.com/payment/redirect/away/${token}`,
        method: "GET",
        params: [],
      };
    } else {
      redirect = {
        url: "https://reafter.com/payment/checkout/ap",
        method: "GET",
        params: { data: token },
      };
    }

    return {
      status: "created",
      id: this.gateway_id,
      transaction_id: r.transaction_id,
      type: "deposit",
      amount_to_pay: r.amount.toFixed(2),
      amount_merchant,
      amount_client: r.amount.toFixed(2),
      currency: r.currency,
      payment_system: r.payment_system,
      created: Math.floor(Date.now() / 1000),
      redirect,
    };
  }

  create_handler(): Handler {
    return async (c) => {
      assert.strictEqual(c.req.path, "/deposit/create");
      assert.strictEqual(c.req.method, "POST");
      return c.json(this.create_response(await c.req.json()), 201);
    };
  }

  status_response(status: RoyalpayStatus) {
    assert(this.request_data);
    let r = this.request_data;

    let amount_merchant = (r.amount * 0.88).toFixed(2);
    let fee = (r.amount * 0.065).toFixed(2);
    let rolling_reserve = (r.amount * 0.05).toFixed(2);
    let now = Math.floor(Date.now() / 1000);

    let base: Record<string, any> = {
      status,
      id: this.gateway_id,
      transaction_id: r.transaction_id,
      type: "deposit",
      amount_merchant,
      amount_client: r.amount.toFixed(2),
      currency: r.currency,
      payment_system: r.payment_system,
      created: now,
      updated: now,
      amount_payed: r.amount.toFixed(2),
      fee,
      rolling_reserve,
    };

    if (isCardMethod(r.payment_system)) {
      let cardFields = r.system_fields as z.infer<typeof SystemFieldsCard>;
      base.system_fields = {
        card_number: cardFields.card_number,
        cardholder_name: cardFields.cardholder_name,
      };
    }

    return base;
  }

  status_handler(status: RoyalpayStatus): Handler {
    return (c) => {
      assert(c.req.path.startsWith("/status/"));
      assert.strictEqual(c.req.method, "GET");
      let id = c.req.path.split("/").pop();
      assert.strictEqual(id, String(this.gateway_id));
      return c.json(this.status_response(status));
    };
  }

  callback(status: RoyalpayStatus) {
    assert(this.request_data);
    let r = this.request_data;

    let amount_merchant = (r.amount * 0.88).toFixed(2);
    let fee = (r.amount * 0.065).toFixed(2);
    let rolling_reserve = (r.amount * 0.05).toFixed(2);
    let now = Math.floor(Date.now() / 1000);

    let system_fields: Record<string, string> = {
      card_number: common.maskCard(common.mastercardCard),
      rrn: common.rrn,
    };

    if (isCardMethod(r.payment_system)) {
      let cardFields = r.system_fields as z.infer<typeof SystemFieldsCard>;
      system_fields = {
        card_number: common.maskCard(cardFields.card_number),
        cardholder_name: cardFields.cardholder_name,
      };
    }

    let body: Record<string, any> = {
      status,
      id: this.gateway_id,
      transaction_id: r.transaction_id,
      type: "deposit",
      amount_merchant,
      amount_client: r.amount.toFixed(2),
      currency: r.currency,
      payment_system: r.payment_system,
      created: now,
      updated: now,
      amount_payed: r.amount.toFixed(2),
      fee,
      rolling_reserve,
      system_fields,
    };

    return body;
  }

  refund_callback(status: RoyalpayStatus) {
    assert(this.request_data);
    assert(this.refund_request_data);
    assert(this.refund_gateway_id);
    let r = this.refund_request_data;

    let now = Math.floor(Date.now() / 1000);

    let body: Record<string, any> = {
      status,
      id: this.refund_gateway_id,
      transaction_id: r.transaction_id,
      type: "refund",
      amount_merchant: (r.amount * 2).toFixed(2),
      amount_client: r.amount.toFixed(2),
      currency: r.currency,
      payment_system: this.request_data.payment_system,
      created: now,
      updated: now,
      original_transaction: {
        id: this.gateway_id,
        transaction_id: this.request_data.transaction_id,
      },
      amount_payed: r.amount.toFixed(2),
      fee: r.amount.toFixed(2),
      rolling_reserve: "0.00",
    };

    return body;
  }

  private async _send(
    payload: Record<string, any>,
    url: string,
    secret: string,
  ) {
    let curl = new CurlBuilder(url, "POST")
      .header("content-type", "application/json")
      .json_data(payload)
      .build();
    console.log(`RoyalPay callback: ${curl}`);

    let body = JSON.stringify(payload);
    let signature = crypto
      .createHash("md5")
      .update(body + secret)
      .digest("hex");

    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        sign: signature,
        auth: secret,
      },
      body,
    }).then(err_bad_status);
  }

  async send_callback(status: RoyalpayStatus, secret: string) {
    assert(this.request_data);
    let payload = this.callback(status);
    let url = this.request_data.url.callback_url;
    await this._send(payload, url, secret);
  }

  async send_refund_callback(status: RoyalpayStatus, secret: string) {
    assert(this.refund_request_data);
    let payload = this.refund_callback(status);
    let url = this.refund_request_data.url.callback_url;
    await this._send(payload, url, secret);
  }

  refund_response(status: PrimeBusinessStatus, request: any) {
    this.refund_request_data = RefundRequestSchema.parse(request);
    this.refund_gateway_id =
      Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000;
    let r = this.refund_request_data;

    if (status === "declined") {
      return {
        status: "error",
        code: 401,
        description: "system_error",
        message: "Refund not possible yet",
        id: this.refund_gateway_id,
      };
    }

    return {
      status: "created",
      id: this.refund_gateway_id,
      transaction_id: r.transaction_id,
      type: "refund",
      amount_to_pay: r.amount.toFixed(2),
      amount_merchant: (r.amount * 2).toFixed(2),
      amount_client: r.amount.toFixed(2),
      currency: r.currency,
      payment_system: this.request_data?.payment_system ?? "CardGateEUR",
      created: Math.floor(Date.now() / 1000),
    };
  }

  refund_handler(status: PrimeBusinessStatus): Handler {
    return async (c) => {
      assert.strictEqual(c.req.path, "/refund/create");
      assert.strictEqual(c.req.method, "POST");
      return c.json(this.refund_response(status, await c.req.json()), 201);
    };
  }

  static unauthorized_response() {
    return {
      status: "error",
      code: 101,
      message: "Merchant not found",
    };
  }

  static unauthorized_handler(): Handler {
    return (c) => c.json(RoyalpayPayment.unauthorized_response(), 401);
  }

  static wrong_signature_response() {
    return {
      status: "error",
      code: 102,
      message: "Wrong signature",
    };
  }

  static wrong_signature_handler(): Handler {
    return (c) => c.json(RoyalpayPayment.wrong_signature_response(), 401);
  }

  static missing_field_response(field: string) {
    return {
      status: "error",
      code: 201,
      message: `Mandatory field \`${field}\` is not present`,
    };
  }

  static payment_system_unavailable_response() {
    return {
      status: "error",
      code: 202,
      message: "Payment system is unavailable",
    };
  }

  static payment_system_unavailable_handler(): Handler {
    return (c) =>
      c.json(RoyalpayPayment.payment_system_unavailable_response(), 400);
  }

  static settings(secret: string) {
    return {
      auth_token: secret,
      class: "royalpay",
      masked_provider: true,
      not_internal_page: true,
      secret_key: secret,
    };
  }

  static mock_params(secret: string): MockProviderParams {
    return {
      alias: "royalpay",
      filter_fn: (req) => {
        return req.header("auth") === secret;
      },
    };
  }
}

export function payinSuite(
  currency = "EUR",
): Callback<RoyalpayPayment> & Status<RoyalpayPayment> {
  let gw = new RoyalpayPayment();
  return {
    type: "payin",
    gw,
    send_callback: async (status, secret) => {
      await gw.send_callback(RoyalpayStatusMap[status], secret);
    },
    create_handler: () => gw.create_handler(),
    mock_options: RoyalpayPayment.mock_params,
    request: () => ({
      ...common.paymentRequest(currency),
      card: common.cardObject(),
      customer: {
        browser: common.browserObject(),
        country: null,
        email: "yaroslav@cypix.io",
        first_name: null,
        last_name: null,
        phone: null,
      },
    }),
    settings: (secret) => RoyalpayPayment.settings(secret),
    status_handler: (s) => gw.status_handler(RoyalpayStatusMap[s]),
  };
}
