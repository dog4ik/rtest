import { assert } from "vitest";
import { z } from "zod";
import type { Context } from "@/test_context/context";
import { ErrorResponse } from "./error_response";

const WalletBalanceSchema = z.object({
  available: z.int().nonnegative(),
  hold: z.int().nonnegative(),
  currency: z.string().min(3),
});

export const WalletBalanceResponseSchema = z.object({
  success: z.literal(true),
  result: z.literal(0),
  status: z.literal(200),
  wallet: WalletBalanceSchema,
});

export type WalletBalance = z.infer<typeof WalletBalanceResponseSchema>;

export class WalletBalanceResponse {
  constructor(
    ctx: Context,
    private res: Response,
    public json: any,
  ) {
    ctx.story.add_chapter("Merchant wallet balance response", json);
    console.log("Wallet balance response", json);
  }

  as_ok() {
    assert.strictEqual(
      this.res.status,
      200,
      "success response should have 200 status",
    );
    let parsed = WalletBalanceResponseSchema.safeParse(this.json);
    if (!parsed.success) {
      assert.fail(
        `Failed to prase merchant wallet balance response: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  as_error() {
    return new ErrorResponse(this.res, this.json);
  }
}
