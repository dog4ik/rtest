import crypto from "node:crypto";

export function calculateSignature(
  data: Record<string, {}>,
  secretKey: string,
  currentParamPrefix: string = "",
  depth: number = 16,
  currentRecursionLevel: number = 0,
): string {
  if (currentRecursionLevel >= depth) {
    throw new Error("Recursion level exceeded");
  }

  let stringForSignature = "";

  for (let [key, value] of Object.entries(data)) {
    if (Array.isArray(value) || typeof value === "object") {
      stringForSignature += calculateSignature(
        value as Record<string, any>,
        secretKey,
        `${currentParamPrefix}${key}.`,
        depth,
        currentRecursionLevel + 1,
      );
    } else if (key !== "signature") {
      stringForSignature += `${currentParamPrefix}${key}${value}`;
    }
  }

  if (currentRecursionLevel === 0) {
    return crypto
      .createHmac("sha512", secretKey)
      .update(stringForSignature)
      .digest("hex")
      .toLowerCase();
  } else {
    return stringForSignature;
  }
}
