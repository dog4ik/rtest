import * as encoding from "@std/encoding";
import { authorize_client, type Credentials } from "..";
import { err_bad_status } from "@/fetch_utils";
import { CONFIG, PROJECT } from "@/config";

export class FlexyGuardHarness {
  base_url: string;
  cookies: string | null;
  constructor(
    base_url = "http://127.0.0.1:7081",
    private credentials: Credentials,
  ) {
    this.base_url = base_url;
    this.cookies = null;
  }

  async keycloak_login(credentials: Credentials) {
    this.cookies = await authorize_client(
      credentials,
      "http://localhost:7081/login",
    );
    console.log({ cookies: this.cookies });
  }

  async login(credentials: Credentials) {
    if (PROJECT === "a2") {
      return await this.keycloak_login(credentials);
    }
  }

  private async action(path: string, payload: {}) {
    let body = new URLSearchParams();

    // filter out "undefined" literals from constructed urlencoded payload
    for (let [key, value] of Object.entries(payload)) {
      if (value !== undefined) {
        body.append(key, String(value));
      }
    }

    let auth_string = `${this.credentials.login}:${this.credentials.password}`;
    await fetch(this.base_url + path, {
      method: "POST",
      redirect: "manual",
      body,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${encoding.encodeBase64(auth_string)}`,
        cookie: this.cookies ?? "",
      },
    }).then(err_bad_status);
  }

  async add_rule(
    payload: Record<string, any>,
    comment = "Test comment",
    priority = 1,
  ) {
    if (
      CONFIG.flexy_flexy &&
      payload.header?.mid &&
      typeof payload.header.mid === "string"
    ) {
      payload.header.mid = +payload.header.mid;
    }
    await this.action("/add", {
      comment,
      priority,
      rule_json: JSON.stringify(payload),
    });
  }

  async remove_rule(hash: string) {
    await this.action("/update", {
      hash,
      action: "remove",
    });
  }
}
