import { z } from "zod";
import { assert } from "vitest";
import type { PrimeBusinessStatus } from "@/db/business";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import { MAPPING_START_PORT } from "@/patch/production_file";
import * as collections from "@std/collections";
import * as common from "@/common";
import { PayinRequestSchema, type ConnectPayinResponse } from "./payin";
import { type GwConnectError } from "./error";
import { StatusRequestSchema, type ConnectStatusResponse } from "./status";
import type { P2PSuite } from "@/suite_interfaces";
import { createJwt } from "./callback";
import { err_bad_status } from "@/fetch_utils";
import { InteractionLogs } from "./interaction_logs";
import { delay } from "@std/async";
import type { GCSettingsType } from "./settings";
import { PayoutRequestSchema } from "./payout";

export const ANY_GATEWAY_CONNECT_SIGN_KEY = "9bda346ae93db3a3297ad5a209d81b22";
export const GC_MAPPING_KEY = "_gc";
export const GC_MOCK_PORT = MAPPING_START_PORT - 1;
const SETTINGS_INTERNAL_SECRET_KEY = "_gc_instance_secret";
export function commonSettings(alias: string, secret: string) {
  return {
    class: alias,
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
              "country",
              "city",
              "state",
              "phone",
              "birthday",
              "first_name",
              "state",
              "last_name",
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
            settings: [SETTINGS_INTERNAL_SECRET_KEY],
          },
        },
        status: {
          params_fields: {
            params: ["gateway_token", "token", "merchant_private_key"],
            payment: ["gateway_token", "token"],
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
  };
}

export class GatewayConnectTransaction {
  gateway_id: string;
  payin_request: z.infer<ReturnType<typeof PayinRequestSchema>> | undefined;
  payout_request: z.infer<ReturnType<typeof PayoutRequestSchema>> | undefined;
  status_request: z.infer<ReturnType<typeof StatusRequestSchema>> | undefined;
  constructor(private alias: string, private gw_settings: Partial<GCSettingsType>) {
    this.gateway_id = crypto.randomUUID();
  }

  private request_data() {
    return this.payin_request || this.payout_request;
  }

  settings(secret: string) {
    return collections.deepMerge(
      this.gw_settings,
      commonSettings(this.alias, secret),
      { arrays: "merge" },
    );
  }

  basic_payin_handler(status: PrimeBusinessStatus): Handler {
    return async (c) => {
      let interaction_logs = new InteractionLogs();
      this.payin_request = PayinRequestSchema(z.object({})).parse(
        await c.req.json(),
      );

      let span = interaction_logs.span("pay");
      span.set_request(
        common.redirectPayUrl,
        JSON.stringify({
          amount: this.payin_request.payment.gateway_amount,
          currency: this.payin_request.payment.gateway_currency,
        }),
      );

      await delay(200);
      span.set_response_body(JSON.stringify({ status }));
      span.set_response_status(status === "declined" ? 400 : 200);

      return c.json({
        status,
        amount: common.amount,
        currency: "RUB",
        details: status === "declined" ? "Test error message" : undefined,
        result: true,
        gateway_token: this.gateway_id,
        logs: interaction_logs.build(),
      } as ConnectPayinResponse);
    };
  }

  requisites_payin_handler(
    status: PrimeBusinessStatus,
    requisite_type: "sbp" | "card" | "link",
  ): Handler {
    return async (c) => {
      let interaction_logs = new InteractionLogs();
      this.payin_request = PayinRequestSchema(z.object({})).parse(
        await c.req.json(),
      );

      let span = interaction_logs.span("pay");
      span.set_request(
        common.redirectPayUrl,
        JSON.stringify({
          amount: this.payin_request.payment.gateway_amount,
          currency: this.payin_request.payment.gateway_currency,
        }),
      );

      await delay(200);
      span.set_response_body(JSON.stringify({ status }));
      span.set_response_status(status === "declined" ? 400 : 200);

      let requisites: Record<string, any> | undefined = undefined;
      if (status === "pending") {
        requisites = {
          holder: common.fullName,
          bank_name: common.bankName,
        };
        if (requisite_type === "card") {
          requisites["card"] = common.visaCard;
        } else if (requisite_type === "sbp") {
          requisites["pan"] = common.phoneNumber;
        } else if (requisite_type === "link") {
          throw Error("link requisite is not supported");
        }
      }

      return c.json({
        status,
        result: true,
        amount: common.amount,
        requisites,
        currency: "RUB",
        details: status === "declined" ? "Test error message" : undefined,
        redirect_request: {
          url: this.request_data()?.processing_url,
          wrapped_to_json_response: true,
          type: "get_with_processing",
        },
        gateway_token: this.gateway_id,
        logs: interaction_logs.build(),
      } as ConnectPayinResponse);
    };
  }

  basic_payout_handler(status: PrimeBusinessStatus): Handler {
    return async (c) => {
      let interaction_logs = new InteractionLogs();
      this.payout_request = PayoutRequestSchema(z.object({})).parse(
        await c.req.json(),
      );

      let span = interaction_logs.span("pay");
      span.set_request(
        common.redirectPayUrl,
        JSON.stringify({
          amount: this.payout_request.payment.gateway_amount,
          currency: this.payout_request.payment.gateway_currency,
        }),
      );

      await delay(200);
      span.set_response_body(JSON.stringify({ status }));
      span.set_response_status(status === "declined" ? 400 : 200);

      return c.json({
        status,
        amount: common.amount,
        currency: "RUB",
        details: status === "declined" ? "Test error message" : undefined,
        result: true,
        gateway_token: this.gateway_id,
        logs: interaction_logs.build(),
      } as ConnectPayinResponse);
    };
  }

  redirect_payin_handler(
    status: PrimeBusinessStatus,
    redirect_url = common.redirectPayUrl,
  ): Handler {
    return async (c) => {
      let interaction_logs = new InteractionLogs();
      this.payin_request = PayinRequestSchema(z.object({})).parse(
        await c.req.json(),
      );

      let span = interaction_logs.span("pay");
      span.set_request(
        common.redirectPayUrl,
        JSON.stringify({
          amount: this.payin_request.payment.gateway_amount,
          currency: this.payin_request.payment.gateway_currency,
        }),
      );

      await delay(200);
      span.set_response_body(JSON.stringify({ status }));
      span.set_response_status(status === "declined" ? 400 : 200);

      return c.json({
        status,
        amount: common.amount,
        currency: "RUB",
        details: status === "declined" ? "Test error message" : undefined,
        result: true,
        redirect_request: {
          url:
            status === "pending"
              ? redirect_url
              : this.request_data()?.processing_url,
          type: status === "pending" ? "get_with_processing" : "post",
        },
        gateway_token: this.gateway_id,
        logs: interaction_logs.build(),
      } as ConnectPayinResponse);
    };
  }

  redirect_3ds_response_handler(): Handler {
    return async (c) => {
      let interaction_logs = new InteractionLogs();
      this.payin_request = PayinRequestSchema(z.object({})).parse(
        await c.req.json(),
      );

      let span = interaction_logs.span("pay");
      span.set_request(
        common.redirectPayUrl,
        JSON.stringify({
          amount: this.payin_request.payment.gateway_amount,
          currency: this.payin_request.payment.gateway_currency,
        }),
      );

      await delay(200);
      span.set_response_body(JSON.stringify({}));
      span.set_response_status(200);

      return c.json({
        status: "pending",
        amount: common.amount,
        card_enrolled: true,
        currency: "RUB",
        result: true,
        redirect_request: {
          url: common.redirectPayUrl,
          type: "get_with_processing",
        },
        gateway_token: this.gateway_id,
        logs: interaction_logs.build(),
      } as ConnectPayinResponse);
    };
  }

  status_handler(status: PrimeBusinessStatus): Handler {
    return async (c) => {
      this.status_request = StatusRequestSchema(z.object({})).parse(
        await c.req.json(),
      );

      let interaction_logs = new InteractionLogs();
      let span = interaction_logs.span("status");
      span.set_request(
        common.redirectPayUrl,
        JSON.stringify({
          amount: this.status_request.payment.token,
          currency: this.status_request.payment.gateway_token,
        }),
      );

      await delay(200);
      span.set_response_status(200);
      span.set_response_body(JSON.stringify({ status }));

      return c.json({
        status,
        amount: common.amount,
        currency: "RUB",
        details: status === "declined" ? "Test error message " : undefined,
        logs: interaction_logs.build(),
        result: true,
      } as ConnectStatusResponse);
    };
  }

  async send_callback(status: PrimeBusinessStatus) {
    let req_data = this.request_data();
    assert(req_data, "request data should be defined");
    let payload = {
      status,
      reason: status === "declined" ? "Test callback error message" : undefined,
      currency: "RUB",
      amount: common.amount,
    };
    let jwt = await createJwt(
      payload,
      req_data.payment.merchant_private_key,
      Buffer.from(ANY_GATEWAY_CONNECT_SIGN_KEY),
    );

    let body = JSON.stringify(payload);
    let url = `http://localhost:4000/callbacks/v2/gateway_callbacks/${req_data.payment.token}`;

    console.log("Sending callback to Gateway Connect", url, body);

    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${jwt}`,
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
    return {
      alias: GC_MAPPING_KEY,
      filter_fn: async (req) => {
        let json = await req.json();
        return json.settings[SETTINGS_INTERNAL_SECRET_KEY] === secret;
      },
    };
  }
}

export function payinSuite(
  currency = "RUB",
): P2PSuite<GatewayConnectTransaction> {
  let gw = new GatewayConnectTransaction("manypay", {});
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
