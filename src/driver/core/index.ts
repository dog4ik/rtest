import { randomUUID } from "node:crypto";
import * as common from "@/common";
import { CONFIG, PROJECT } from "@/config";
import type { PrimeBusinessStatus } from "@/db/business";
import { err_bad_status } from "@/fetch_utils";
import { authorize_client, type Credentials } from "..";
import type { Requisite } from "../trader";

export type CreateAgentOptions = {
  merchant_id?: number;
  traders_ids?: number[];
  email?: string;
};

export type CreateMerchantOptions = {
  email?: string;
};

export type CreateAgent = {
  company_name: string;
  email: string;
  temp_password: string;
  merchant_id?: number;
  trader_ids: number[];
};

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
  email?: string;
  min_deposit?: number;
  min_limit?: number;
  max_limit?: number;
};

export type CreateTrader = {
  telegram: string;
  currency: string;
  password: string;
  companyName: string;
  email: string;
  convert_to_usdt: boolean;
  payout_hold_priod: number;
  min_deposit?: number;
  min_limit?: number;
  max_limit?: number;
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
  from_pattern?: string;
  text_pattern?: string;
  payer_pattern?: string;
  card_mask?: string;
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

export class CoreDriver {
  cookies: string | null;
  base_url: string;
  docker_compose_path: string;
  constructor(base_url: string, docker_compose_path?: string) {
    this.cookies = "";
    this.base_url = `${base_url}/manage`;
    this.docker_compose_path = docker_compose_path ?? "";
  }

  private async action(
    path: string,
    payload: {} | URLSearchParams,
    method?: string,
  ) {
    let body: URLSearchParams;
    if (payload instanceof URLSearchParams) {
      body = payload;
    } else {
      body = new URLSearchParams();
      // filter out "undefined" literals from constructed urlencoded payload
      for (let [key, value] of Object.entries(payload)) {
        if (value !== undefined) {
          body.append(key, String(value));
        }
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
      `${CONFIG.urls().core}/auth/keycloakopenid_admin`,
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
      "api_v1_profile[merchant_settlement_info_attributes][account_number]":
        "stheseh",
      "api_v1_profile[merchant_settlement_info_attributes][account_name]":
        "shshesh",
      "api_v1_profile[merchant_settlement_info_attributes][beneficiary_name]":
        "nhsensh",
      "api_v1_profile[merchant_settlement_info_attributes][beneficiary_address]":
        "ntshesnhesnth",
      "api_v1_profile[merchant_settlement_info_attributes][swift_code]":
        "sthesnthesnh",
      "api_v1_profile[merchant_settlement_info_attributes][bank_name]":
        "tnshesh",
      "api_v1_profile[merchant_settlement_info_attributes][bank_address]":
        "hesthesh",
      "api_v1_profile[merchant_settlement_info_attributes][country]": "shesnth",
      "api_v1_profile[merchant_settlement_info_attributes][iban]": "shesth",
    };

    await this.action("/merchants", form);
  }

  async create_random_merchant(opts?: CreateMerchantOptions) {
    let uuid = randomUUID();
    let params: CreateMerchant = {
      companyName: uuid,
      email: opts?.email ?? `${uuid}@mail.com`,
      password: common.password,
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
      "trader[payout_hold_period]": params.payout_hold_priod,
      "trader[required_deposit]": params.min_deposit,
      white_list: "",
      // Omit rather than send "": `Trader::Common#limit_saving` guards on
      // `params.key?`, so an empty value writes a 0 limit instead of none.
      min_limit: params.min_limit?.toString(),
      max_limit: params.max_limit?.toString(),
      convert_to_usdt: params.convert_to_usdt ? "1" : undefined,
      commit: "Add+new+trader",
    };

    await this.action("/traders", form);
  }

  async create_random_trader(opts?: CreateTraderOptions) {
    let uuid = randomUUID();
    let params: CreateTrader = {
      companyName: uuid,
      email: opts?.email ?? `${uuid}@mail.com`,
      password: common.password,
      convert_to_usdt: opts?.usdt ?? true,
      payout_hold_priod: opts?.payout_hold_period ?? 0,
      telegram: uuid,
      currency: opts?.currency ?? "RUB",
      min_deposit: CONFIG.in_project(["reactivepay"])
        ? undefined
        : (opts?.min_deposit ?? 0),
      min_limit: opts?.min_limit,
      max_limit: opts?.max_limit,
    };
    await this.create_trader(params);
    return params;
  }

  async create_agent(params: CreateAgent) {
    let body = new URLSearchParams({
      utf8: "✓",
      "agent[company_name]": params.company_name,
      "agent[email]": params.email,
      "agent[temp_password]": params.temp_password,
    });
    for (let id of params.trader_ids) {
      body.append("agent[traders][]", id.toString());
    }
    if (params.merchant_id !== undefined) {
      body.append("agent[merchants]", params.merchant_id.toString());
    }
    await this.action("/agents", body);
  }

  async create_random_agent(opts?: CreateAgentOptions) {
    let uuid = randomUUID();
    let params: CreateAgent = {
      company_name: uuid,
      email: opts?.email ?? `${uuid}@mail.com`,
      temp_password: common.password,
      merchant_id: opts?.merchant_id,
      trader_ids: opts?.traders_ids ?? [],
    };
    await this.create_agent(params);
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
    // No white_list/min_limit/max_limit: `Trader::Update` runs the same
    // `create_limits` as create, and an empty value would zero the trader's
    // existing limits.
    let data = {
      utf8: "✓",
      _method: "patch",
      "bank_ids[]": bank_list,
      commit: "Save",
    };
    await this.action(`/traders/${trader_id}`, data);
  }

  async add_bank({
    system_name,
    ru,
    en,
  }: {
    system_name: string;
    ru: string;
    en: string;
  }) {
    let data = {
      utf8: "✓",
      "bank[names][en]": en,
      "bank[names][ru]": ru,
      "bank[system_name]": system_name,
      commit: "Add a new bank",
    };
    let form_data = new FormData();
    for (let [key, value] of Object.entries(data)) {
      form_data.append(key, value);
    }
    await this.form_action(`/banks`, form_data);
  }

  async add_sms_parser({
    sms_type,
    sim,
    from_data,
    change_from_data_to,
    currency,
    pattern,
    payer_pattern,
    from_pattern,
    text_pattern,
    card_mask,
    bank_id,
  }: CreateSmsParser) {
    let data = {
      utf8: "✓",
      "sms_parser[sms_type]": sms_type,
      "sms_parser[sim]": sim,
      "sms_parser[from_data]": from_data,
      "sms_parser[change_from_data_to]": change_from_data_to ?? "",
      "sms_parser[currency]": currency,
      "sms_parser[pattern]": pattern,
      "sms_parser[text_pattern]": text_pattern,
      "sms_parser[from_pattern]": from_pattern,
      "sms_parser[payer_pattern]": payer_pattern ?? "",
      "sms_parser[card_mask]": card_mask ?? "",
      "sms_parser[bank_id]": bank_id,
      commit: "Create+a+new+sms+parser",
    };
    await this.action("/sms_parsers", data);
  }

  async cashin(
    mid: number,
    currency: string,
    amount: number,
    to_account_id?: number,
  ) {
    let now = new Date();
    let params = {
      utf8: "",
      authenticity_token: "TODO",
      profile_id: mid,
      to_name: "",
      amount,
      to_account_id: to_account_id ? to_account_id.toString() : "",
      "payment_request[currency]": currency,
      date: DateFormatter.format(now),
      time: TimeFormatter.format(now),
      description: "",
      commit: "Create",
    };
    await this.action("/transfers?direction=in", params);
  }

  async cashout(
    mid: number,
    currency: string,
    amount: number,
    bank_account_id?: number,
  ) {
    let now = new Date();
    let form = new FormData();
    form.append("utf8", "✓");
    form.append("profile_id", mid);
    form.append("recipient_name", "");
    form.append("amount", amount);
    form.append("payment_request[currency]", currency);
    form.append("date", DateFormatter.format(now));
    form.append("time", TimeFormatter.format(now));
    form.append("description", "");
    if (bank_account_id !== undefined) {
      form.append("from_account_id", bank_account_id);
    }

    // For the empty file attachment
    const emptyBlob = new Blob([], { type: "application/octet-stream" });
    form.append("payment_request[attachments][]", emptyBlob, "");

    form.append("commit", "Создать");

    await this.form_action("/transfers?direction=out", form);
  }

  // TODO: status is not a CoreStatus, it should be string.
  async change_status(id: number, status: PrimeBusinessStatus) {
    let params = {
      utf8: "✓",
      id: id.toString(),
      target_status: status,
      declination_reason: "",
      commit: "Save",
    };

    let query = {
      action: "index",
      controller: "manage/cashouts",
      page: "1",
      per_page: "20",
      company_names: "",
      from_date: "",
      merchant_ids: "",
      status: "",
      to_date: "",
      type: "",
    };

    const queryParams = new URLSearchParams(query);

    await this.action(`/cashouts/change_status?${queryParams}`, params);
  }

  async approve_payout(id: number) {
    await this.action(`/transfers/${id}/approve_payout`, {});
  }

  async decline_payout(id: number) {
    await this.action(`/transfers/${id}/decline_payout`, {});
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

  async confirm_settlement(feed_id: number, status: "approved" | "declined") {
    let form = {
      _method: "put",
    };
    let suffix = status === "approved" ? "accepted" : "declined";
    await this.action(`/settlements/${feed_id}/${suffix}`, form);
  }
}
