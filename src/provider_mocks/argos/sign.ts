import * as crypto from "crypto";

type Input = Record<string, any>;

/**
 * Creates a signature by:
 * 1. Encrypting input with AES-128-ECB (PKCS7 padding)
 * 2. Hashing the encrypted bytes with SHA-256
 * 3. Encoding the result as Base64
 */
export function createSignature(data: string, key: string): string {
  const keyBuffer = Buffer.from(key);

  // AES-128-ECB encryption with PKCS7 padding
  const cipher = crypto.createCipheriv("aes-128-ecb", keyBuffer, null);
  cipher.setAutoPadding(true); // Node.js uses PKCS5/PKCS7 padding by default

  const encrypted = Buffer.concat([
    cipher.update(data, "utf-8"),
    cipher.final(),
  ]);

  // SHA-256 hash of the encrypted bytes
  const hash = crypto.createHash("sha256").update(encrypted).digest();

  // Base64 encode the hash
  return hash.toString("base64");
}

export function buildSignatureInput(fields: Input): string {
  return [
    fields.responseTime,
    fields.txId,
    fields.txTypeId,
    fields.recurrentTypeId,
    fields.requestId,
    fields.orderId,
    fields.sourceAmount?.amount,
    fields.sourceAmount?.currencyCode,
    fields.amount?.amount,
    fields.amount?.currencyCode,
    fields.result?.resultCode,
    fields.result?.reasonCode,
    fields.ccNumber,
    fields.cardId,
    fields.destCCNumber,
  ]
    .filter((v) => v !== undefined && v !== null)
    .join("");
}

/**
 * Verifies a signature against the expected value.
 */
// export function verifySignature(
//   data: Input,
//   key: string,
//   expectedSignature: string,
// ): boolean {
//   const computed = createSignature(data, key);
//   return computed === expectedSignature;
// }

export function decryptAES128(text: string, key: string): string {
  const keyBuffer = Buffer.from(key);
  const encryptedBuffer = Buffer.from(text, "base64");

  const decipher = crypto.createDecipheriv("aes-128-ecb", keyBuffer, null);
  decipher.setAutoPadding(true); // matches cipher.padding = 1 (PKCS7)

  const decrypted = Buffer.concat([
    decipher.update(encryptedBuffer),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}
