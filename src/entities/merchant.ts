import type { Merchant } from "@/db/core";
import { err_bad_status } from "@/fetch_utils";
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
import { delay } from "@std/async";
import { PayinResponse } from "./payment/payin_response";
import { PayoutResponse } from "./payment/payout_response";
import { assert } from "vitest";
import { RuleBuilder } from "@/flexy_guard_builder";

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

export type ExtendedMerchant = ReturnType<typeof extendMerchant>;

export function extendMerchant(ctx: Context, merchant: Merchant) {
  let {
    core_db,
    settings_db,
    business_db,
    core_harness,
    settings_service,
    business_url,
    mock_servers,
    guard_service,
    commission_service,
  } = ctx.shared_state();
  async function wallets() {
    return core_db.profileWallets(merchant.id);
  }

  async function cashin(currency: string, amount: number) {
    return core_harness.cashin(merchant.id, currency, amount);
  }

  async function set_limits(min: number, max: number) {
    let rule = new RuleBuilder()
      .withHeader("mid", merchant.id.toString())
      .withBody({
        card: {
          amount: {
            value: [min, max],
          },
        },
      })
      .build();
    return guard_service.add_rule(rule, `Mid limits`, 1);
  }

  /**
   * Changing settings is async operation.
   * Do not expect consistent results when changing settings for the same merchant concurrently!
   */
  async function set_settings(settings: Record<string, any>) {
    let current = await settings_db.merchant_settings(merchant.id);
    // console.log({ current });
    //
    // let old_update_time: Date | undefined = undefined;
    // for (let i = 0; i < 20; ++i) {
    //   try {
    //     old_update_time = await business_db.settings_last_updated_at(
    //       current.external_id,
    //     );
    //     console.log(`old settings for ${current.external_id}`, old_update_time);
    //     break;
    //   } catch (e) {
    //     console.log(
    //       "failed to fetch existing settings updated time, using current time",
    //       e,
    //     );
    //     await delay(200);
    //   }
    // }
    // assert(old_update_time, "Flacky test: failed to wait until settings exist");
    // console.log("old updated time", old_update_time);

    await settings_service.edit(current.id, current.external_id, settings);

    // for (let i = 0; i < 21; ++i) {
    //   let updated_time = await business_db.settings_last_updated_at(
    //     current.external_id,
    //   );
    //   console.log(
    //     `${i}. new settings for ${current.external_id}`,
    //     updated_time,
    //   );
    //   console.log("old updated_time", old_update_time);
    //   if (updated_time.getTime() > old_update_time.getTime()) {
    //     ctx.story.add_chapter("Set merchant settings", settings);
    //     // The approach above does not work :<(
    //     // WE WAIT
    //     await delay(1000);
    //     return;
    //   }
    //   await delay(50);
    // }
    // throw Error("Failed to set merchant settings");
    ctx.story.add_chapter(`Set MID ${merchant.id} settings`, settings);
    await delay(2000);
  }

  function callbackUrl() {
    return `http://host.docker.internal:6767/${merchant.id}`;
  }

  async function make_request(
    path: string,
    request: MerchantRequest | PaymentRequest | PayoutRequest,
  ): Promise<Response> {
    if (request["callbackUrl"] === undefined) {
      let url = callbackUrl();
      console.log("Overriding merchant callback url to", url);
      request["callbackUrl"] = url;
    }

    let url = business_url + path;
    console.log({ body: request, url }, "Making merchant request");

    return await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + merchant.merchant_private_key,
      },
      body: JSON.stringify(request),
    }).then(err_bad_status);
  }

  async function create_payment<T extends MerchantRequest = PaymentRequest>(
    request: T,
  ) {
    ctx.story.add_chapter(
      "Create payment",
      constructCurlRequest(request, merchant.merchant_private_key, "pay"),
    );
    let res = await make_request("/api/v1/payments", request).then(
      async (r) => new PayinResponse(ctx, r, await r.json()),
    );
    // TODO: fix this
    try {
      ctx.annotate(`Created payment: ${res.as_ok().token}`);
    } catch {}

    return res;
  }

  async function create_payout<T extends MerchantRequest = PayoutRequest>(
    request: T,
  ) {
    ctx.story.add_chapter(
      "Create payout",
      constructCurlRequest(request, merchant.merchant_private_key, "payout"),
    );
    let res = await make_request("/api/v1/payouts", request).then(
      async (r) => new PayoutResponse(ctx, r, await r.json()),
    );
    try {
      ctx.annotate(`Created payout: ${res.as_ok().token}`);
    } catch {}

    return res;
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
        let raw_request = await c.req.json();
        ctx.story.add_chapter("Merchant notification", raw_request);
        let callback = extendNotification(
          NOTIFICATION_SCHEMA.parse(raw_request),
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

  async function block_traffic(force = true) {
    if (force) {
      ctx.story.add_chapter("Block merchant traffic", merchant.id.toString());
    } else {
      ctx.story.add_chapter("Unblock merchant traffic", merchant.id.toString());
    }
    await ctx.shared_state().core_harness.block_traffick(merchant.id, force);
  }

  return {
    ...merchant,
    wallets,
    set_limits,
    cashin,
    set_settings,
    create_payment: <T extends MerchantRequest = PaymentRequest>(req: T) =>
      create_payment(req).then((r) => r.as_ok()),
    create_payment_err: <T extends MerchantRequest = PaymentRequest>(req: T) =>
      create_payment(req).then((r) => r.as_error().as_common_error()),
    create_payout: <T extends MerchantRequest = PayoutResponse>(req: T) =>
      create_payout(req).then((r) => r.as_ok()),
    create_payout_err: <T extends MerchantRequest = PayoutResponse>(req: T) =>
      create_payout(req).then((r) => r.as_error().as_common_error()),
    notification_handler,
    callbackUrl,
    set_commission,
    block_traffic,
  };
}
