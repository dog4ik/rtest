import { z } from "zod";
import crypto from "node:crypto";
import * as common from "@/common";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import { assert } from "vitest";

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
  callback_url: z.url(),
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
    await fetch(this.request_data.callback_url, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
      },
    });
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
      filter_fn: (req) => {
        return req.header("api-key") === secret;
      },
    };
  }
}
