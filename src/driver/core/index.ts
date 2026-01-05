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

export class CoreDriver {
  cookies: string | null;
  base_url: string;
  constructor(base_url: string) {
    this.cookies = "";
    this.base_url = base_url + "/manage";
  }

  private async action(path: string, payload: {}) {
    let body = new URLSearchParams();

    // filter out "undefined" literals from constructed urlencoded payload
    for (let [key, value] of Object.entries(payload)) {
      if (value !== undefined) {
        body.append(key, String(value));
      }
    }
    let res = await fetch(this.base_url + path, {
      method: "POST",
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
    console.log(res.status, res.headers.get("set-cookie"));
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
    let params = {
      companyName: uuid,
      email: `${uuid}@mail.com`,
      password: "c@\"6J?Q3:?H@me=",
      country: "236",
    };
    await this.create_merchant(params);
    return params;
  }

  async cashin(mid: number, currency: string, amount: number) {
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
    console.log("date", dateFormatter.format(now));
    console.log("time", timeFormatter.format(now));

    let params = {
      utf8: "",
      authenticity_token: "TODO",
      profile_id: mid,
      to_name: "",
      amount,
      to_account_id: "",
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

  async resent_callback(token: string) {
    let params = { api_payment_token: token };
    await this.action(`/cashouts/${token}/resend_callback`, params);
  }
}
