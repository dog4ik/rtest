import type { ProviderInstance } from "@/mock_server/instance";
import type { P2PSuite } from ".";
import type { Context } from "@/test_context/context";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { PrimeBusinessStatus } from "@/db/business";
import { assert } from "vitest";

export class ProviderAdapter<G = unknown> {
  public provider: ProviderInstance;
  public merchant: ExtendedMerchant;
  private secret: string;

  private constructor(
    private ctx: Context,
    private suite: P2PSuite<G>,
    merchant: ExtendedMerchant,
    secret: string,
  ) {
    this.secret = secret;
    this.provider = ctx.mock_server(suite.mock_options(secret));
    this.merchant = merchant;
  }

  /** Create adapter: sets up mock server + merchant with correct settings */
  static async create<G>(
    ctx: Context,
    suite: P2PSuite<G>,
  ): Promise<ProviderAdapter<G>> {
    let secret = ctx.uuid;
    let merchant = await ctx.create_random_merchant();
    let adapter = new ProviderAdapter(ctx, suite, merchant, secret);
    await merchant.set_settings(suite.settings(secret));
    return adapter;
  }

  get gw(): G {
    return this.suite.gw;
  }

  get alias(): string {
    return this.suite.mock_options("").alias;
  }

  /** Queue the create handler for given status */
  queueCreate(status: PrimeBusinessStatus): Promise<unknown> {
    return this.provider.queue(
      this.suite.create_handler(status, {
        ctx: this.ctx,
        provider: this.provider,
      }),
    );
  }

  /** Queue the status handler */
  queueStatus(status: PrimeBusinessStatus): Promise<unknown> {
    return this.provider.queue(this.suite.status_handler(status));
  }

  /** Queue no-requisites handler (for routing/decline tests) */
  queueNoRequisites(): Promise<unknown> {
    return this.provider.queue(
      this.suite.no_requisites_handler(this.provider, this.secret),
    );
  }

  /** Send callback to the system */
  async sendCallback(status: PrimeBusinessStatus): Promise<unknown> {
    return this.suite.send_callback(status, this.secret);
  }

  queueApprovedNotification(): Promise<unknown> {
    return this.merchant.queue_notification((c) => {
      assert.strictEqual(c.status, "approved");
    });
  }

  queueDeclinedNotification(): Promise<unknown> {
    return this.merchant.queue_notification((c) => {
      assert.strictEqual(c.status, "declined");
    });
  }

  /** Create a payment or payout depending on suite type, handling cashin for payouts */
  async createTransaction() {
    if (this.suite.type === "payout") {
      let request = this.suite.request();
      await this.merchant.cashin(request.currency, request.amount / 100);
      return this.merchant.create_payout(request);
    }
    return this.merchant.create_payment(this.suite.request());
  }

  /** Create transaction and follow processingUrl if present */
  async createAndFollow() {
    let response = await this.createTransaction();
    if (Array.isArray(response.processingUrl)) {
      return {
        create_response: response,
        processing_response: await response.followFirstProcessingUrl(),
      };
    }
    return { create_response: response };
  }
}
