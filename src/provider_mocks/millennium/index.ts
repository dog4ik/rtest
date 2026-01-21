import * as vitest from "vitest";
import * as common from "@/common";
import { z } from "zod";
import type {
  Handler,
  HttpContext,
  MockProviderParams,
} from "@/mock_server/api";
import { err_bad_status } from "@/fetch_utils";
import type { PrimeBusinessStatus } from "@/db/business";
import { CurlBuilder } from "@/story/curl";

import crypto from "node:crypto";

export function callbackSignature(
  params: Record<string, any>,
  secret: string,
): string {
  let keys = Object.keys(params).sort();
  let payload = "";

  for (let key of keys) {
    payload += `${params[key]}{ml}`;
  }

  payload += crypto.createHash("sha256").update(secret).digest("hex");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

const RUB_USDT_RATE = 1 / 60;

const CALLBACK_URL = "http://127.0.0.1:4000/callback/millenniumpay";

export const MillenniumStatusVariants = [
  "NOT_FOUND",
  "WAIT",
  "ACCEPTED",
  "CANCELLED",
  "DISPUTE",
  "RESEND",
  "ERROR",
] as const;

const StatusMapping: Record<PrimeBusinessStatus, MillenniumStatus> = {
  pending: "WAIT",
  approved: "ACCEPTED",
  declined: "CANCELLED",
} as const;

const MillenniumStatusSchema = z.enum(MillenniumStatusVariants);
export type MillenniumStatus = z.infer<typeof MillenniumStatusSchema>;

function dataResponse<T>(status: MillenniumStatus, data: T) {
  console.log(
    "Millennum response: ",
    JSON.stringify({ status, data }, null, 2),
  );
  return { status, data };
}

const CODE_SCHEMA = z.enum(["card", "cards", "sbp", "phone", "nspk", "qr"]);

const PAYIN_CREATE_SCHEMA = z.object({
  merchantID: z.string(),
  amount: z.number(),
  code: CODE_SCHEMA,
  orderID: z.string().optional(),
  currency: z.string().optional(),
});

const PAYOUT_CREATE_SCHEMA = z.object({
  merchantID: z.string(),
  amount: z.number(),
  code: CODE_SCHEMA,
  orderID: z.string().optional(),
  currency: z.string().optional(),
  wallet: z.string(),
  bankId: z.string(),
  firstname: z.string(),
  lastname: z.string(),
});

export class MillenniumTransaction {
  gateway_id: string;
  payin_data?: z.infer<typeof PAYIN_CREATE_SCHEMA>;
  payout_data?: z.infer<typeof PAYOUT_CREATE_SCHEMA>;
  constructor() {
    this.gateway_id = crypto.randomUUID();
    this.payin_data = undefined;
    this.payout_data = undefined;
  }

  private requestData() {
    vitest.assert(this.payin_data || this.payout_data);
    return this.payin_data ?? this.payout_data!;
  }

  private requisiteNumber(code: string) {
    if (["cards", "card"].includes(code)) {
      return common.visaCard;
    } else if (["sbp", "phone"].includes(code)) {
      return common.phoneNumber;
    } else if (["nspk", "qr"].includes(code)) {
      return common.redirectPayUrl;
    } else {
      vitest.assert.fail(`Unhandled method code: ${code}`);
    }
  }

  payin_create_response(status: MillenniumStatus, request_data: any) {
    this.payin_data = PAYIN_CREATE_SCHEMA.parse(request_data);

    return dataResponse(status, {
      method: {
        reqID: 90,
        code: "tinkof",
        methodName: "Т-Банк",
        number: this.requisiteNumber(this.payin_data.code),
        comment: common.fullName,
      },
      amountUSDT: this.payin_data.amount * RUB_USDT_RATE,
      expire: 1749628157,
      paymentLink:
        "https://payment.mllnm.net/1/71ba29c0-8518-4998-8d58-dda5f2dcb11a",
      tradeID: this.gateway_id,
      feePercent: 2.0,
    });
  }

  payout_create_response(status: MillenniumStatus, request_data: any) {
    this.payout_data = PAYOUT_CREATE_SCHEMA.parse(request_data);

    return dataResponse(status, {
      tradeID: this.gateway_id,
      orderId: this.payout_data.orderID,
      balance: -3000,
    });
  }

  status_response(status: MillenniumStatus) {
    if (status === "WAIT") {
      return dataResponse(status, {});
    }

    if (status === "ACCEPTED" || status === "CANCELLED") {
      let data = this.requestData();
      return dataResponse(status, {
        amount: data.amount,
        amountUSDT: data.amount * RUB_USDT_RATE,
        feePercent: 2.0,
      });
    }

    throw new Error(`Unknown millennium status: ${status}`);
  }

  static no_requisites_response() {
    return {
      data: { message: "Реквизиты не найдены" },
      error: "Реквизиты не найдены",
      status: "NOT_FOUND",
    };
  }

  static no_requisites_handler(): Handler {
    return (c) => c.json(this.no_requisites_response(), 404);
  }

  /**
   * Payin and payout share callbacks
   */
  callback(status: MillenniumStatus) {
    let data = this.requestData();
    return {
      amount: data.amount.toFixed(2),
      amountUSDT: Number((data.amount * RUB_USDT_RATE).toFixed(2)),
      code: "sber",
      currency: "RUB",
      feePercent: (2.0).toFixed(2),
      payoutID: this.gateway_id,
      merchantID: 30,
      orderID: data.orderID,
      result: status,
    };
  }

  async send_callback(status: MillenniumStatus, secret: string) {
    const payload = this.callback(status);
    const signature = callbackSignature(payload, secret);

    const headers = { "x-hash": signature, "content-type": "application/json" };
    let curl = new CurlBuilder(CALLBACK_URL, "POST")
      .set_headers(new Headers(headers))
      .json_data(payload)
      .build();
    console.log("millennium callback:", curl);
    await fetch(CALLBACK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }).then(err_bad_status);
  }

  /**
   * Payin and payout share statuses
   */
  status_handler(status: PrimeBusinessStatus) {
    return async (c: HttpContext) =>
      c.json(this.status_response(StatusMapping[status]));
  }

  payin_create_handler(status: PrimeBusinessStatus) {
    return async (c: HttpContext) =>
      c.json(
        this.payin_create_response(StatusMapping[status], await c.req.json()),
      );
  }

  payout_create_handler(status: PrimeBusinessStatus) {
    return async (c: HttpContext) =>
      c.json(
        this.payin_create_response(StatusMapping[status], await c.req.json()),
      );
  }

  static settings(key: string) {
    return {
      class: "millenniumpay",
      merchant_id: "30",
      bank_list: {
        sber: "100000000111",
        default: "100000000008",
      },
      secret_key: key,
      skip_card_payout_validation: true,
    };
  }

  static mock_params(api_key: string): MockProviderParams {
    return {
      alias: "millenniumpay",
      filter_fn: (req) => {
        let expected_key = api_key;
        let auth = req.header("x-secret");
        if (auth === undefined) return false;
        return auth === expected_key;
      },
    };
  }
}
