import { z } from "zod";

export const RefundRequestSchema = (settingsSchema: z.ZodType) => {
  return z.object({
    settings: settingsSchema,
    payment: z.object({
      gateway_token: z.uuid(),
      token: z.string().min(1),
      currency: z.string().length(3),
    }),
    refund: z.object({
      amount: z.number().int().nonnegative(),
      token: z.string().min(1),
    }),

    method_name: z.literal("refund"),
  });
};
