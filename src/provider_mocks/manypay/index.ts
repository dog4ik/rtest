import { err_bad_status } from "@/fetch_utils";
import { z } from "zod";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import { assert } from "vitest";
import type { PrimeBusinessStatus } from "@/db/business";
import type { Status, Callback } from "@/suite_interfaces";
import * as common from "@/common";
import { SettingsBuilder } from "@/settings_builder";

export const ManypayStatusMap = {
  ACTIVE: 1,
  SUCCESSFUL: 2,
  CANCELED: 3,
  DISPUTE: 4,
  PENDING: 5,
  VALIDATION: 6,
} as const;

export type ManypayStatus =
  (typeof ManypayStatusMap)[keyof typeof ManypayStatusMap];

const PayoutRequestSchema = z.object({
  amount: z.number(),
  currency: z.string().length(3),
  customer: z.object({
    shopcastid: z.string(),
    shopid: z.string().optional(),
    name: z.string().optional(),
    email: z.string(),
    phone: z.string().optional(),
  }),
  payment: z.object({
    fio: z.string().optional(),
    bank: z.string().optional(),
    number: z.string(),
    payment_method: z.enum(["sbp", "card2card"]),
  }),
  integration: z.object({
    external_order_id: z.string(),
    callback_url: z.string(),
    callback_method: z.string(),
    return_url: z.string().optional(),
  }),
});

const StatusRequestSchema = z.object({
  transaction_id: z.uuid(),
  order_id: z.string().length(32).optional(),
});

export class ManypayPayout {
  gateway_id: string;
  request_data?: z.infer<typeof PayoutRequestSchema>;

  constructor() {
    this.gateway_id = crypto.randomUUID();
    this.request_data = undefined;
  }

  create_response(status: ManypayStatus, request_data: any) {
    this.request_data = PayoutRequestSchema.parse(request_data);

    assert.notStrictEqual(
      request_data.payment.bank,
      "_blank_",
      "extra_return_param leaked into bank",
    );

    return {
      id: this.gateway_id,
      base_currency: {
        id: "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        code: request_data.currency,
        amount: String(request_data.amount),
      },
      counter_currency: {
        id: "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        code: "USDT",
        amount: String(request_data.amount / 90),
      },
      exchange_price: "90",
      customer_id: "string",
      payment: {
        payment_method_id: "ec18d2d7-d2e0-41e4-98e4-847f14422d8a",
        payment_method_code: "string",
        bank_id: "f1ae96de-94c1-468e-93a3-6b7213930ca8",
        bank_code: "string",
      },
      create_date: "2019-08-24T14:15:22Z",
      update_date: "2019-08-24T14:15:22Z",
      expiration_time: "2019-08-24T14:15:22Z",
      reason: {
        id: 0,
        status_id: status,
        description: "string",
        label: "string",
        representation: "string",
      },
      status: {
        id: status,
        name: "string",
        description: "string",
        label: "string",
      },
    };
  }
  create_handler(status: ManypayStatus): Handler {
    return async (c) => {
      return c.json(this.create_response(status, await c.req.json()));
    };
  }

  status_response(status: ManypayStatus) {
    assert(this.request_data);

    return {
      id: this.gateway_id,
      amount: this.request_data.amount.toString(),
      profit: "string",
      absolute_fee: "string",
      relative_fee: "string",
      fiat_amount: this.request_data.amount.toString(),
      requisite: {
        id: "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        fio: "string",
        bank_id: "f1ae96de-94c1-468e-93a3-6b7213930ca8",
        number: "string",
        trading_method: "8ce748fb-f815-4dec-8bae-3512d19f859b",
      },
      exchange_rate: "0.20",
      currency: this.request_data.currency,
      currency_id: "305e0674-ee79-42b7-bf83-278294a47a7b",
      reason_id: 1,
      status_id: status,
    };
  }

  status_handler(status: ManypayStatus): Handler {
    return async (c) => {
      let req = StatusRequestSchema.parse(await c.req.json());
      assert.strictEqual(this.gateway_id, req.transaction_id);
      return c.json(this.status_response(status));
    };
  }

  callback(status: ManypayStatus) {
    assert(this.request_data);

    return {
      id: crypto.randomUUID(),
      transaction_id: this.gateway_id,
      customer_id: "12345678",
      reason_id: 5,
      status_id: status,
      subreason_id: null,
      create_date: "2025-11-26T20:02:00.246249Z",
      transaction: {
        id: "3e80dcf0-879d-4819-85ad-7ead4fa5eda6",
        amount: String(this.request_data.amount),
        digital_amount: "15075.00",
        exchange_rate: "100.00",
        create_date: "2025-11-26T19:55:00.246249Z",
        update_date: "2025-11-26T20:00:00.246249Z",
        expiration_time: "2025-11-26T20:30:00.246249Z",
      },
      customer: "12345678",
      external_order_id: this.request_data.integration.external_order_id,
    };
  }

  async send_callback(status: ManypayStatus) {
    assert(this.request_data);

    await fetch(this.request_data.integration.callback_url, {
      method: this.request_data.integration.callback_method,
      body: JSON.stringify(this.callback(status)),
      headers: {
        "content-type": "application/json",
      },
    }).then(err_bad_status);
  }

  static settings(secret: string) {
    return {
      api_key: secret,
      class: "manypay",
      sandbox: true,
      secret_key: secret,
      sign_key: "c9370644c7a6caeb7754e5bf41f53fe2",
    };
  }

  static mock_params(secret: string): MockProviderParams {
    return {
      alias: "manypay",
      filter_fn(req) {
        return req.header("x-api-key") === secret;
      },
    };
  }
}

export function payoutSuite(
  currency = "RUB",
): Callback<ManypayPayout> & Status<ManypayPayout> {
  let gw = new ManypayPayout();
  let statusMap: Record<PrimeBusinessStatus, ManypayStatus> = {
    approved: ManypayStatusMap.SUCCESSFUL,
    declined: ManypayStatusMap.CANCELED,
    pending: ManypayStatusMap.PENDING,
  };
  return {
    type: "payout",
    send_callback: async (status, _) => {
      await gw.send_callback(statusMap[status]);
    },
    create_handler: (s) => gw.create_handler(statusMap[s]),
    mock_options: ManypayPayout.mock_params,
    request: () => ({
      ...common.payoutRequest(currency),
      card: { pan: common.visaCard },
    }),
    settings: (secret) =>
      new SettingsBuilder()
        .addP2P(currency, "manypay")
        .withGateway(ManypayPayout.settings(secret), "manypay")
        .withGatewayParam("skip_card_payout_validation", true)
        .build(),
    status_handler: (s) => gw.status_handler(statusMap[s]),
    gw,
  };
}
