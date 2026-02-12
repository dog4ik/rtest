import type { Context } from "@/test_context/context";
import { assert } from "vitest";
import { z } from "zod";
import { ErrorResponse } from "./error_response";
import { PROJECT } from "@/config";

const DisputeResponseSchema = z.object({
  success: z.literal(true),
  result: z.literal(0),
  status: PROJECT == "8pay" ? z.literal("declined") : z.literal(200),
});

export class DisputeResponse {
  constructor(
    ctx: Context,
    private res: Response,
    private json: any,
  ) {
    ctx.story.add_chapter("Merchant dispute response", json);
    console.log("Dispute response", json);
  }
  as_ok() {
    assert.strictEqual(
      this.res.status,
      200,
      "success dispute response should have 200 status",
    );
    let parsed = DisputeResponseSchema.safeParse(this.json);
    if (!parsed.success) {
      assert.fail(
        `Failed to prase merchant dispute response: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  as_error() {
    return new ErrorResponse(this.res, this.json);
  }
}
