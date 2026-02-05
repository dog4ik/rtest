import { type Credentials } from "..";
import { randomUUID } from "node:crypto";
import type { CoreStatus } from "@/db/core";
import { err_bad_status } from "@/fetch_utils";

export type CreateMerchant = {
  phone?: string;
  password: string;
  companyName: string;
  country: string;
  email: string;
};

export type CreateTrader = {
  telegram: string;
  currency: string;
  password: string;
  companyName: string;
  email: string;
  convert_to_usdt: boolean;
};

export type TraderMethodToggle = {
  in_locked: boolean;
  out_locked: boolean;
  sbp_enabled: boolean;
  card_enabled: boolean;
  account_enabled: boolean;
  link_enabled: boolean;
};

export class CoreDriver {
  cookies: string | null;
  base_url: string;
  constructor(base_url: string) {
    this.cookies = "";
    this.base_url = base_url + "/manage";
  }

  private async action(path: string, payload: {}, method?: string) {
    let body = new URLSearchParams();

    // filter out "undefined" literals from constructed urlencoded payload
    for (let [key, value] of Object.entries(payload)) {
      if (value !== undefined) {
        body.append(key, String(value));
      }
    }
    console.log(body);
    let res = await fetch(this.base_url + path, {
      method: method ?? "POST",
      redirect: "manual",
      body,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: this.cookies ?? "",
      },
    }).then(err_bad_status);
    let cookie = res.headers.get("set-cookie");
    if (cookie !== null) {
      this.cookies = cookie;
    }
  }

  async login(credentials: Credentials) {
    const form = {
      utf8: "✓",
      authenticity_token: "TODO",
      email: credentials.login,
      password: credentials.password,
      commit: "Login",
    };

    await this.action("/sessions", form);
  }

  async create_merchant(params: CreateMerchant) {
    let form = {
      utf8: "",
      authenticity_token: "TODO authenticity token",
      email: params.email,
      commit: "Add new merchant",

      "api_v1_profile[phone]": params.phone,
      "api_v1_profile[temp_password]": params.password,
      "api_v1_profile[company_name]": params.companyName,
      "api_v1_profile[country]": params.country,
      "api_v1_profile[country_id]": 236,
      "api_v1_profile[contact_person_name]": "",
      "api_v1_profile[contact_person_position]": "",
      "api_v1_profile[web_site]": undefined,
    };

    await this.action("/merchants", form);
  }

  async create_random_merchant() {
    let uuid = randomUUID();
    let params: CreateMerchant = {
      companyName: uuid,
      email: `${uuid}@mail.com`,
      password: 'c@"6J?Q3:?H@me=',
      country: "236",
    };
    await this.create_merchant(params);
    return params;
  }

  async create_trader(params: CreateTrader) {
    let form = {
      utf8: "✓",
      "trader[company_name]": params.companyName,
      "trader[default_currency]": params.currency,
      "trader[email]": params.email,
      "trader[web_site]": params.telegram,
      "trader[temp_password]": params.password,
      main_address: "",
      deposit_address: "",
      white_list: "",
      min_limit: "",
      max_limit: "",
      convert_to_usdt: params.convert_to_usdt ? "" : undefined,
      commit: "Add+new+trader",
    };

    await this.action("/traders", form);
  }

  async create_random_trader() {
    let uuid = randomUUID();
    let params: CreateTrader = {
      companyName: uuid,
      email: `${uuid}@mail.com`,
      password: 'c@"6J?Q3:?H@me=',
      convert_to_usdt: true,
      telegram: uuid,
      currency: "RUB",
    };
    await this.create_trader(params);
    return params;
  }

  async enable_trader_methods(
    trader_id: number,
    toggle: Partial<TraderMethodToggle>,
  ) {
    for (let [key, value] of Object.entries(toggle)) {
      await this.enable_trader_method(
        trader_id,
        key as keyof TraderMethodToggle,
        value,
      );
    }
  }

  async enable_trader_method(
    trader_id: number,
    key: keyof TraderMethodToggle,
    force: boolean,
  ) {
    await this.action(`/traders/${trader_id}`, { [key]: force }, "PUT");
  }

  async add_supported_banks(trader_id: number, bank_list: string[]) {
    let data = {
      utf8: "✓",
      _method: "patch",
      white_list: "",
      min_limit: "",
      max_limit: "",
      "bank_ids[]": bank_list,
      commit: "Save",
    };
    await this.action(`/traders/${trader_id}`, data);
  }

  async cashin(
    mid: number,
    currency: string,
    amount: number,
    to_account_id?: number,
  ) {
    let dateFormatter = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    let timeFormatter = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    let now = new Date();
    let params = {
      utf8: "",
      authenticity_token: "TODO",
      profile_id: mid,
      to_name: "",
      amount,
      to_account_id: to_account_id ? to_account_id.toString() : "",
      "payment_request[currency]": currency,
      date: dateFormatter.format(now),
      time: timeFormatter.format(now),
      description: "",
      commit: "Create",
    };
    await this.action("/transfers?direction=in", params);
  }

  // TODO: status is not a CoreStatus, it should be string.
  async change_status(id: number, status: CoreStatus) {
    let params = {
      utf8: "✓",
      id,
      target_status: status,
      authenticity_token: "TODO",
      declination_reason: "",
      commit: "Save",
    };

    let query = {
      action: "index",
      controller: "manage/cashouts",
      page: "1",
      per_page: "20",
    };

    const queryParams = new URLSearchParams(query);

    await this.action(`/cashouts/change_status?${queryParams}`, params);
  }

  async resend_callback(token: string) {
    let params = { api_payment_token: token };
    await this.action(`/cashouts/${token}/resend_callback`, params);
  }

  async block_traffick(merchant_id: number, block: boolean) {
    let form = {
      utf8: "✓",
      _method: "patch",
      "api_v1_profile[do_not_send_receipt]": "0",
      "api_v1_profile[refunds_blocked]": "0",
      "api_v1_profile[traffic_blocked]": block ? "all_blocked" : "no_blocked",
      "api_v1_profile[default_currency]": "AED",
      "api_v1_profile[relevant_currencies][]": "",
      commit: "Save",
      "api_v1_profile[merchant_settlement_info_attributes][account_number]": "",
      "api_v1_profile[merchant_settlement_info_attributes][account_name]": "",
      "api_v1_profile[merchant_settlement_info_attributes][beneficiary_name]":
        "",
      "api_v1_profile[merchant_settlement_info_attributes][beneficiary_address]":
        "",
      "api_v1_profile[merchant_settlement_info_attributes][swift_code]": "",
      "api_v1_profile[merchant_settlement_info_attributes][bank_name]": "",
      "api_v1_profile[merchant_settlement_info_attributes][bank_address]": "",
      "api_v1_profile[merchant_settlement_info_attributes][country]": "",
      "api_v1_profile[merchant_settlement_info_attributes][iban]": "",
      "api_v1_profile[merchant_settlement_info_attributes][id]": "92",
      "api_v1_profile[user_ids][]": "",
      "api_v1_profile[allow_subaccounts]": "0",
      "api_v1_profile[new_password]": "",
    };
    await this.action(`/merchants/${merchant_id}`, form);
  }
}
