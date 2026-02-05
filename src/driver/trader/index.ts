import * as common from "@/common";
import type { Middleware } from "openapi-fetch";
import {
  throwResponseErrors,
  createTraderClient,
  type TraderClient,
} from "./traderFetchClient";
import { assert } from "vitest";
import type { Context } from "@/test_context/context";

const BANKLIST = [
  "sberbank",
  "raiffeisen",
  "tbank",
  "uralsib",
  "alfabank",
  "sovcombank",
  "humocard",
  "humo",
  "uzcard",
  "tbc",
  "bog",
  "otp",
  "psb",
  "yandex",
  "mts",
  "vtb",
  "vodafone",
  "ubrr",
  "instapays",
  "a-mobile",
  "oriyonbonk",
  "amonat",
  "eskhata",
  "spitamen",
  "bank_account",
  "attijiari_wafa_bank",
  "khan_bank",
  "adcb",
  "mashreq_bank",
  "fab",
  "adib",
  "nbd",
  "al_rahji_bank",
  "ila_bank",
  "mercado_pago",
  "lemon_cash",
  "ripio",
  "neft",
  "imps",
  "bt",
  "state_bank_of_india",
  "hdfc_bank",
  "idfc_bank",
  "punjab_national_bank",
  "rbl_bank",
  "axis_bank",
  "kotak_bank",
  "icici_bank",
  "au_small_finance_bank",
  "indus_bank",
  "yes_bank",
  "fino_payment_bank",
  "canara_bank",
  "bank_of_baroda",
  "paytm",
  "phonepe",
  "google_pay",
  "mobikwik",
  "freecharge",
  "whatsapp_pay",
  "bhim_upi",
  "blanc",
] as const;

export type Bank = (typeof BANKLIST)[number];

export type Requisite = "card" | "sbp" | "link" | "account";

function createMiddleware(api_key: string): Middleware {
  return {
    async onRequest({ request }) {
      console.log("Trader client request", request.method, request.url);
      request.headers.set("x-api-key", api_key);
      return request;
    },
  };
}

type CreateProfilePayload = {
  bank: Bank;
  device_id: string;
};

type CreateRequisitePayload = {
  profile_id: number;
  requisite_type: Requisite;
  requisite_value: string;
  card_holder?: string;
  title: string;
};

type SendSmsPayload = {
  uuid: string;
  from: string;
  text: string;
  sentStamp?: number;
  receivedStamp?: number;
  deliveryTime?: number;
  sim: string;
};

export class TraderDriver {
  client: TraderClient;
  session_token?: string;
  constructor(private ctx: Context) {
    this.client = createTraderClient("http://127.0.0.1:4080");
  }

  async login(email: string, password: string) {
    let res = await this.client
      .POST("/api/session", { body: { email, password } })
      .then(throwResponseErrors);
    assert(res.session_token);
    this.session_token = res.session_token;
    this.client.use(createMiddleware(res.session_token));
  }

  async create_device(title?: string) {
    let res = await this.client
      .POST("/api/devices", {
        body: { title: title ?? crypto.randomUUID() },
      })
      .then(throwResponseErrors);
    assert(res.id);
    return res.id;
  }

  async activate_device(id: string) {
    return await this.client.PUT("/api/devices/{id}/activate", {
      params: { path: { id } },
    });
  }

  async create_profile({ device_id, bank }: CreateProfilePayload) {
    return await this.client
      .POST("/api/profiles", {
        body: {
          last_name: "test",
          first_name: "profile",
          middle_name: "",
          bank,
          device_id,
          account_number: "",
          note: "",
          title: "eeaetuhaos",
          phone: "",
          link: "",
        },
      })
      .then(throwResponseErrors);
  }

  async add_requisite({
    profile_id,
    requisite_value,
    requisite_type,
    card_holder,
    title,
  }: CreateRequisitePayload) {
    return await this.client
      .POST("/api/profiles/{profile_id}/requisites", {
        params: {
          path: {
            profile_id,
          },
        },
        body: {
          title,
          requisite_type,
          requisite_value,
          card_holder,
          min_amount_float: 0,
          max_amount_float: 0,
          amount_limit_float: 0,
          transaction_limit: 0,
          transaction_delay: 0,
        },
      })
      .then(throwResponseErrors);
  }

  async activate_requisite(id: number) {
    return await this.client.PUT("/api/requisites/{id}/activate", {
      params: { path: { id } },
    });
  }

  async send_sms(payload: SendSmsPayload) {
    assert(
      this.session_token,
      "session token should be defined when sms is sent",
    );
    let now = new Date();
    let payload_with_time = {
      ...payload,
      sentStamp: now.getTime(),
      receivedStamp: now.getTime(),
      deliveryTime: now.getTime(),
    };
    let body = JSON.stringify(payload_with_time);
    this.ctx.story.add_chapter("Send sms", payload_with_time);
    console.log("Cerate sms body", body);
    return await fetch("http://localhost:5070", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.session_token,
      },
      body,
    }).then((r) => r.json());
  }

  async approve_transaction(feed_id: number) {
    await this.client
      .POST("/api/feeds/{id}/approve", {
        params: { path: { id: feed_id } },
      })
      .then(throwResponseErrors);
  }

  async decline_transaction(feed_id: number) {
    await this.client
      .POST("/api/feeds/{id}/decline", {
        params: { path: { id: feed_id } },
      })
      .then(throwResponseErrors);
  }
}

export function traderSetttings(list: number[]) {
  return {
    USDT: {
      gateways: {
        pay: {
          providers: [
            {
              trader: "trader",
            },
          ],
        },
        payout: {
          providers: [
            {
              trader: "trader",
            },
          ],
        },
      },
    },
    convert_to: "USDT",
    gateways: {
      allow_host2host: true,
      trader: {
        list,
        pay_expired_minutes: 15,
        private_key: "1ccca8894bf0baabb47ef6695c0f0f18",
        wrapped_to_json_response: true,
      },
    },
  };
}
