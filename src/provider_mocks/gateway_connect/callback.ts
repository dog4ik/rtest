import * as jose from "jose";
import crypto from "node:crypto";

type SecureBlock = {
  encrypted_data: string;
  iv_value: string;
};

type JwtPayload = {
  [key: string]: any;
  secure: SecureBlock;
};

function generateIV(): Buffer {
  return crypto.randomBytes(16);
}

function encryptMerchantKey(
  merchantKey: string,
  signKey: Buffer, // 32 bytes
  iv: Buffer,
): { encryptedData: string; ivBase64: string } {
  let cipher = crypto.createCipheriv("aes-256-cbc", signKey, iv);

  let encrypted = cipher.update(merchantKey, "utf8", "base64");
  encrypted += cipher.final("base64");

  return {
    encryptedData: encrypted,
    ivBase64: iv.toString("base64"),
  };
}

export async function createJwt(
  payload: Record<string, any>,
  merchantKey: string,
  signKey: Buffer,
) {
  let iv = generateIV();

  let { encryptedData, ivBase64 } = encryptMerchantKey(
    merchantKey,
    signKey,
    iv,
  );

  let jwtPayload: JwtPayload = {
    ...payload,
    secure: {
      encrypted_data: encryptedData,
      iv_value: ivBase64,
    },
  };

  return await new jose.SignJWT(jwtPayload)
    .setProtectedHeader({
      alg: "HS512",
      typ: "JWT",
    })
    .sign(signKey);
}
