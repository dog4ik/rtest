import * as encoding from "@std/encoding";
import { type Credentials } from "..";
import { err_bad_status } from "@/fetch_utils";
import { delay } from "@std/async";

export class SettingsDriver {
  private base_url: string;
  private cookies: string | null;
  constructor(
    base_url: string,
    private credentials: Credentials,
  ) {
    this.base_url = base_url + "/settings/admin";
    this.cookies = "";
  }

  private async action(path: string, payload: {}) {
    let form = new FormData();
    for (let [k, v] of Object.entries(payload)) {
      form.append(k, v);
    }
    let auth_string = `${this.credentials.login}:${this.credentials.password}`;
    let url = this.base_url + path;
    console.log(
      "Dispatching settings action to url: ",
      url,
      payload,
      this.credentials,
      auth_string,
      encoding.encodeBase64(auth_string),
      form,
    );
    let res = await fetch(this.base_url + path, {
      method: "POST",
      body: form,
      redirect: "manual",
      headers: {
        authorization: `Basic ${encoding.encodeBase64(auth_string)}`,
        cookie: this.cookies ?? "",
      },
    }).then(err_bad_status);
    let cookie = res.headers.get("set-cookie");
    console.log(res.status, res.headers.get("set-cookie"));
    if (cookie !== null) {
      console.log("setting cookie to", cookie);
      this.cookies = cookie;
    }
  }

  async edit(user_id: number, external_id: number, settings: {}) {
    console.log(
      `Editing settings for user: ${user_id} (external_id: ${external_id}}`,
    );
    console.log(JSON.stringify(settings, null, 2));
    let path = `/user/${user_id}/edit`;

    let params = {
      utf8: "",
      _method: "put",
      "user[external_id]": external_id,
      "user[mcc_code]": "",
      "user[mcc_description]": "",
      "user[use_direct_pay]": "0",
      "user[direct_payment_state]": "0",
      "user[check_origin_domain]": "0",
      "user[is_unique_order_number]": "0",
      "user[split_cny_from_direct_traffic_percent]": "0",
      "user[show_last_charge_request]": "0",
      "user[settings]": JSON.stringify(settings),
      authenticity_token: encoding.encodeBase64("TODO"),
      "user[card_pass_through]": "1",
    };
    // Editing settings is async operation.
    await this.action(path, params);

    // Wait to settings to sync with business. Otherwise request will fail with error.
    // I have tried.
    // Polling redis sidekiq queue won't help since sidekiq removes the job before executing it.
    //
    // Elegant solution for the elegant problem.
    await delay(1000);
  }
}
