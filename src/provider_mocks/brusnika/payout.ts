import { z } from "zod";
import { err_bad_status } from "@/fetch_utils";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import * as vitest from "vitest";
import * as common from "@/common";
import { CurlBuilder } from "@/story/curl";
import type { PrimeBusinessStatus } from "@/db/business";
import type { P2PSuite } from "@/suite_interfaces";
import {
  WEBHOOK_TOKEN,
  type BrusnikaPaymentStatus,
  success_response,
  brusnika_filter_fn,
} from "./index";

const PAYOUT_METHOD_SCHEMA = z.enum([
  "toCard",
  "sbp",
  "toAccount",
  "alfa_alfa",
  "sber_sber",
  "ozon_ozon",
  "tbank_tbank",
  "vtb_vtb",
  "gazprom_gazprom",
  "psb_psb",
]);

export type BrusnikaPayoutMethod = z.infer<typeof PAYOUT_METHOD_SCHEMA>;

const PAYOUT_REQUEST_SCHEMA = z.object({
  clientID: z.string(),
  clientIP: z.ipv4().or(z.ipv6()),
  clientDateCreated: z.string(),
  paymentMethod: PAYOUT_METHOD_SCHEMA,
  idTransactionMerchant: z.string().optional(),
  amount: z.number(),
  number: z.string(),
  bankName: z.string().optional(),
  nameMediator: z.string().optional(),
});

type PayoutRequestData = z.infer<typeof PAYOUT_REQUEST_SCHEMA>;

export class BrusnikaPayout {
  gateway_id: string;
  request_data?: PayoutRequestData;

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
      typeOperation: "payOut",
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
    this.request_data = PAYOUT_REQUEST_SCHEMA.parse(request);
    return success_response(this.operation_data(status));
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

  static no_balance_handler(): Handler {
    return (c) =>
      c.json({
        result: {
          status: "warning",
          "x-request-id": crypto.randomUUID(),
          codeError: "none",
          codeErrorExt: "notEnoughMoneyOnBalance",
          message: "Not enough money on balance",
        },
        data: null,
        totalNumberRecords: 0,
      });
  }

  /**
   * Brusnika payout callback payload
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
    console.log("brusnika payout callback", curl);
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

  static mock_params(secret: string): MockProviderParams {
    return {
      alias: "brusnikapay",
      filter_fn: (req) => brusnika_filter_fn(secret, req),
    };
  }

  mock_params_uzs(secret: string): MockProviderParams {
    return {
      alias: "brusnikapay_uzs",
      filter_fn: (req) => brusnika_filter_fn(secret, req),
    };
  }
}

export function payoutSuite(currency = "RUB"): P2PSuite<BrusnikaPayout> {
  let gw = new BrusnikaPayout();
  let statusMap: Record<PrimeBusinessStatus, BrusnikaPaymentStatus> = {
    approved: "success",
    declined: "failed",
    pending: "in_progress",
  };
  return {
    type: "payout",
    send_callback: async (status, _) => {
      await gw.send_callback(statusMap[status]);
    },
    create_handler: (s) => gw.create_handler(statusMap[s]),
    mock_options: BrusnikaPayout.mock_params,
    request: () => ({
      ...common.payoutRequest(currency),
      card: { pan: common.visaCard },
      extra_return_param: "card",
      bank_account: {
        bank_name: "Uzcard",
        requisite_type: "card",
      },
      customer: {
        email: "dog@gmail.com",
        first_name: "Test",
        last_name: "User",
        phone: "79112223344",
        ip: "192.168.1.1",
      },
    }),
    settings: (secret) => BrusnikaPayout.settings(secret),
    status_handler: (s) => gw.status_handler(statusMap[s]),
    no_requisites_handler: () => BrusnikaPayout.no_balance_handler(),
    gw,
  };
}
