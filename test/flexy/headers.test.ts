import { test } from "@/test_context";
import { assert, describe } from "vitest";
import * as common from "@/common";
import * as default_provider from "@/provider_mocks/default";
import type { TestCaseBase } from "@/suite_interfaces";
import { CONFIG } from "@/config";

const CURRENCY = "RUB";

function testHeaderMatch(
  make_header: (mid: number) => Record<string, any>,
  suite: TestCaseBase,
) {
  _testHeader(make_header, suite, true);
}

function testHeaderMiss(
  make_header: (mid: number) => Record<string, any>,
  suite: TestCaseBase,
) {
  _testHeader(make_header, suite, false);
}

function _testHeader(
  make_header: (mid: number) => Record<string, any>,
  suite: TestCaseBase,
  should_match = true,
) {
  let descriptor = JSON.stringify(make_header(0));
  test.concurrent(
    `${descriptor} ${should_match ? "hit" : "miss"}`,
    async ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        await merchant.set_settings(suite.settings(ctx.uuid));

        let header = make_header(merchant.id);
        await ctx.add_flexy_guard_rule(
          {
            header,
            body: {
              card: {
                amount: {
                  value: [-1, 0],
                },
              },
            },
          },
          undefined,
          1,
        );

        let request = suite.request();

        if (should_match) {
          await merchant.create_payment_err(request);
        } else {
          let res = await merchant.create_payment(request);
          assert.strictEqual(res.payment.status, "approved");
        }
      }),
  );
}

testHeaderMatch((mid) => ({ mid }), default_provider.payinSuite());

testHeaderMatch(
  (mid) => ({ mid, currency: CURRENCY }),
  default_provider.payinSuite(),
);

testHeaderMatch(
  (mid) => ({ mid, currency: CURRENCY, acq_id: "Gateway::DefaultPayment" }),
  default_provider.payinSuite(),
);

testHeaderMiss(
  (mid) => ({ mid, currency: "NAN" }),
  default_provider.payinSuite(),
);

describe.runIf(CONFIG.flexy_flexy).concurrent("mongo expressions", () => {
  testHeaderMatch(
    (mid) => ({
      mid: [-100, 1, 3.14, mid],
      currency: ["NAN", CURRENCY, "USD", "URK", "EUR"],
    }),
    default_provider.payinSuite(),
  );

  testHeaderMiss(
    (mid) => ({ mid, currency: ["NAN", "USD", "URK", "EUR"] }),
    default_provider.payinSuite(),
  );

  testHeaderMatch(
    (mid) => ({ mid, phone: { eq: null } }),
    default_provider.payinSuite(),
  );

  testHeaderMiss(
    (mid) => ({ mid, phone: { card_number: null } }),
    default_provider.payinSuite(),
  );

  testHeaderMatch(
    (mid) => ({ mid, amount: { range: [12345, 200000] } }),
    default_provider.payinSuite(),
  );

  testHeaderMiss(
    (mid) => ({ mid, amount: { range: [100, 2000] } }),
    default_provider.payinSuite(),
  );

  testHeaderMiss(
    (mid) => ({ mid, email: { regex: "@gmail.com$" } }),
    default_provider.payinSuite(),
  );

  testHeaderMatch(
    (mid) => ({ mid, email: { regex: "@test.com$" } }),
    default_provider.payinSuite(),
  );

  testHeaderMiss(
    (mid) => ({ mid, phone: { regex: "^7916" } }),
    default_provider.payinSuite(),
  );

  function suiteWithPhone(suite: TestCaseBase) {
    let request = suite.request();
    (request as Record<any, any>).customer["phone"] = common.phoneNumber;
    return { ...suite, request: () => request };
  }

  testHeaderMatch(
    (mid) => ({ mid, phone: { regex: "^7999" } }),
    suiteWithPhone(default_provider.payinSuite()),
  );

  testHeaderMiss(
    (mid) => ({ mid, email: { nin: ["test@test.com"] } }),
    default_provider.payinSuite(),
  );

  testHeaderMatch(
    (mid) => ({ mid, email: { nin: ["another@test.com"] } }),
    default_provider.payinSuite(),
  );
});
