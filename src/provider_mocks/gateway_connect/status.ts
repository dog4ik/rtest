import { z } from "zod";
import { type InteractionLog } from "./interaction_logs";
import type { PrimeBusinessStatus } from "@/db/business";

export const StatusPaymentSchema = z.object({
  gateway_token: z.string(),
  token: z.string(),
});

export const StatusRefundSchema = z.object({
  token: z.string(),
  amount: z.number(),
  gateway_amount: z.number(),
});

export const StatusRequestSchema = (settingsSchema: z.ZodType) => {
  return z.object({
    payment: StatusPaymentSchema,
    refund: StatusRefundSchema.nullish(),
    settings: settingsSchema,
  });
};

export type StatusRequest = z.infer<typeof StatusRequestSchema>;

export type ConnectStatusResponse = {
  result: boolean;
  logs: InteractionLog[];
  status: PrimeBusinessStatus;
  details: string;
  amount: number;
  currency: string;
};
