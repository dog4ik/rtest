import type { ProviderInstance } from "@/mock_server/instance";
import type { P2PSuite } from ".";
import type { Context } from "@/test_context/context";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { PrimeBusinessStatus } from "@/db/business";
import { assert } from "vitest";
import type { Notification } from "@/entities/merchant_notification";
import type { HttpContext } from "@/mock_server/api";

export class ProviderAdapter<G = unknown> {
  public provider: ProviderInstance;
  public merchant: ExtendedMerchant;
  private secret: string;
  public alias: string;

  private constructor(
    private ctx: Context,
    private suite: P2PSuite<G>,
    merchant: ExtendedMerchant,
    secret?: string,
  ) {
    this.secret = secret ?? ctx.uuid;
    let mock_options = suite.mock_options(this.secret);
    this.alias = mock_options.alias;
    this.provider = ctx.mock_server(mock_options);
    this.merchant = merchant;
  }

  /** Create adapter: sets up mock server + merchant with settings */
  static async create<G>(
    ctx: Context,
    suite: P2PSuite<G>,
    secret?: string,
  ): Promise<ProviderAdapter<G>> {
    let merchant = await ctx.create_random_merchant();
    let adapter = new ProviderAdapter(ctx, suite, merchant, secret);
    await merchant.set_settings(suite.settings(adapter.secret));
    return adapter;
  }

  get gw(): G {
    return this.suite.gw;
  }

  /** Queue the create handler for given status */
  queue_create(status: PrimeBusinessStatus): Promise<unknown> {
    return this.provider.queue(
      this.suite.create_handler(status, {
        ctx: this.ctx,
        provider: this.provider,
      }),
    );
  }

  /** Queue the status handler */
  queue_status(status: PrimeBusinessStatus): Promise<unknown> {
    return this.provider.queue(this.suite.status_handler(status));
  }

  /** Send callback to the system */
  async send_callback(status: PrimeBusinessStatus): Promise<unknown> {
    return this.suite.send_callback(status, this.secret);
  }

  queue_merchant_notification(
    status: PrimeBusinessStatus,
    type?: string,
    check?: (notifiaction: Notification, c: HttpContext) => void,
  ): Promise<unknown> {
    return this.merchant.queue_notification((n, c) => {
      assert.strictEqual(n.status, status, "merchant notification status");
      if (type !== undefined) {
        assert.strictEqual(n.type, type, "merchant notification type");
      }
      if (check !== undefined) {
        check(n, c);
      }
    });
  }

  /** Create a payment or payout depending on suite type, handling cashin for payouts */
  async create_transaction(skip_payout_cashin?: boolean) {
    if (this.suite.type === "payout") {
      let request = this.suite.request();
      if (!skip_payout_cashin) {
        await this.merchant.cashin(request.currency, request.amount / 100);
      }
      return this.merchant.create_payout(request);
    }
    return this.merchant.create_payment(this.suite.request());
  }

  /** Create transaction and follow processingUrl if present */
  async create_and_follow() {
    let response = await this.create_transaction();
    if (Array.isArray(response.processingUrl)) {
      return {
        create_response: response,
        processing_response: await response.followFirstProcessingUrl(),
      };
    }
    return { create_response: response };
  }
}
