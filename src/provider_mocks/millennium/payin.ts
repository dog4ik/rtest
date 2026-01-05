import * as vitest from "vitest";
import * as common from "@/common";
import { z } from "zod";
import type { HttpContext, MockProviderParams } from "@/mock_server/api";
import { callbackSignature } from ".";
import { err_bad_status } from "@/fetch_utils";
import { CoreStatusMap, type CoreStatus } from "@/db/core";

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

const StatusMapping: Record<CoreStatus, MillenniumStatus> = {
  [CoreStatusMap.pending]: "WAIT",
  [CoreStatusMap.approved]: "ACCEPTED",
  [CoreStatusMap.declined]: "CANCELLED",
} as const;

const MillenniumStatusSchema = z.enum(MillenniumStatusVariants);
export type MillenniumStatus = z.infer<typeof MillenniumStatusSchema>;

function dataResponse<T>(status: MillenniumStatus, data: T) {
  return { status, data };
}

const CREATE_SCHEMA = z.object({
  merchantID: z.string(),
  amount: z.number(),
  code: z.string(),
  wallet: z.string().optional(),
  bankId: z.string().optional(),
  firstname: z.string().optional(),
  lastname: z.string().optional(),
  orderID: z.string().optional(),
  currency: z.string().optional(),
});

export class MillenniumPayment {
  gateway_id: string;
  request_data?: z.infer<typeof CREATE_SCHEMA>;
  constructor() {
    this.gateway_id = crypto.randomUUID();
    this.request_data = undefined;
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

  create_response(status: MillenniumStatus, request_data: any) {
    this.request_data = CREATE_SCHEMA.parse(request_data);

    return dataResponse(status, {
      method: {
        reqID: 90,
        code: "tinkof",
        methodName: "Т-Банк",
        number: this.requisiteNumber(this.request_data.code),
        comment: "Максим Б.",
      },
      amountUSDT: this.request_data.amount * RUB_USDT_RATE,
      expire: 1749628157,
      paymentLink:
        "https://payment.mllnm.net/1/71ba29c0-8518-4998-8d58-dda5f2dcb11a",
      tradeID: this.gateway_id,
      feePercent: 2.0,
    });
  }

  status_response(status: MillenniumStatus) {
    if (status === "WAIT") {
      return dataResponse(status, {});
    }

    if (status === "ACCEPTED" || status === "CANCELLED") {
      return dataResponse(status, {
        amount: this.request_data!.amount,
        amountUSDT: this.request_data!.amount * RUB_USDT_RATE,
        feePercent: 2.0,
      });
    }

    throw new Error(`Unknown millennium status: ${status}`);
  }

  callback(status: MillenniumStatus) {
    return {
      amount: this.request_data!.amount,
      amountUSDT: Number(
        (this.request_data!.amount * RUB_USDT_RATE).toFixed(2),
      ),
      code: "sber",
      currency: "RUB",
      feePercent: (2.0).toFixed(2),
      payoutID: this.gateway_id,
      merchantID: 30,
      orderID: this.request_data!.orderID,
      result: status,
    };
  }

  async send_callback(status: MillenniumStatus, secret: string) {
    const payload = this.callback(status);
    const signature = callbackSignature(payload, secret);

    const headers = { "x-hash": signature, "content-type": "application/json" };
    await fetch(CALLBACK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }).then(err_bad_status);
  }

  status_handler(status: CoreStatus) {
    return async (c: HttpContext) =>
      c.json(this.status_response(StatusMapping[status]));
  }

  create_handler(status: CoreStatus) {
    return async (c: HttpContext) =>
      c.json(this.create_response(StatusMapping[status], await c.req.json()));
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
      wrapped_to_json_response: true,
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
