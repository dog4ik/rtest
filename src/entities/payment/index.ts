import { z } from "zod";
import { assert } from "vitest";
import * as common from "@/common";
import type { Context } from "@/test_context/context";

export const EightpayRequesiteSchema = z.object({
  id: z.string().min(1),
  pan: z.string().min(1),
  name_seller: z.string(),
  support_banks: z.array(z.string()).min(1),
  support_bank_native: z.record(z.string(), z.string()),
});

export class ProcessingUrlResponse {
  constructor(
    private ctx: Context,
    private response: Response,
  ) {}

  async as_8pay_requisite(options?: { skip_validations?: boolean }) {
    assert.strictEqual(this.response.status, 200, "success status");
    let json = await this.response.json();
    console.log(json);
    let response = EightpayRequesiteSchema.safeParse(json);

    if (!options?.skip_validations) {
      assert(
        response.success,
        `parse 8pay h2h p2p requisites: ${response.error?.message}`,
      );
      assert(
        response.data.pan === common.visaCard ||
          response.data.pan === common.phoneNumber ||
          response.data.pan === "+" + common.phoneNumber,
      );
    }
    return response.data;
  }

  async as_raw_json() {
    return await this.response.json();
  }
}
