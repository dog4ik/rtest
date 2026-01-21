import crypto from "crypto";

type Params = {
  body: string;
  url: string;
  method: string;
};

export function calculateSignature(
  { body, url, method }: Params,
  secret: string,
): string {
  let requestContentBase64String = crypto
    .createHash("md5")
    .update(body)
    .digest("base64");

  let signatureRawData =
    method.toUpperCase() +
    encodeURIComponent(url).toLowerCase() +
    requestContentBase64String;

  let hmac = crypto
    .createHmac("sha256", Buffer.from(secret, "base64"))
    .update(signatureRawData)
    .digest();

  return hmac.toString("base64");
}
