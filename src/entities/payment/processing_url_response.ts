import { z } from "zod";
import { assert } from "vitest";
import { ErrorResponse } from "./error_response";
import type { Context } from "@/test_context/context";
import { CONFIG } from "@/test_context";

export const EightpayRequesiteSchema = z.object({
  id: z.string().min(1),
  pan: z.string().min(1),
  name_seller: z.string(),
  support_banks: z.array(z.string()).min(1),
  support_bank_native: z.record(z.string(), z.string()),
});

export const TraderRequisiteSchema = z.object({
  success: z.literal(true),
  result: z.literal(0),
  status: z.literal(200),
  token: z.string().length(32),
  processingUrl: z.url(),
  payment: z.object({
    amount: z.number(),
    currency: z.string(),
    gateway_amount: z.number(),
    gateway_currency: z.string(),
    status: z.literal("pending"),
  }),
  card: z
    .object({
      name: z.string(),
      bank: z.string(),
      pan: z.string(),
    })
    .optional(),
  sbp: z
    .object({
      name: z.string(),
      bank: z.string(),
      phone: z.string(),
    })
    .optional(),
});

export class ProcessingUrlResponse {
  constructor(
    private ctx: Context,
    private response: Response,
  ) {}

  private async consume_json_body() {
    let json = await this.response.json();
    console.log("Processing url", json);
    this.ctx.story.add_chapter(
      "ProcessingUrl json",
      json as Record<string, any>,
    );
    return json;
  }

  async as_8pay_requisite() {
    let json = await this.consume_json_body();
    assert.strictEqual(this.response.status, 200, "success status");
    let response = EightpayRequesiteSchema.safeParse(json);

    assert(
      response.success,
      `parse 8pay h2h p2p requisites: ${response.error?.message}`,
    );
    return response.data;
  }

  async as_trader_requisites() {
    let json = await this.consume_json_body();
    assert.strictEqual(this.response.status, 200, "success status");
    let response = TraderRequisiteSchema.safeParse(json);

    assert(
      response.success,
      `parse h2h p2p trader requisites: ${response.error?.message}`,
    );
    return response.data;
  }

  async validateRequisites({
    type,
    number,
    name,
    bank,
  }: {
    type: "sbp" | "card";
    number: string | undefined;
    name: string | undefined;
    bank: string | undefined;
  }) {
    if (CONFIG.project === "8pay") {
      let res = await this.as_8pay_requisite();
      assert.strictEqual(res.name_seller, name);
      assert.strictEqual(res.pan, number);
    } else {
      let res = await this.as_trader_requisites();
      if (type === "sbp") {
        assert.strictEqual(res.sbp?.bank, bank);
        assert.strictEqual(res.sbp?.name, name);
        assert.strictEqual(res.sbp?.phone, number);
      } else if (type === "card") {
        assert.strictEqual(res.card?.bank, bank);
        assert.strictEqual(res.card?.name, name);
        assert.strictEqual(res.card?.pan, number);
      }
    }
  }

  async as_error() {
    let json = await this.consume_json_body();
    assert.strictEqual(this.response.status, 403, "error status");
    return new ErrorResponse(this.response, json).as_common_error();
  }

  async as_raw_json() {
    return await this.consume_json_body();
  }
}
