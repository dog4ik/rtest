import * as encoding from "@std/encoding";
import { authorize_client, get_redirect_location, type Credentials } from "..";
import { err_bad_status } from "@/fetch_utils";
import { PROJECT } from "@/config";

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

  async login() {
    if (PROJECT === "a2") {
      this.cookies = await authorize_client(
        this.credentials,
        await get_redirect_location(
          "http://localhost:6001/settings/managers/auth/keycloakopenid",
        ),
      );
    }
  }

  private async action(path: string, payload: {}) {
    let form = new FormData();
    for (let [k, v] of Object.entries(payload)) {
      form.append(k, v);
    }
    let auth_string = `${this.credentials.login}:${this.credentials.password}`;
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
    if (cookie !== null) {
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
  }
}
