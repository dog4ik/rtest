import crypto from "node:crypto";
import { z } from "zod";
import { assert } from "vitest";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import { err_bad_status } from "@/fetch_utils";
import * as common from "@/common";
import type { PrimeBusinessStatus } from "@/db/business";
import type { P2PSuite } from "@/suite_interfaces";
import { MAPPING_START_PORT } from "@/patch/production_file";
import { defaultSettings } from "@/settings_builder";

export const REACTIVEPAY_MOCK_PORT = MAPPING_START_PORT - 2;
export const REACTIVEPAY_MAPPING_KEY = "_reactivepay";

const DECLINE_REASON =
  'gateway response error: test error';

const PayRequestSchema = z.object({
  product: z.string(),
  amount: z.number(),
  currency: z.string(),
  orderNumber: z.string(),
  redirectSuccessUrl: z.string(),
  redirectFailUrl: z.string(),
  callback_url: z.string(),
  customer: z
    .object({
      country: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      region: z.string().optional(),
      postcode: z.string().optional(),
      phone: z.string().optional(),
      ip: z.string().optional(),
      email: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      state: z.string().optional(),
      browser: z.record(z.string(), z.any()).optional(),
    })
    .passthrough(),
  card: z
    .object({
      pan: z.string().optional(),
      expires: z.string().optional(),
      holder: z.string().optional(),
      cvv: z.string().optional(),
    })
    .optional(),
  bank_account: z.record(z.string(), z.any()).optional(),
});

function computeCallbackSignature(
  token: string,
  type: string,
  status: string,
  extraReturnParam: string,
  orderNumber: string | undefined,
  amount: number,
  currency: string,
  gatewayAmount: number,
  gatewayCurrency: string,
  signKey: string,
): string {
  let sig = "";
  const add_s = (v: string) => {
    sig += v.length.toString() + v;
  };
  add_s(token);
  add_s(type);
  add_s(status);
  if (extraReturnParam) {
    add_s(extraReturnParam);
  }
  if (orderNumber) {
    add_s(orderNumber);
  }
  add_s(amount.toString());
  add_s(currency);
  add_s(gatewayAmount.toString());
  add_s(gatewayCurrency);
  sig += signKey;
  return crypto.createHash("md5").update(sig).digest("hex");
}

export class ReactivepayTransaction {
  gateway_id: string;
  request_data?: z.infer<typeof PayRequestSchema>;

  constructor() {
    this.gateway_id = crypto.randomBytes(16).toString("hex");
  }

  create_response(status: PrimeBusinessStatus, request: any) {
    this.request_data = PayRequestSchema.parse(request);

    const processingUrl = `https://business.reactivepay.com/checkout_results/${this.gateway_id}/processing`;
    const response: Record<string, any> = {
      success: true,
      result: 0,
      status: 200,
      token: this.gateway_id,
      processingUrl,
      payment: {
        amount: this.request_data.amount,
        gateway_amount: this.request_data.amount,
        gateway_currency: this.request_data.currency,
        currency: this.request_data.currency,
        status: status,
        two_stage_mode: false,
        commission: 0.0,
        ...(status === "declined"
          ? {
              decline_reason: DECLINE_REASON,
            }
          : {}),
      },
    };

    if (status !== "declined") {
      response["redirectRequest"] = {
        type: "get",
        url: common.redirectPayUrl,
      };
    }

    return response;
  }

  create_handler(status: PrimeBusinessStatus): Handler {
    return async (c) =>
      c.json(this.create_response(status, await c.req.json()));
  }

  status_handler(_status: PrimeBusinessStatus): Handler {
    return (_c) => {
      throw new Error("TODO: implement reactivepay status handler");
    };
  }

  no_requisites_handler(): Handler {
    return async (c) =>
      c.json(this.create_response("declined", await c.req.json()));
  }

  callback(status: PrimeBusinessStatus, signKey: string) {
    assert(this.request_data, "request data should be defined");

    const extraReturnParam = "_blank_";
    const type = "pay";

    const signature = computeCallbackSignature(
      this.gateway_id,
      type,
      status,
      extraReturnParam,
      this.request_data.orderNumber,
      this.request_data.amount,
      this.request_data.currency,
      this.request_data.amount,
      this.request_data.currency,
      signKey,
    );

    return {
      token: this.gateway_id,
      type,
      status,
      extraReturnParam,
      orderNumber: this.request_data.orderNumber,
      walletDisplayName: "",
      amount: this.request_data.amount,
      currency: this.request_data.currency,
      gatewayAmount: this.request_data.amount,
      gatewayCurrency: this.request_data.currency,
      cardHolder: this.request_data.card?.holder ?? "",
      gatewayDetails: {
        decline_reason: status === "declined" ? DECLINE_REASON : undefined,
      },
      sanitizedMask: common.maskCard(this.request_data.card?.pan ?? ""),
      walletToken: crypto.randomBytes(18).toString("hex"),
      signature,
    };
  }

  async send_callback(status: PrimeBusinessStatus, signKey: string) {
    assert(this.request_data, "request data should be defined");
    const payload = this.callback(status, signKey);
    const url = this.request_data.callback_url;
    console.log("Sending reactivepay callback to", url, payload);
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(err_bad_status);
  }

  static settings(secret: string) {
    return {
      class: "reactivepay",
      token: secret,
      sign_key: secret,
      base_url: `http://host.docker.internal:${REACTIVEPAY_MOCK_PORT}`,
    };
  }

  static mock_params(secret: string): MockProviderParams {
    return {
      alias: REACTIVEPAY_MAPPING_KEY,
      filter_fn: (req) => req.header("authorization") === `Bearer ${secret}`,
    };
  }
}

export function payinSuite(currency = "USD"): P2PSuite<ReactivepayTransaction> {
  const gw = new ReactivepayTransaction();
  return {
    type: "payin",
    gw,
    send_callback: async (status, secret) => {
      await gw.send_callback(status, secret);
    },
    create_handler: (s) => gw.create_handler(s),
    mock_options: ReactivepayTransaction.mock_params,
    request: () => ({
      ...common.paymentRequest(currency),
      card: common.cardObject(),
      customer: {
        first_name: "Campbell",
        last_name: "Dixon",
        email: "camby27@outlook.com",
        phone: "610403121400",
        address: "18 Bunyip St",
        city: "Burleigh Heads",
        country: "AU",
        region: "QLD",
        state: "QLD",
        postcode: "4220",
        browser: {
          accept_header:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          color_depth: "24",
          ip: "110.20.175.54",
          language: "en,ru;q=0.9,ru-RU;q=0.8,en-US;q=0.7,ka;q=0.6",
          screen_height: "1080",
          screen_width: "1920",
          tz: "-240",
          user_agent:
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          java_enabled: false,
          javascript_enabled: true,
          window_width: "774",
          window_height: "932",
        },
      },
      extra_return_param: "VISA",
    }),
    settings: (secret) =>
      defaultSettings(currency, ReactivepayTransaction.settings(secret)),
    status_handler: (s) => gw.status_handler(s),
    no_requisites_handler: () => gw.no_requisites_handler(),
  };
}
