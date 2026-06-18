import { z } from "zod";
import type { InteractionLog } from "./interaction_logs";
import type { PrimeBusinessStatus } from "@/db/business";

export const BankAccountSchema = z.object({
  requisite_type: z.string(),
  bank_name: z.string().nullable().optional(),
  account_number: z.string().nullable().optional(),
});

export const CustomerSchema = z.object({
  ip: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  email: z.string(),
  phone: z.string().nullish(),
  birthday: z.string().nullish(),
  address: z.string().nullish(),
  postcode: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
});

export const ParamsSchema = z.object({
  customer: CustomerSchema.nullish(),
  cvv: z.string().nullish(),
  expires: z.string().nullish(),
  pan: z
    .string()
    .transform((val) => val.replace(/-/g, ""))
    .nullish(),
  holder: z.string().nullish(),
  bank_account: BankAccountSchema.nullish(),
});

export const PaymentSchema = z.object({
  token: z.string(),
  merchant_private_key: z.string(),
  extra_return_param: z.string().nullish(),
  product: z.string(),
  lead_id: z.int(),
  order_number: z.string().nullish(),
  gateway_currency: z.string(),
  gateway_amount: z.int(),
});

export const PayinRequestSchema = (settingsSchema: z.ZodObject) => {
  return z.object({
    params: ParamsSchema,
    payment: PaymentSchema,
    processing_url: z.url(),
    charge_page_url: z.url(),
    callback_url: z.url(),
    callback_3ds_url: z.url().nullish(),
    settings: settingsSchema.extend({
      wrapped_to_json_response: z.boolean().nullish(),
    }),
  });
};

export type ConnectPayinRequest = z.infer<typeof PayinRequestSchema>;

export type RedirectRequest = {
  url: string;
  type: "post" | "get_with_processing" | "redirect_html" | "post_iframes" | "get";
  html?: string;
  params?: Record<string, any>;
  iframes?: {
    url: string;
    data: Record<string, any>;
  }[];
};

export type ConnectPayinResponse = {
  result: boolean;
  logs: InteractionLog[];
  status: PrimeBusinessStatus;
  details?: string;
  gateway_token?: string;
  card_enrolled?: boolean;
  redirect_request?: RedirectRequest;
  amount: number;
  currency: string;
};
