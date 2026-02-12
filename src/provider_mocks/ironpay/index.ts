import { z } from "zod";
import crypto from "node:crypto";
import * as common from "@/common";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import { assert } from "vitest";
import { err_bad_status } from "@/fetch_utils";
import type { PrimeBusinessStatus } from "@/db/business";
import type { P2PSuite } from "@/suite_interfaces";
import { providers } from "@/settings_builder";
import { PROJECT } from "@/config";

export type IronpayStatus = "Pending" | "Canceled" | "Approved";

export const IronpayMethodMap = {
  CARD: 1,
  URL: 2,
  SBP: 3,
  ACCOUNT: 4,
  SBP_ECOM: 5,
  TRANSGRAN: 6,
  AGREEMENT_NUMBER: 7,
  TRANSGRAN_CARD: 8,
  TRC20: 9,
} as const;

const IronpayMethodSchema = z.union(
  Object.values(IronpayMethodMap).map((v) => z.literal(v)),
);

export type IronpayMethod =
  (typeof IronpayMethodMap)[keyof typeof IronpayMethodMap];

const RATE = 0.8;
const COMMISSION = 0.1;
const CALLBACK_URL = "http://127.0.0.1:4000/callback/ironpay";

function callbackSignature(
  params: Record<string, any>,
  apiKey: string,
): string {
  let keys = Object.keys(params).sort();
  let s = "";

  for (let key of keys) {
    s += `${params[key]}:`;
  }

  return crypto
    .createHash("SHA1")
    .update(s + apiKey)
    .digest("hex");
}

function wrapResponseData<T>(data: T) {
  return {
    status: true,
    data,
  };
}

function method_requisite(method: IronpayMethod): Record<string, string> {
  switch (method) {
    case IronpayMethodMap.CARD:
      return { card_number: common.visaCard };

    case IronpayMethodMap.SBP:
      return { sbp_number: `+${common.phoneNumber}` };

    case IronpayMethodMap.ACCOUNT:
      return { account_number: "test account" };

    case IronpayMethodMap.SBP_ECOM:
      return { url: common.redirectPayUrl };

    default:
      throw new Error(`Unknown payment method: ${method}`);
  }
}

const IronpayRequestSchema = z.object({
  local_amount: z.number(),
  curr: z.string(),
  order_id: z.string().length(32),
  client_id: z.email(),
  payment_type_id: IronpayMethodSchema,
  callback_url: z.url().optional(),
});

export class IronpayPayment {
  gateway_id: number;
  request_data?: z.infer<typeof IronpayRequestSchema>;

  constructor() {
    this.gateway_id = Math.floor(Math.random() * 10_000_000);
  }

  create_response(req: unknown) {
    this.request_data = IronpayRequestSchema.parse(req);

    let response: Record<string, any> = {
      internal_order_id: this.gateway_id,
      status_order: "Pending" as IronpayStatus,
      bank_id: 21,
      bank_code: "100000000020",
      unix_time: 1758010728,
      curr: this.request_data.curr,
      local_amount: this.request_data.local_amount,
      short_name: common.fullName,
      bank_name: "Россельхозбанк",
      rate: RATE.toString(),
      amount_usdt: (this.request_data.local_amount / RATE).toString(),
      commission_local: (this.request_data.local_amount * COMMISSION).toFixed(
        2,
      ),
      commission_usdt: (
        (this.request_data.local_amount / RATE) *
        COMMISSION
      ).toFixed(2),
    };

    let requisites = method_requisite(this.request_data.payment_type_id);

    return wrapResponseData({ ...response, ...requisites });
  }

  create_handler(): Handler {
    return async (c) => c.json(this.create_response(await c.req.json()));
  }

  status_response(status: IronpayStatus) {
    assert(this.request_data);

    return wrapResponseData({
      internal_order_id: this.gateway_id,
      status_order: status,
      is_appeal: 0,
      type: "payment",
      bank_id: 21,
      curr: this.request_data.curr,
      pay_method: null,
      local_amount: this.request_data.local_amount.toString(),
      transfer_fee: 0,
      time_unix: null,
      short_nameclient: null,
    });
  }

  status_handler(status: IronpayStatus): Handler {
    return (c) => c.json(this.status_response(status));
  }

  static login_handler(secret: string): Handler {
    return (c) => {
      assert.strictEqual(c.req.path, "/api/login");
      assert.strictEqual(c.req.method, "POST");
      let expires = new Date();
      expires.setHours(expires.getHours() + 1);
      return c.json({
        access_token: secret,
        refresh_token: secret,
        expires_at: expires.toISOString(),
      });
    };
  }

  callback(status: IronpayStatus, secret: string) {
    assert(this.request_data, "request data is not present");

    let payload: Record<string, any> = {
      amount: this.request_data.local_amount,
      created_at: "2025-09-17 02-02-20",
      external_order_id: this.request_data.order_id,
      internal_order_id: this.gateway_id,
      status,
      unix_time: "1758074554",
    };

    payload.sign = callbackSignature(payload, secret);
    return payload;
  }

  async send_callback(status: IronpayStatus, secret: string) {
    assert(this.request_data);
    let payload = this.callback(status, secret);
    console.log("Callback body", JSON.stringify(payload, null, 2));
    await fetch(this.request_data.callback_url ?? CALLBACK_URL, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
      },
    }).then(err_bad_status);
  }

  static no_requisites_response() {
    return {
      status: false,
      message:
        "There are currently no payment details available. Your request has been rejected, please try again later.",
    };
  }

  static no_requisites_handler(): Handler {
    return (c) => c.json(this.no_requisites_response(), 422);
  }

  static settings(secret: string) {
    return {
      api_token: secret,
      bank_list: {
        alfabank: "100000000008",
        gazprom: "100000000001",
        raiffeisen: "100000000007",
        sberbank: "100000000111",
        tbank: "100000000004",
        vtb: "100000000005",
      },
      class: "ironpay",
      merchant_id: " 2424",
    };
  }

  static mock_params(secret: string): MockProviderParams {
    return {
      alias: "ironpay",
      filter_fn: async (req) => {
        // support login for spinpay https://api.iron-pay.com/login
        if (req.path === "/api/login") {
          let body = await req.json();
          return body.uuid === secret;
        }
        return (
          req.header("api-key") === secret ||
          req.header("Authorization") === `Bearer ${secret}`
        );
      },
    };
  }
}

export function payinSuite(
  currency = "RUB",
): P2PSuite<IronpayPayment> {
  let gw = new IronpayPayment();
  let statusMap: Record<PrimeBusinessStatus, IronpayStatus> = {
    approved: "Approved",
    declined: "Canceled",
    pending: "Pending",
  };
  return {
    type: "payin",
    send_callback: async (status, secret) => {
      await gw.send_callback(statusMap[status], secret);
    },
    create_handler: (_, ctx) => {
      if (PROJECT === "spinpay") {
        ctx.provider.queue(IronpayPayment.login_handler(ctx.ctx.uuid));
      }
      return gw.create_handler();
    },
    mock_options: IronpayPayment.mock_params,
    request: () => common.paymentRequest(currency),
    settings: (secret) => IronpayPayment.settings(secret),
    status_handler: (s) => gw.status_handler(statusMap[s]),
    no_requisites_handler: () => IronpayPayment.no_requisites_handler(),
    gw,
  };
}
