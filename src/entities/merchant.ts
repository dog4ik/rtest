import * as vitest from "vitest";
import { z } from "zod";
import type { Merchant } from "@/db/core";
import { err_bad_status, parse_json } from "@/fetch_utils";
import { BusinessStatusSchema } from "@/db/business";
import tracing from "@/tracing";
import {
  extendNotification,
  NOTIFICATION_SCHEMA,
  type Notification,
} from "./merchant_notification";
import type { HttpContext } from "@/mock_server/api";
import type { CreateRuleFormData } from "@/driver/flexy_commission";
import { basic_healthcheck } from "@/healthcheck";
import type { PaymentRequest, PayoutRequest } from "@/common";
import type { Context } from "@/test_context/context";
import { constructCurlRequest } from "@/story/curl";

type MerchantRequest = Record<string, any> & {
  callbackUrl?: string;
};

export type NotificationHandler = (
  notification: Notification,
  req: HttpContext,
) =>
  | Response
  | Promise<Response>
  | undefined
  | Promise<undefined>
  | void
  | Promise<void>;

export function extendMerchant(ctx: Context, merchant: Merchant) {
  let {
    core_db,
    settings_db,
    business_db,
    core_harness,
    settings_service,
    business_url,
    mock_servers,
    commission_service,
  } = ctx.shared_state();
  async function wallets() {
    return core_db.profileWallets(merchant.id);
  }

  async function cashin(currency: string, amount: number) {
    return core_harness.cashin(merchant.id, currency, amount);
  }

  async function set_settings(settings: Record<string, any>) {
    let current = await settings_db.merchant_settings(merchant.id);
    ctx.story.add_chapter("Set merchant settings", settings);
    await settings_service.edit(current.id, current.external_id, settings);
  }

  function callbackUrl() {
    return `http://host.docker.internal:6767/${merchant.id}`;
  }

  async function create_payment<T extends MerchantRequest = PaymentRequest>(
    request: T,
  ) {
    let nestedPayment = z.object({
      amount: z.int(),
      commission: z.int().optional(),
      currency: z.string(),
      gateway_amount: z.int(),
      status: BusinessStatusSchema,
      two_stage_mode: z.boolean(),
    });

    let paymentResponse = z.object({
      payment: nestedPayment,
      processingUrl: z.array(z.record(z.string(), z.url())).or(z.url()),
      result: z.int(),
      selectorUrl: z.url().optional(),
      status: z.int(),
      success: z.boolean(),
      token: z.string().length(32),
    });

    if (request["callbackUrl"] === undefined) {
      let url = callbackUrl();
      console.log("Overriding merchant callback url to", url);
      request["callbackUrl"] = url;
    }

    let url = business_url + "/api/v1/payments";
    tracing.debug({ body: request, url }, "Creating merchant payment");
    console.log({ body: request, url }, "Creating merchant payment");
    ctx.story.add_chapter(
      "Create payment",
      constructCurlRequest(request, merchant.merchant_private_key, "pay"),
    );
    let res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + merchant.merchant_private_key,
      },
      body: JSON.stringify(request),
    })
      .then(err_bad_status)
      .then(parse_json(paymentResponse));

    return {
      ...res,
      firstProcessingUrl() {
        if (!Array.isArray(this.processingUrl)) {
          return vitest.assert.fail("Processing url is not an array");
        } else if (this.processingUrl.length === 0) {
          return vitest.assert.fail("Processing url is empty");
        }
        let object = this.processingUrl[0];
        return Object.values(object)[0];
      },
      async followFirstProcessingUrl() {
        console.log("Fetching processing url");
        // TODO: add helper methods on fetch result
        return await fetch(this.firstProcessingUrl(), {
          method: "GET",
          redirect: "follow",
        }).then(err_bad_status);
      },
    };
  }

  async function create_payout<T extends MerchantRequest = PayoutRequest>(
    request: T,
  ) {
    let nestedPayout = z.object({
      token: z.string(),
      status: BusinessStatusSchema,
    });

    let payoutResponse = z.object({
      payout: nestedPayout.optional(),
      processingUrl: z
        .array(z.record(z.string(), z.url()))
        .or(z.url())
        .optional(),
      result: z.int(),
      selectorUrl: z.url().optional(),
      status: z.int(),
      success: z.boolean(),
      token: z.string().length(32),
    });

    if (request["callbackUrl"] === undefined) {
      let url = callbackUrl();
      console.log("Overriding merchant callback url to", url);
      request["callbackUrl"] = url;
    }

    let url = business_url + "/api/v1/payouts";
    tracing.debug({ body: request, url }, "Creating merchant payout");
    console.log({ body: request, url }, "Creating merchant payout");
    ctx.story.add_chapter(
      "Create payout",
      constructCurlRequest(request, merchant.merchant_private_key, "payout"),
    );
    let res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + merchant.merchant_private_key,
      },
      body: JSON.stringify(request),
    })
      .then(err_bad_status)
      .then(parse_json(payoutResponse));

    return {
      ...res,
      firstProcessingUrl() {
        if (!Array.isArray(this.processingUrl)) {
          return vitest.assert.fail("Processing url is not an array");
        } else if (this.processingUrl.length === 0) {
          return vitest.assert.fail("Processing url is empty");
        }
        let object = this.processingUrl[0];
        return Object.values(object)[0];
      },
      async followFirstProcessingUrl() {
        console.log("Fetching processing url");
        // TODO: add helper methods on fetch result
        return await fetch(this.firstProcessingUrl(), {
          method: "GET",
          redirect: "follow",
        }).then(err_bad_status);
      },
    };
  }

  type NotificationHandlerOptions = {
    skip_healthcheck?: boolean;
    skip_signature_check?: boolean;
  };
  /**
   * Setup notification handler.
   * @returns {Promise<unknown>} that will be resolved when the handler is done.
   **/
  async function notification_handler(
    handler: NotificationHandler,
    options?: NotificationHandlerOptions,
  ): Promise<unknown> {
    let { promise, resolve, reject } = Promise.withResolvers();
    mock_servers.registerMerchant(merchant.id, async (c) => {
      try {
        let callback = extendNotification(
          NOTIFICATION_SCHEMA.parse(await c.req.json()),
        );
        if (!options?.skip_signature_check) {
          callback.verifySignature(merchant.merchant_private_key);
        }
        if (!options?.skip_healthcheck) {
          (
            await basic_healthcheck({ business_db, core_db }, callback.token)
          ).assert();
        }
        let res = await handler(callback, c);
        resolve(undefined);
        return res || c.json({ message: "OK (fallback response)" });
      } catch (error) {
        reject(error);
        return c.json({ message: "Notification handler error", error });
      }
    });
    return promise;
  }

  async function set_commission(rule?: Partial<CreateRuleFormData>) {
    let payload = {
      to_profile: merchant.id.toString(),
      comment: `Test commission rule`,
      self_rate: "10",
      provider_rate: "5",
      status: "1",
      ...rule,
    };
    ctx.story.add_chapter("Set commission rule", payload);
    await commission_service.add(payload);
  }

  return {
    ...merchant,
    wallets,
    cashin,
    set_settings,
    create_payment,
    create_payout,
    notification_handler,
    callbackUrl,
    set_commission,
  };
}
