import * as encoding from "@std/encoding";
import { authorize_client, get_redirect_location, type Credentials } from "..";
import { err_bad_status } from "@/fetch_utils";
import { PROJECT } from "@/config";

export type CreateRuleFormData = typeof INITIALIZED_RULE;

const INITIALIZED_RULE = {
  operation: "",
  comment: "",
  currency: "",
  source: "",
  to_profile: "",
  status: "",
  trader_id: "",
  agent_id: "",
  extra_return_param: "",
  self_rate: "",
  self_fee: "",
  self_min: "",
  self_max: "",
  provider_rate: "",
  provider_fee: "",
  provider_min: "",
  provider_max: "",
  agent_rate: "",
  agent_fee: "",
  agent_min: "",
  agent_max: "",
};

export class FlexyCommission {
  base_url: string;
  cookies: string | null;
  constructor(
    base_url = "http://127.0.0.1:7082",
    private credentials: Credentials,
  ) {
    this.base_url = base_url;
    this.cookies = null;
  }

  async keycloak_login(credentials: Credentials) {
    this.cookies = await authorize_client(
      credentials,
      await get_redirect_location("http://localhost:7082"),
    );
    console.log({ cookies: this.cookies });
  }

  async login(credentials: Credentials) {
    if (PROJECT === "a2") {
      return await this.keycloak_login(credentials);
    }
  }

  private async action(path: string, payload: {}) {
    console.log("Flexy commission payload", payload);
    let body = new URLSearchParams();

    // filter out "undefined" literals from constructed urlencoded payload
    for (let [key, value] of Object.entries(payload)) {
      if (value !== undefined) {
        body.append(key, String(value));
      }
    }

    let auth_string = `${this.credentials.login}:${this.credentials.password}`;
    let res = await fetch(this.base_url + path, {
      method: "POST",
      redirect: "manual",
      body,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${encoding.encodeBase64(auth_string)}`,
        cookie: this.cookies ?? "",
      },
    }).then(err_bad_status);
    let cookie = res.headers.get("set-cookie");
    if (cookie !== null) {
      this.cookies = cookie;
    }
  }

  async add(data: Partial<CreateRuleFormData>) {
    await this.action("/rules", { ...INITIALIZED_RULE, ...data });
  }

  async remove(hash: string) {
    await this.action("/update", {
      hash,
      action: "remove",
    });
  }

  async update(hash: string, data: Partial<CreateRuleFormData>) {
    await this.action(`/rules/update/${hash}`, {
      ...INITIALIZED_RULE,
      ...data,
    });
  }
}
