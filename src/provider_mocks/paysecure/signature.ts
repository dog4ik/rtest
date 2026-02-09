import crypto from "node:crypto";

export function sign(
  { message }: { message: Record<string, any> },
  privateKey: string,
) {
  const signer = crypto.createSign("RSA-SHA256");
  let signString = [message.purchaseId, message.status, message.brand_id].join(
    "|",
  );

  signer.update(signString);
  signer.end();

  return signer.sign(privateKey).toString("base64");
}
