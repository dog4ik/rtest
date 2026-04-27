import { randomUUID } from "node:crypto";
import { err_bad_status } from "@/fetch_utils";
import { PROJECT } from "@/config";
import type { Requisite } from "../trader";
import type { PrimeBusinessStatus } from "@/db/business";
import { authorize_client, type Credentials } from "..";

export type CreateMerchant = {
  phone?: string;
  password: string;
  companyName: string;
  country: string;
  email: string;
};

export type CreateTraderOptions = {
  usdt?: boolean;
  payout_hold_period?: number;
  currency?: string;
};

export type CreateTrader = {
  telegram: string;
  currency: string;
  password: string;
  main_address: string;
  deposit_address: string;
  companyName: string;
  email: string;
  convert_to_usdt: boolean;
  payout_hold_priod: number;
};

export type TraderMethodToggle = {
  in_locked: boolean;
  out_locked: boolean;
  sbp_enabled: boolean;
  card_enabled: boolean;
  account_enabled: boolean;
  link_enabled: boolean;
};

export type CreateSmsParser = {
  sms_type: Requisite;
  sim: string;
  from_data: string;
  change_from_data_to?: string;
  currency: string;
  pattern: string;
  payer_pattern?: string;
  bank_id: string;
};

const DateFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const TimeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export class CoreOfficeDriver {
  cookies: string | null;
  base_url: string;
  constructor(base_url: string) {
    this.cookies = "";
    this.base_url = base_url + "/office";
  }

  private async action(path: string, payload: {}, method?: string) {
    let body = new URLSearchParams();

    // filter out "undefined" literals from constructed urlencoded payload
    for (let [key, value] of Object.entries(payload)) {
      if (value !== undefined) {
        body.append(key, String(value));
      }
    }
    console.log({
      body,
      rawBody: body.toString(),
      cookie: this.cookies,
      method,
      url: this.base_url + path,
    });
    let res = await fetch(this.base_url + path, {
      method: method ?? "POST",
      redirect: "manual",
      body,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        cookie: this.cookies ?? "",
      },
    }).then(err_bad_status);
    let cookie = res.headers.get("set-cookie");
    if (cookie !== null) {
      this.cookies = cookie;
    }
  }

  private async form_action(path: string, body: FormData, method?: string) {
    let res = await fetch(this.base_url + path, {
      method: method ?? "POST",
      redirect: "manual",
      body,
      headers: {
        cookie: this.cookies ?? "",
      },
    }).then(err_bad_status);
    let cookie = res.headers.get("set-cookie");
    if (cookie !== null) {
      this.cookies = cookie;
    }
  }

  async keycloak_login(credentials: Credentials) {
    this.cookies = await authorize_client(
      credentials,
      "http://localhost:3000/office",
    );
    console.log({ cookies: this.cookies });
  }

  async login(credentials: Credentials) {
    if (PROJECT === "a2") {
      return await this.keycloak_login(credentials);
    }
    const form = {
      utf8: "✓",
      authenticity_token: "TODO",
      email: credentials.login,
      password: credentials.password,
      commit: "Login",
    };

    await this.action("/sessions", form);
  }

  async create_settlment(currency: string, amount: number) {
    let form = {
      currency_code: currency,
      amount: amount.toString(),
    };

    await this.action("/settlements?skip_debounce=true", form);
  }
}
