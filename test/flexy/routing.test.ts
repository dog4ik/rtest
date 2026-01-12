import { BrusnikaPayment } from "@/provider_mocks/brusnika";
import { MadsolutionPayment } from "@/provider_mocks/madsolution";
import { MillenniumPayment } from "@/provider_mocks/millennium/payin";
import { SettingsBuilder } from "@/settings_builder";
import { CONFIG, test } from "@/test_context";
import * as vitest from "vitest";
import * as common from "@/common";
import type { Handler, MockProviderParams } from "@/mock_server/api";

const CURRENCY = "RUB";

interface Routable {
  mock_params: (secret: string) => MockProviderParams;
  settings_chunk: (secret: string) => {};
  no_requisites_handler: () => Handler;
  pending_response: () => Handler;
}

test.concurrent("Basic routing", async ({ ctx }) => {
  await ctx.track_bg_rejections(async () => {
    let merchant = await ctx.create_random_merchant();
    let brusnika = ctx.mock_server(BrusnikaPayment.mock_params(ctx.uuid));
    let millennium = ctx.mock_server(MillenniumPayment.mock_params(ctx.uuid));
    let madsolution = ctx.mock_server(MadsolutionPayment.mock_params(ctx.uuid));
    let settings = new SettingsBuilder()
      .addP2P(CURRENCY, "brus", "brus")
      .withGateway(BrusnikaPayment.settings(ctx.uuid), "brus")
      .withGateway(MillenniumPayment.settings(ctx.uuid), "mil")
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
    let millennium_payment = new MillenniumPayment();
    let handlers = Promise.all([
      brusnika.queue(BrusnikaPayment.no_requisites_handler()),
      millennium.queue(MillenniumPayment.no_requisites_handler()),
      madsolution.queue(madsolution_payment.create_handler("PENDING")),
    ]);
    let notification = merchant.notification_handler((callback) => {
      vitest.assert.strictEqual(callback.status, "approved");
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
