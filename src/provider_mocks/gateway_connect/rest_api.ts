import { err_bad_status } from "@/fetch_utils";
import * as encoding from "@std/encoding";
import { CONFIG } from "@/config";
export async function update_gateway(settings: Record<string, any>) {
  let basic_auth = encoding.encodeBase64(`admin:admin`);
  await fetch(`${CONFIG.urls().business}/api/v1/gateway_settings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // FIX: uncomment after fix
      // authorization: `Basic ${basic_auth}`,
      authorization: "Bearer 0a58c0b74ae86bafa90f",
    },
    body: JSON.stringify(settings),
  }).then(err_bad_status);
}
