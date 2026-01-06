import crypto from "node:crypto";

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
