import crypto from "node:crypto";

export function settings(api_key?: string) {
  return {
    class: "millenniumpay",
    merchant_id: "30",
    bank_list: {
      sber: "100000000111",
      default: "100000000008",
    },
    secret_key: api_key,
    skip_card_payout_validation: true,
    wrapped_to_json_response: true,
  };
}


export function callbackSignature(
  params: Record<string, any>,
  secret: string,
): string {
  let keys = Object.keys(params).sort();
  let payload = "";

  for (let key of keys) {
    payload += `${params[key]}{ml}`;
  }

  payload += crypto.createHash("sha256").update(secret).digest("hex");
  return crypto.createHash("sha256").update(payload).digest("hex");
}
