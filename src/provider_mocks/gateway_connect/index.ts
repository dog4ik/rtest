import { delay } from "@std/async";
import * as collections from "@std/collections";
import { assert } from "vitest";
import { z } from "zod";
import * as common from "@/common";
import { CONFIG } from "@/config";
import type { BusinessStatus, PrimeBusinessStatus } from "@/db/business";
import { err_bad_status } from "@/fetch_utils";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import { MAPPING_START_PORT } from "@/patch/production_file";
import { CurlBuilder } from "@/story/curl";
import type { P2PSuite } from "@/suite_interfaces";
import { createJwt } from "./callback";
import type { GwConnectError } from "./error";
import { InteractionLogs } from "./interaction_logs";
import {
  type ConnectPayinResponse,
  PayinRequestSchema,
  type RedirectRequest,
} from "./payin";
import { PayoutRequestSchema } from "./payout";
import { RefundRequestSchema } from "./refund";
import type { GCSettingsType } from "./settings";
import { type ConnectStatusResponse, StatusRequestSchema } from "./status";

export type GcRequisiteType =
  | "sbp"
  | "tpay"
  | "card"
  | "account"
  | "link"
  | "deeplink"
  | "tpay_qr_data";

export const ANY_GATEWAY_CONNECT_SIGN_KEY = "9bda346ae93db3a3297ad5a209d81b22";
export const GC_MAPPING_KEY = "_gc";
export const GC_MOCK_PORT = MAPPING_START_PORT - 1;
export const SETTINGS_INTERNAL_SECRET_KEY = "_gc_instance_secret";
export function commonSettings(alias: string, secret: string) {
  return {
    class: alias,
    // enable routing is required in pcidss
    enable_routing: CONFIG.in_project(["reactivepay"]) ? true : undefined,
    gateway_settings: {
      bypass_processing_url: true,
      callback: true,
      enable: true,
      full_link: `http://host.docker.internal:${GC_MOCK_PORT}`,
      gateway_key: alias,
      methods: {
        payout: {
          enable_status_checker: true,
          final_waiting_seconds: 15,
          params_fields: {
            callback_url: true,
            params: ["customer", "bank_account", "card"],
            payment: [
              "merchant_private_key",
              "extra_return_param",
              "gateway_amount",
              "lead_id",
              "gateway_currency",
              "token",
            ],
            processing_url: true,
            settings: [SETTINGS_INTERNAL_SECRET_KEY],
          },
        },
        pay: {
          enable_status_checker: true,
          final_waiting_seconds: 15,
          params_fields: {
            callback_3ds_url: true,
            callback_url: true,
            params: [
              "customer",
              "bank_account",
              "extra_return_param",
              "pan",
              "expires",
              "holder",
              "cvv",
              "browser",
              "phone",
              "country",
              "city",
              "state",
              "postcode",
              "address",
              "email",
              "first_name",
              "last_name",
              "ip",
              "birthday",
            ],
            payment: [
              "merchant_private_key",
              "gateway_amount",
              "extra_return_param",
              "lead_id",
              "gateway_currency",
              "token",
              "product",
              "ip",
            ],
            processing_url: true,
            charge_page_url: true,
            settings: [
              SETTINGS_INTERNAL_SECRET_KEY,
              "wrapped_to_json_response",
              "method",
            ],
          },
        },
        status: {
          params_fields: {
            params: ["gateway_token", "token", "merchant_private_key"],
            payment: ["gateway_token", "token", "extra_return_param"],
            refund: ["amount", "gateway_amount", "token"],
            settings: [SETTINGS_INTERNAL_SECRET_KEY],
          },
        },
        refund: {
          enable_status_checker: true,
          params_fields: {
            params: ["gateway_token", "token", "merchant_private_key"],
            payment: ["gateway_token", "token", "currency"],
            refund: ["amount", "token"],
            settings: [SETTINGS_INTERNAL_SECRET_KEY],
          },
        },
        confirm_secure_code: {
          params_fields: {
            params: ["headers", "cres", "checkout_result_token"],
            settings: [SETTINGS_INTERNAL_SECRET_KEY],
          },
        },
      },
      processing_method: "http_requests",
      status_checker_time_rates: {
        "1-3": 30,
        "15-": 3600,
        "4-6": 60,
        "7-14": 120,
      },
    },
    [SETTINGS_INTERNAL_SECRET_KEY]: secret,
    sign_key: ANY_GATEWAY_CONNECT_SIGN_KEY,
    wrapped_to_json_response: true,
  };
}

export class GatewayConnectTransaction {
  gateway_id: string;
  payin_request: z.infer<ReturnType<typeof PayinRequestSchema>> | undefined;
  payout_request: z.infer<ReturnType<typeof PayoutRequestSchema>> | undefined;
  status_request: z.infer<ReturnType<typeof StatusRequestSchema>> | undefined;
  refund_request: z.infer<ReturnType<typeof RefundRequestSchema>> | undefined;
  constructor(
    private alias: string,
    private gw_settings: Partial<GCSettingsType>,
    // This secret is a workaround to prevent multiple GatewayConnectTransaction instances
    // from sharing the same provider instance when given the same secret value.
    // It adds an extra seed to the secret so that even if two GatewayConnectTransaction
    // instances receive the same secret, they will process different request queues.
    //
    // This could be avoided if I will avoid giving the same secret to the instances in tests if possible.
    private extra_secret?: string,
  ) {
    this.gateway_id = crypto.randomUUID();
  }

  private request_data() {
    return this.payin_request || this.payout_request;
  }

  private resolved_secret_value(secret: string) {
    return secret + (this.extra_secret ?? "");
  }

  settings(secret: string) {
    let resolved_secret = this.resolved_secret_value(secret);
    return collections.deepMerge(
      this.gw_settings,
      commonSettings(this.alias, resolved_secret),
      {
        arrays: "merge",
      },
    );
  }

  basic_payin_handler(status: PrimeBusinessStatus): Handler {
    return async (c) => {
      this.payin_request = PayinRequestSchema(z.object({})).parse(
        await c.req.json(),
      );

      let logs = await this.build_interaction_logs("pay", status);

      return c.json({
        status,
        amount: common.amount,
        currency: "RUB",
        details: status === "declined" ? "Test error message" : undefined,
        result: true,
        gateway_token: this.gateway_id,
        logs,
      } as ConnectPayinResponse);
    };
  }

  async build_interaction_logs(name: string, status: PrimeBusinessStatus) {
    let interaction_logs = new InteractionLogs();
    let request = this.payin_request || this.payout_request;
    assert(request, "request is required to build interaction logs");

    let auth_span = interaction_logs.span("authorization");
    auth_span.set_request(
      `${common.redirectPayUrl}/auth`,
      JSON.stringify({
        login: "login",
        password: "password",
      }),
    );

    await delay(100);
    auth_span.set_response_body(JSON.stringify({ success: true }));
    auth_span.set_response_status(200);

    let span = interaction_logs.span(name);
    if (this.refund_request) {
      span.set_request(
        `${common.redirectPayUrl}/transaction`,
        JSON.stringify({
          amount: this.refund_request.refund.amount,
          currency: this.refund_request.payment.currency,
        }),
      );
    } else {
      span.set_request(
        common.redirectPayUrl,
        JSON.stringify({
          amount: request.payment.gateway_amount,
          currency: request.payment.gateway_currency,
        }),
      );
    }

    await delay(100);
    span.set_response_body(JSON.stringify({ status }));
    span.set_response_status(status === "declined" ? 400 : 200);
    return interaction_logs.build();
  }

  requisites_payin_handler(
    status: PrimeBusinessStatus,
    requisite_type: GcRequisiteType,
    requisite_data?: {
      bank?: string;
      holder?: string;
      payment_form_url?: string;
      qr_data?: string;
      deeplink?: boolean;
      amount?: number;
    },
  ): Handler {
    return async (c) => {
      this.payin_request = PayinRequestSchema(z.object({})).parse(
        await c.req.json(),
      );
      let logs = await this.build_interaction_logs("pay", status);

      let requisites: Record<string, any> | undefined;
      if (status === "pending") {
        if (CONFIG.in_project(["spinpay", "reactivepay"])) {
          requisites = {
            holder: requisite_data?.holder ?? common.fullName,
            bank_name: requisite_data?.bank ?? common.bankName,
            qr_data: requisite_data?.qr_data,
            deeplink: requisite_data?.deeplink,
          };
          if (requisite_type === "card") {
            requisites.card = common.visaCard;
          } else if (requisite_type === "sbp") {
            requisites.pan = common.phoneNumber;
          } else if (requisite_type === "link") {
            requisites.link = { url: common.redirectPayUrl };
          } else if (requisite_type === "account") {
            requisites.number = common.accountNumber;
          } else {
            assert.fail(
              `Spinpay/RP unimplemented requisite type: ${requisite_type}`,
            );
          }
        } else {
          requisites = {
            holder: requisite_data?.holder ?? common.fullName,
            bank_name: requisite_data?.bank ?? common.bankName,
          };
          if (requisite_type === "card") {
            requisites.card = common.visaCard;
          } else if (requisite_type === "sbp") {
            requisites.phone = common.phoneNumber;
          } else if (requisite_type === "tpay") {
            requisites.phone = `+${common.phoneNumber}`;
            requisites.deeplink = true;
          } else if (requisite_type === "deeplink") {
            requisites.link = common.redirectPayUrl;
            // requisites["deeplink"] = true;
          } else if (requisite_type === "link") {
            requisites.link = common.redirectPayUrl;
            // Не знаю зачем, Чигин отправляет deeplink: true, даже если интеграция не deeplink.
            // Отсавлю так чтобы его интеграция не померла.
            // requisites["deeplink"] = true;
            requisites.phone = common.visaCard;
          } else if (requisite_type === "tpay_qr_data") {
            requisites.qr_data = common.redirectPayUrl;
            requisites.deeplink = true;
          }
        }
      }

      let is_wrapped =
        this.payin_request.settings.wrapped_to_json_response ?? false;

      return c.json({
        status,
        result: true,
        amount: requisite_data?.amount ?? common.amount,
        requisites,
        currency: this.payin_request.payment.gateway_currency,
        payment_form_url: requisite_data?.payment_form_url,
        qr_data: common.redirectPayUrl,
        details: status === "declined" ? "Test error message" : undefined,
        redirect_request:
          status === "pending"
            ? {
                url: is_wrapped
                  ? this.request_data()?.processing_url
                  : this.request_data()?.charge_page_url,
                type: is_wrapped ? "get_with_processing" : "post",
              }
            : undefined,
        gateway_token: this.gateway_id,
        logs,
      } as ConnectPayinResponse);
    };
  }

  basic_payout_handler(status: PrimeBusinessStatus): Handler {
    return async (c) => {
      this.payout_request = PayoutRequestSchema(z.object({})).parse(
        await c.req.json(),
      );

      let logs = await this.build_interaction_logs("payout", status);

      return c.json({
        status,
        amount: common.amount,
        currency: "RUB",
        details: status === "declined" ? "Test error message" : undefined,
        result: true,
        gateway_token: this.gateway_id,
        logs,
      } as ConnectPayinResponse);
    };
  }

  redirect_payin_handler(
    status: PrimeBusinessStatus,
    redirect_request: RedirectRequest,
    card_enrolled?: boolean,
  ): Handler {
    return async (c) => {
      this.payin_request = PayinRequestSchema(z.object({})).parse(
        await c.req.json(),
      );

      let logs = await this.build_interaction_logs("pay", status);

      return c.json({
        status,
        amount: common.amount,
        card_enrolled,
        currency: "RUB",
        details: status === "declined" ? "Test error message" : undefined,
        result: true,
        redirect_request,
        gateway_token: this.gateway_id,
        logs,
      } as ConnectPayinResponse);
    };
  }

  refund_handler(status: PrimeBusinessStatus): Handler {
    return async (c) => {
      this.refund_request = RefundRequestSchema(z.object({})).parse(
        await c.req.json(),
      );

      let logs = await this.build_interaction_logs("refund", status);

      return c.json({
        status,
        amount: this.refund_request.refund.amount,
        currency: "RUB",
        details: status === "declined" ? "Test error message " : undefined,
        logs,
        result: true,
      } as ConnectStatusResponse);
    };
  }

  status_handler(status: BusinessStatus, amount?: number): Handler {
    return async (c) => {
      this.status_request = StatusRequestSchema(z.object({})).parse(
        await c.req.json(),
      );
      let request_data = this.request_data();
      assert(
        request_data,
        "request data should be defined when status handler is fired",
      );

      let logs = await this.build_interaction_logs(
        "status",
        status as PrimeBusinessStatus,
      );

      return c.json({
        status,
        amount: amount ?? common.amount,
        currency: request_data.payment.gateway_currency,
        details: status === "declined" ? "Test error message " : undefined,
        logs,
        result: true,
      } as ConnectStatusResponse);
    };
  }

  async send_callback(status: BusinessStatus, amount?: number) {
    let req_data = this.request_data();
    assert(req_data, "request data should be defined");
    let payload = {
      status,
      reason: status === "declined" ? "Test callback error message" : undefined,
      currency: "RUB",
      logs: [{ request: JSON.stringify({ status }) }],
      amount: amount ?? common.amount,
    };
    let jwt = await createJwt(
      payload,
      req_data.payment.merchant_private_key,
      Buffer.from(ANY_GATEWAY_CONNECT_SIGN_KEY),
    );

    let body = JSON.stringify(payload);
    let url = `${CONFIG.urls().business}/callbacks/v2/gateway_callbacks/${req_data.payment.token}`;
    let authorization = `Bearer ${jwt}`;

    let curl = new CurlBuilder(url, "POST")
      .header("authorization", authorization)
      .json_data(payload);
    console.log("Sending callback to Gateway Connect", curl.build());

    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization,
      },
      body,
    }).then(err_bad_status);
  }

  error_handler(message?: string): Handler {
    return async (c) => {
      this.payin_request = PayinRequestSchema(z.object({})).parse(
        await c.req.json(),
      );

      return c.json({
        result: false,
        error: message ?? "Test faiure",
        logs: [],
      } as GwConnectError);
    };
  }

  mock_params(secret: string): MockProviderParams {
    let resolved_secret = this.resolved_secret_value(secret);
    return {
      alias: GC_MAPPING_KEY,
      filter_fn: async (req) => {
        let json = await req.json();
        return json.settings[SETTINGS_INTERNAL_SECRET_KEY] === resolved_secret;
      },
    };
  }
}

export function payinSuite(
  currency = "RUB",
  extra_secret?: string,
): P2PSuite<GatewayConnectTransaction> {
  let gw = new GatewayConnectTransaction("manypay", {}, extra_secret);
  return {
    type: "payin",
    send_callback: async (status, _) => {
      await gw.send_callback(status);
    },
    create_handler: (s) => gw.basic_payin_handler(s),
    mock_options: (secret) => gw.mock_params(secret),
    request: () => common.p2pPaymentRequest(currency, "card"),
    settings: (secret) => gw.settings(secret),
    status_handler: (s) => gw.status_handler(s),
    no_requisites_handler: () => gw.basic_payin_handler("declined"),
    gw,
  };
}

export function payoutSuite(
  currency = "RUB",
): P2PSuite<GatewayConnectTransaction> {
  let gw = new GatewayConnectTransaction("manypay", {});
  return {
    type: "payout",
    send_callback: async (status, _) => {
      await gw.send_callback(status);
    },
    create_handler: (s) => gw.basic_payout_handler(s),
    mock_options: (secret) => gw.mock_params(secret),
    request: () => ({
      ...common.payoutRequest(currency),
      product: "test product",
    }),
    settings: (secret) => gw.settings(secret),
    status_handler: (s) => gw.status_handler(s),
    no_requisites_handler: () => gw.basic_payin_handler("declined"),
    gw,
  };
}
