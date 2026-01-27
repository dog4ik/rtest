import { BrusnikaPayment } from "@/provider_mocks/brusnika";
import { MadsolutionPayment } from "@/provider_mocks/madsolution";
import { MillenniumTransaction } from "@/provider_mocks/millennium";
import { SettingsBuilder } from "@/settings_builder";
import { CONFIG, PROJECT, test } from "@/test_context";
import { describe, assert } from "vitest";
import * as common from "@/common";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import type { Context } from "@/test_context/context";
import type { ProcessingUrlResponse } from "@/entities/payment/processing_url_response";

const CURRENCY = "RUB";

describe.runIf(PROJECT === "8pay").concurrent("routing", () => {
  test.concurrent("Basic routing", async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      let merchant = await ctx.create_random_merchant();
      let brusnika = ctx.mock_server(BrusnikaPayment.mock_params(ctx.uuid));
      let millennium = ctx.mock_server(
        MillenniumTransaction.mock_params(ctx.uuid),
      );
      let madsolution = ctx.mock_server(
        MadsolutionPayment.mock_params(ctx.uuid),
      );
      let settings = new SettingsBuilder()
        .addP2P(CURRENCY, "brus", "brus")
        .withGateway(BrusnikaPayment.settings(ctx.uuid), "brus")
        .withGateway(MillenniumTransaction.settings(ctx.uuid), "mil")
        .withGateway(MadsolutionPayment.settings(ctx.uuid), "mad")
        .build();
      await merchant.set_settings(settings);
      console.dir(settings, { depth: Infinity });

      let routing_rules = ctx
        .routing_builder(merchant.id, "brus")
        .addStatusRoute("mil")
        .addStatusRoute("mad");
      await routing_rules.save();
      console.dir(routing_rules.rules, { depth: Infinity });

      let brusnika_payment = new BrusnikaPayment();
      let madsolution_payment = new MadsolutionPayment();
      let millennium_payment = new MillenniumTransaction();
      let handlers = Promise.all([
        brusnika.queue(BrusnikaPayment.no_requisites_handler()),
        millennium.queue(MillenniumTransaction.no_requisites_handler()),
        madsolution.queue(madsolution_payment.create_handler("PENDING")),
      ]);
      let notification = merchant.queue_notification((callback) => {
        assert.strictEqual(callback.status, "declined");
      });

      let result = await merchant.create_payment({
        ...common.paymentRequest(CURRENCY),
        extra_return_param: "Cards",
      });
      let res = await result.followFirstProcessingUrl();
      if (CONFIG.project === "8pay") {
        console.log(await res.as_8pay_requisite());
      }
      setTimeout(() => {
        madsolution_payment
          .send_callback("CANCELED")
          .then(() => console.log("sent callback"));
      }, 11_000);

      await handlers;
      await notification;
    });
  });
});

interface Routable {
  mock_params: (secret: string) => MockProviderParams;
  alias: () => string;
  settings_chunk: (secret: string) => {};
  no_requisites_handler: () => Handler;
  pending_response_handler: () => Handler;
}

async function executeRoutingChain(
  ctx: Context,
  currency: string,
  gateways: Routable[],
  onProcessingUrlResponse?: (processingUrl: ProcessingUrlResponse) => {},
) {
  let merchant = await ctx.create_random_merchant();
  let uuid = crypto.randomUUID();

  let settings_builder = new SettingsBuilder();
  settings_builder.addP2P(currency, gateways[0].alias(), gateways[0].alias());
  let rule_builder = ctx.routing_builder(merchant.id, gateways[0].alias());

  let chain = gateways.map((gw, i) => {
    settings_builder.withGateway(gw.settings_chunk(uuid), gw.alias());
    let mock_server = ctx.mock_server(gw.mock_params(uuid));

    if (i === gateways.length - 1) {
      return mock_server.queue(gw.pending_response_handler());
    } else {
      rule_builder.addStatusRoute(gateways[i + 1].alias());
      return mock_server.queue(gw.no_requisites_handler());
    }
  });

  await merchant.set_settings(settings_builder.build());
  await rule_builder.save();

  let notification = merchant.queue_notification((cb) => {
    assert.strictEqual(cb.status, "approved");
  });

  let result = await merchant.create_payment({
    ...common.paymentRequest(currency),
    extra_return_param: "Cards",
  });

  let processingUrl = result.followFirstProcessingUrl();
  await Promise.all(chain);

  onProcessingUrlResponse?.(await processingUrl);

  await notification;
}
