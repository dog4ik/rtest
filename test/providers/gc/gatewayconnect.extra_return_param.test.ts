import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { payinSuite } from "@/provider_mocks/gateway_connect";
import { providersSuite } from "@/suite_interfaces";
import { test } from "@/test_context";

describe
  .runIf(CONFIG.in_project(["8pay"]))
  .concurrent("8pay extra_return_param ", () => {
    function use_orig_param_suite(use_original_extra_return_param: boolean) {
      let suite = payinSuite();
      return providersSuite("RUB", {
        ...suite,
        settings: (s) => ({
          ...suite.settings(s),
          use_original_extra_return_param,
        }),
      });
    }

    type TestOpts = {
      with_setting: boolean;
      actual: string;
      expected?: string;
    };

    async function testExtraReturnParam({
      with_setting,
      actual,
      expected: expectedOpt,
    }: TestOpts) {
      let expected = expectedOpt ?? actual;
      test.concurrent(`${actual} should be ${expected} with setting: ${with_setting}`, ({
        ctx,
        merchant,
      }) =>
        ctx.track_bg_rejections(async () => {
          let suite = use_orig_param_suite(with_setting);
          await merchant.set_settings(suite.settings(ctx.uuid));
          let gw = ctx.mock_server(suite.gw.mock_params(ctx.uuid));
          gw.queue(suite.gw.requisites_payin_handler("pending", "card"));
          await merchant
            .create_payment({
              ...common.p2pPaymentRequest("RUB", "card"),
              extra_return_param: actual,
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_8pay_requisite());
          // assert.strictEqual(
          //   suite.gw.payin_request?.payment.extra_return_param,
          //   expected,
          //   "extra_return_param in gc.payment.extra_return_param",
          // );
          // await ctx
          //   .get_payment(res.token)
          //   .then((payment) =>
          //     assert.strictEqual(
          //       payment.extra_return_param,
          //       expected,
          //       "extra_return_param in db.payments.extra_return_param before finalization",
          //     ),
          //   );

          await suite.gw.send_callback("approved");

          let notification = merchant.queue_notification(
            (n) => {
              assert.strictEqual(
                n.extraReturnParam,
                expected,
                "extra_return_param in cb.extraReturnParam",
              );
            },
            { expect: { status: 1 } },
          );

          await notification;
          // await ctx
          //   .get_payment(res.token)
          //   .then((payment) =>
          //     assert.strictEqual(
          //       payment.extra_return_param,
          //       expected,
          //       "extra_return_param in db.payments.extra_return_param after finalization",
          //     ),
          //   );
        }));
    }

    testExtraReturnParam({
      with_setting: true,
      actual: "SBP",
      expected: "SBP",
    });

    testExtraReturnParam({
      with_setting: true,
      actual: "_eutHEUh_выхА9383*!<script/>Love  ",
    });

    testExtraReturnParam({
      with_setting: true,
      actual: "Test with space",
    });

    testExtraReturnParam({
      with_setting: true,
      actual: " Test ",
    });

    testExtraReturnParam({
      with_setting: false,
      actual: "SBP",
      expected: "sbp",
    });
  });
