import * as encoding from "@std/encoding";
import { err_bad_status } from "@/fetch_utils";
import type { Credentials } from "..";

export class FlexyGuardHarness {
  base_url: string;
  constructor(
    base_url = "http://127.0.0.1:7081",
    private credentials: Credentials,
  ) {
    this.base_url = base_url;
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
      },
    }).then(err_bad_status);
  }

  async add_rule(payload: {}, comment = "Test comment", priority = 1) {
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
