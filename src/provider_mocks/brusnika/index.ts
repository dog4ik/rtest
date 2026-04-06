import type { HttpRequest } from "@/mock_server/api";

export const WEBHOOK_TOKEN = "+MWRinGhkXlYEBtJCp2aC0xKylZBoNJsx+KV\/X07KDA=";

export type BrusnikaPaymentStatus =
  | "created"
  | "in_progress"
  | "success"
  | "failed";

export function success_response(data: Record<string, any>) {
  return {
    result: {
      status: "success",
      "x-request-id": crypto.randomUUID(),
      codeError: "none",
      codeErrorExt: "none",
      message: "",
    },
    data,
    totalNumberRecords: 0,
  };
}

export function brusnika_filter_fn(secret: string, req: HttpRequest): boolean {
  const auth = req.header("authorization");
  if (!auth) return false;
  const token = auth.replace(/^Bearer /, "");
  return token === secret;
}

export { BrusnikaPayment, payinSuite } from "./payin";
export { BrusnikaPayout, payoutSuite } from "./payout";
