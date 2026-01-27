import { BusinessStatusSchema } from "@/db/business";
import type { Context } from "@/test_context/context";
import { assert } from "vitest";
import { z } from "zod";

const NestedRefundSchema = z.object({
  token: z.string().length(32),
  amount: z.int().min(1),
  status: BusinessStatusSchema,
  currency: z.string().length(3),
});

const RefundResponseSchema = z.object({
  success: z.literal(true),
  result: z.literal(0),
  status: z.literal(200),
  token: z.string().length(32),
  refund: NestedRefundSchema,
});

export class RefundResponse {
  constructor(
    ctx: Context,
    private res: Response,
    private json: any,
  ) {
    ctx.story.add_chapter("Merchant refund response", json);
    console.log("Refund response", json);
  }
  as_ok() {
    assert.strictEqual(
      this.res.status,
      200,
      "success refund response should have 200 status",
    );
    let parsed = RefundResponseSchema.safeParse(this.json);
    if (!parsed.success) {
      assert.fail(
        `Failed to prase merchant refund response: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }
}
