import { PROJECT } from "@/config";
import { err_bad_status } from "@/fetch_utils";
import { authorize_client, type Credentials } from "..";
import type { Requisite } from "../trader";

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

const _DateFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const _TimeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export class CoreOfficeDriver {
  cookies: string | null;
  base_url: string;
  constructor(base_url: string) {
    this.cookies = "";
    this.base_url = `${base_url}/office`;
  }

  private async action(path: string, payload: {}, method?: string) {
    let body = new URLSearchParams();

    // filter out "undefined" literals from constructed urlencoded payload
    for (let [key, value] of Object.entries(payload)) {
      if (value !== undefined) {
        body.append(key, String(value));
      }
    }
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

  async keycloak_login(credentials: Credentials) {
    this.cookies = await authorize_client(credentials, this.base_url);
  }

  async login(credentials: Credentials) {
    if (PROJECT === "a2") {
      return await this.keycloak_login(credentials);
    }
    const form = {
      utf8: "✓",
      "signin[email]": credentials.login,
      "signin[password]": credentials.password,
      commit: "Login",
    };

    await this.action("/auth/login", form);
  }

  async create_settlement(currency: string, amount: number) {
    let form = {
      currency_code: currency,
      amount: amount.toString(),
    };

    await this.action("/settlements?skip_debounce=true", form);
  }
}
