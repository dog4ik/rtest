import crypto from "node:crypto";
import { BusinessStatusSchema } from "@/db/business";
import * as vitest from "vitest";
import { z } from "zod";

export const NOTIFICATION_SCHEMA = z.object({
  token: z.string(),
  type: z.string(),
  status: BusinessStatusSchema,
  extraReturnParam: z.string(),
  orderNumber: z.string().optional(),
  walletDisplayName: z.string(),
  amount: z.int(),
  currency: z.string(),
  gatewayAmount: z.int(),
  gatewayCurrency: z.string(),
  cardHolder: z.string().nullable(),
  gatewayDetails: z
    .object({
      merchant: z.object({ ip: z.string() }),
      filtered_traders: z.array(z.number()).nullish(),
      pending_url_request: z.any(),
      decline_reason: z.string().optional(),
    })
    .optional(),
  sanitizedMask: z.string().optional().nullable(),
  walletToken: z.string(),
  signature: z.string(),
});

export type Notification = ReturnType<typeof extendNotification>;

export function extendNotification(
  notification: z.infer<typeof NOTIFICATION_SCHEMA>,
) {
  function verifySignature(private_key: string) {
    let sig = "";
    let add_s = (v: string) => {
      sig += v.length.toString() + v;
    };
    add_s(notification.token);
    add_s(notification.type);
    add_s(notification.status);
    if (notification.extraReturnParam) {
      add_s(notification.extraReturnParam);
    }
    if (notification.orderNumber) {
      add_s(notification.orderNumber);
    }
    add_s(notification.amount.toString());
    add_s(notification.currency);
    add_s(notification.gatewayAmount.toString());
    add_s(notification.gatewayCurrency);
    sig += private_key;
    let digestedSignature = crypto.createHash("md5").update(sig).digest("hex");

    vitest.assert.strictEqual(
      digestedSignature,
      notification.signature,
      "Notification signature should match",
    );
  }

  return {
    ...notification,
    verifySignature,
  };
}
