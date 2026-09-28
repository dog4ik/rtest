import * as encoding from "@std/encoding";
import z from "zod";
import { err_bad_status } from "@/fetch_utils";
import type { Project } from "@/project";
import { authorize_client, type Credentials } from "..";

const ASSET_SCHEMA = z.object({
  id: z.number(),
  name: z.string(),
  // ActiveStorage blob key of the attached file.
  file_path: z.string(),
});

export type Asset = z.infer<typeof ASSET_SCHEMA>;

export class SettingsDriver {
  private base_url: string;
  private cookies: string | null;
  constructor(
    private settings_url: string,
    private credentials: Credentials,
    private project: Project,
  ) {
    this.base_url = `${settings_url}/settings/admin`;
    this.cookies = "";
  }

  async login() {
    if (this.project === "a2") {
      this.cookies = await authorize_client(
        this.credentials,
        `${this.settings_url}/settings/managers/auth/keycloakopenid`,
      );
    }
  }

  private headers() {
    let auth_string = `${this.credentials.login}:${this.credentials.password}`;
    return {
      authorization: `Basic ${encoding.encodeBase64(auth_string)}`,
      cookie: this.cookies ?? "",
    };
  }

  private async action(path: string, payload: {}) {
    let form = new FormData();
    for (let [k, v] of Object.entries(payload)) {
      form.append(k, v);
    }
    let res = await fetch(this.base_url + path, {
      method: "POST",
      body: form,
      redirect: "manual",
      headers: this.headers(),
    }).then(err_bad_status);
    let cookie = res.headers.get("set-cookie");
    if (cookie !== null) {
      this.cookies = cookie;
    }
  }

  async edit(user_id: number, external_id: number, settings: {}) {
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

  /** List all assets. The JSON export is the only way to get the blob keys. */
  async assets(): Promise<Asset[]> {
    let params = new URLSearchParams({ json: "1" });
    for (let field of ["id", "name"]) {
      params.append("schema[only][]", field);
    }
    params.append("schema[methods][]", "file_path");
    let res = await fetch(`${this.base_url}/asset/export?${params}`, {
      method: "POST",
      redirect: "manual",
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(
        `Failed to list settings assets: ${res.status} ${res.statusText}`,
      );
    }
    return z.array(ASSET_SCHEMA).parse(await res.json());
  }

  async asset(name: string): Promise<Asset | undefined> {
    return (await this.assets()).find((asset) => asset.name === name);
  }

  async add_asset(name: string, file: Blob, filename: string): Promise<Asset> {
    let form = new FormData();
    form.append("asset[name]", name);
    form.append("asset[files]", file, filename);
    // Success redirects to the asset list, validation errors re-render the form.
    let res = await fetch(`${this.base_url}/asset/new`, {
      method: "POST",
      body: form,
      redirect: "manual",
      headers: this.headers(),
    });
    if (res.status !== 302) {
      throw new Error(
        `Failed to create settings asset ${name}: ${res.status} ${res.statusText}`,
      );
    }
    let asset = await this.asset(name);
    if (asset === undefined) {
      throw new Error(`Settings asset ${name} is missing after creation`);
    }
    return asset;
  }

  /** Return the asset named `name`, creating it from `file` if missing. */
  async upsert_asset(
    name: string,
    file: Blob,
    filename: string,
  ): Promise<{ asset: Asset; created: boolean }> {
    let existing = await this.asset(name);
    if (existing !== undefined) {
      return { asset: existing, created: false };
    }
    return { asset: await this.add_asset(name, file, filename), created: true };
  }
}
