import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import type { CreateRuleJson } from "@/driver/flexy_commission";
import { USE_LEGACY_FLEXY } from "@/driver/flexy_guard";
import * as default_provider from "@/provider_mocks/default";
import type { TestCaseBase } from "@/suite_interfaces";
import { test } from "@/test_context";

const CURRENCY = "RUB";

type HeaderCreator = (mid: number) => Record<string, any>[];

function testHeaderMatch(make_headers: HeaderCreator, suite: TestCaseBase) {
  _testHeader(make_headers, suite, true);
}

function testHeaderMiss(make_headers: HeaderCreator, suite: TestCaseBase) {
  _testHeader(make_headers, suite, false);
}

function _testHeader(
  make_headers: HeaderCreator,
  suite: TestCaseBase,
  should_match = true,
) {
  let descriptor = JSON.stringify(make_headers(0));
  test.concurrent(`${descriptor} ${should_match ? "hit" : "miss"}`, async ({
    ctx,
    merchant,
  }) =>
    ctx.track_bg_rejections(async () => {
      await merchant.set_settings(suite.settings(ctx.uuid));

      for (let header of make_headers(merchant.id)) {
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
      }

      let request = suite.request();

      if (should_match) {
        await merchant.create_payment_err(request);
      } else {
        let res = await merchant.create_payment(request);
        assert.strictEqual(res.payment.status, "approved");
      }
    }));
}

testHeaderMatch((mid) => [{ mid }], default_provider.payinSuite());

testHeaderMatch(
  (mid) => [{ mid, currency: CURRENCY }],
  default_provider.payinSuite(),
);

testHeaderMatch(
  (mid) => [{ mid, currency: CURRENCY, acq_id: "Gateway::DefaultPayment" }],
  default_provider.payinSuite(),
);

testHeaderMiss(
  (mid) => [{ mid, currency: "NAN" }],
  default_provider.payinSuite(),
);

describe.skipIf(USE_LEGACY_FLEXY).concurrent("mongo expressions", () => {
  testHeaderMatch(
    (mid) => [
      {
        mid: [-100, 1, 3.14, mid],
        currency: ["NAN", CURRENCY, "USD", "URK", "EUR"],
      },
    ],
    default_provider.payinSuite(),
  );

  testHeaderMiss(
    (mid) => [{ mid, currency: ["NAN", "USD", "URK", "EUR"] }],
    default_provider.payinSuite(),
  );

  testHeaderMatch(
    (mid) => [{ mid, phone: { eq: null } }],
    default_provider.payinSuite(),
  );

  testHeaderMiss(
    (mid) => [{ mid, phone: { card_number: null } }],
    default_provider.payinSuite(),
  );

  testHeaderMatch(
    (mid) => [{ mid, amount: { range: [12345, 200000] } }],
    default_provider.payinSuite(),
  );

  testHeaderMatch(
    (mid) => [{ mid, amount: { gt: 1000, lt: common.amount + 1 } }],
    default_provider.payinSuite(),
  );

  testHeaderMiss(
    (mid) => [{ mid, amount: { range: [100, 2000] } }],
    default_provider.payinSuite(),
  );

  testHeaderMiss(
    (mid) => [{ mid, email: { regex: "@gmail.com$" } }],
    default_provider.payinSuite(),
  );

  testHeaderMatch(
    (mid) => [{ mid, email: { regex: "@test.com$" } }],
    default_provider.payinSuite(),
  );

  testHeaderMiss(
    (mid) => [{ mid, phone: { regex: "^7916" } }],
    default_provider.payinSuite(),
  );

  function suiteWithPhone(suite: TestCaseBase) {
    let request = suite.request();
    (request as Record<any, any>).customer.phone = common.phoneNumber;
    return { ...suite, request: () => request };
  }

  testHeaderMatch(
    (mid) => [{ mid, phone: { regex: "^7999" } }],
    suiteWithPhone(default_provider.payinSuite()),
  );

  testHeaderMiss(
    (mid) => [{ mid, email: { nin: ["test@test.com"] } }],
    default_provider.payinSuite(),
  );

  testHeaderMatch(
    (mid) => [{ mid, email: { nin: ["another@test.com"] } }],
    default_provider.payinSuite(),
  );

  // Mongo expression: amount at exact lower boundary of range should match
  testHeaderMatch(
    (mid) => [
      { mid, amount: { range: [common.amount, common.amount + 100000] } },
    ],
    default_provider.payinSuite(),
  );

  // Mongo expression: amount at exact upper boundary of range should match
  testHeaderMatch(
    (mid) => [
      { mid, amount: { range: [common.amount - 100000, common.amount] } },
    ],
    default_provider.payinSuite(),
  );

  // Mongo expression: amount one below lower boundary should miss
  testHeaderMiss(
    (mid) => [
      { mid, amount: { range: [common.amount + 1, common.amount + 100000] } },
    ],
    default_provider.payinSuite(),
  );

  describe.todo("pipeline error resilience", () => {
    // $in requires its second argument to be an array; passing a scalar should not crash the service
    testHeaderMiss(
      (mid) => [{ mid, currency: { in: "RUB" } }],
      default_provider.payinSuite(),
    );

    testHeaderMiss(
      (mid) => [{ mid, currency: { in: 42 } }],
      default_provider.payinSuite(),
    );

    testHeaderMiss(
      (mid) => [{ mid, currency: { in: null } }],
      default_provider.payinSuite(),
    );

    testHeaderMiss(
      (mid) => [{ mid, currency: { in: {} } }],
      default_provider.payinSuite(),
    );

    // $in (via nin) with non-array values
    testHeaderMiss(
      (mid) => [{ mid, currency: { nin: "RUB" } }],
      default_provider.payinSuite(),
    );

    testHeaderMiss(
      (mid) => [{ mid, currency: { nin: 42 } }],
      default_provider.payinSuite(),
    );

    testHeaderMiss(
      (mid) => [{ mid, currency: { nin: null } }],
      default_provider.payinSuite(),
    );

    // $regexMatch throws on an invalid regex pattern
    testHeaderMiss(
      (mid) => [{ mid, currency: { regex: "[unclosed" } }],
      default_provider.payinSuite(),
    );

    testHeaderMiss(
      (mid) => [{ mid, currency: { regex: "*noprefix" } }],
      default_provider.payinSuite(),
    );

    testHeaderMiss(
      (mid) => [{ mid, currency: { regex: "(?P<bad" } }],
      default_provider.payinSuite(),
    );

    // $regexMatch requires input to be a string; amount is a number in the request
    testHeaderMiss(
      (mid) => [{ mid, amount: { regex: "^123" } }],
      default_provider.payinSuite(),
    );

    // $arrayElemAt (used by range) requires an array as first argument
    testHeaderMiss(
      (mid) => [{ mid, amount: { range: "1000,5000" } }],
      default_provider.payinSuite(),
    );

    testHeaderMiss(
      (mid) => [{ mid, amount: { range: 1000 } }],
      default_provider.payinSuite(),
    );

    testHeaderMiss(
      (mid) => [{ mid, amount: { range: {} } }],
      default_provider.payinSuite(),
    );

    // range with wrong-length arrays: upper/lower bounds resolve to null
    testHeaderMiss(
      (mid) => [{ mid, amount: { range: [] } }],
      default_provider.payinSuite(),
    );

    testHeaderMiss(
      (mid) => [{ mid, amount: { range: [1000] } }],
      default_provider.payinSuite(),
    );
  });
});

describe
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("system ranges", () => {
    function suiteWithAmount(
      suite: TestCaseBase,
      amount: number,
    ): TestCaseBase {
      let req = suite.request();
      (req as Record<any, any>).amount = amount;
      return { ...suite, request: () => req };
    }

    function rangeRule(mid: number, lo: number, hi: number) {
      return {
        header: {
          mid,
          amount: USE_LEGACY_FLEXY
            ? [String(lo), String(hi)]
            : { range: [lo, hi] },
        },
        body: { card: { amount: { value: [-1, 0] } } },
      };
    }

    // Bug fix: rule must fire when request amount is exactly at the range's lower boundary
    test.concurrent("range lower boundary triggers rule", async ({
      ctx,
      merchant,
    }) =>
      ctx.track_bg_rejections(async () => {
        const LO = 400000,
          HI = 600000;
        await merchant.set_settings(
          default_provider.payinSuite().settings(ctx.uuid),
        );
        await ctx.add_flexy_guard_range("payin", "amount", `${LO}, ${HI}`);
        await ctx.add_flexy_guard_rule(rangeRule(merchant.id, LO, HI));
        await merchant.create_payment_err(
          suiteWithAmount(default_provider.payinSuite(), LO).request(),
        );
      }));

    test.concurrent("range upper boundary triggers rule", async ({
      ctx,
      merchant,
    }) =>
      ctx.track_bg_rejections(async () => {
        const LO = 400000,
          HI = 600000;
        await merchant.set_settings(
          default_provider.payinSuite().settings(ctx.uuid),
        );
        await ctx.add_flexy_guard_range("payin", "amount", `${LO}, ${HI}`);
        await ctx.add_flexy_guard_rule(rangeRule(merchant.id, LO, HI));
        await merchant.create_payment_err(
          suiteWithAmount(default_provider.payinSuite(), HI).request(),
        );
      }));

    test.concurrent("amount one below lower boundary misses rule", async ({
      ctx,
      merchant,
    }) =>
      ctx.track_bg_rejections(async () => {
        const LO = 400000,
          HI = 600000;
        await merchant.set_settings(
          default_provider.payinSuite().settings(ctx.uuid),
        );
        await ctx.add_flexy_guard_range("payin", "amount", `${LO}, ${HI}`);
        await ctx.add_flexy_guard_rule(rangeRule(merchant.id, LO, HI));
        const res = await merchant.create_payment(
          suiteWithAmount(default_provider.payinSuite(), LO - 1).request(),
        );
        assert.strictEqual(res.payment.status, "approved");
      }));

    test.concurrent("amount one above upper boundary misses rule", async ({
      ctx,
      merchant,
    }) =>
      ctx.track_bg_rejections(async () => {
        const LO = 400000,
          HI = 600000;
        await merchant.set_settings(
          default_provider.payinSuite().settings(ctx.uuid),
        );
        await ctx.add_flexy_guard_range("payin", "amount", `${LO}, ${HI}`);
        await ctx.add_flexy_guard_rule(rangeRule(merchant.id, LO, HI));
        const res = await merchant.create_payment(
          suiteWithAmount(default_provider.payinSuite(), HI + 1).request(),
        );
        assert.strictEqual(res.payment.status, "approved");
      }));

    // Two non-overlapping ranges must each fire their own rule
    test.concurrent("two non-overlapping ranges each fire their rule", async ({
      ctx,
      merchant,
    }) =>
      ctx.track_bg_rejections(async () => {
        const LO1 = 3000000,
          HI1 = 4000000;
        const LO2 = 4000001,
          HI2 = 5000000;
        await merchant.set_settings(
          default_provider.payinSuite().settings(ctx.uuid),
        );
        await ctx.add_flexy_guard_range("payin", "amount", `${LO1}, ${HI1}`);
        await ctx.add_flexy_guard_range("payin", "amount", `${LO2}, ${HI2}`);
        await ctx.add_flexy_guard_rule(rangeRule(merchant.id, LO1, HI1));
        await ctx.add_flexy_guard_rule(rangeRule(merchant.id, LO2, HI2));
        await merchant.create_payment_err(
          suiteWithAmount(default_provider.payinSuite(), 3500000).request(),
        );
        await merchant.create_payment_err(
          suiteWithAmount(default_provider.payinSuite(), 4500000).request(),
        );
      }));

    // Lower boundary of the second (higher) range must trigger its rule, not the first range's
    test.concurrent("lower boundary of second range fires its own rule", async ({
      ctx,
      merchant,
    }) =>
      ctx.track_bg_rejections(async () => {
        const LO1 = 3000000,
          HI1 = 4000000;
        const LO2 = 4000001,
          HI2 = 5000000;
        await merchant.set_settings(
          default_provider.payinSuite().settings(ctx.uuid),
        );
        await ctx.add_flexy_guard_range("payin", "amount", `${LO1}, ${HI1}`);
        await ctx.add_flexy_guard_range("payin", "amount", `${LO2}, ${HI2}`);
        // Only rule 2 registered for this merchant — lower boundary of range 2 must hit it
        await ctx.add_flexy_guard_rule(rangeRule(merchant.id, LO2, HI2));
        await merchant.create_payment_err(
          suiteWithAmount(default_provider.payinSuite(), LO2).request(),
        );
      }));
  });

const DEFAULT_SOURCE = "default";

const DEFAULT_BODY: CreateRuleJson["body"] = {
  self: { rate: "10" },
  provider: { rate: "0" },
  agent: { rate: "0" },
};

const DEFAULT_COMMISSION = 10;

type CommissionRuleCreator = (mid: number) => CreateRuleJson[];

function testCommissionMatch(
  make_rules: CommissionRuleCreator,
  suite: TestCaseBase,
  expected_commission: number,
) {
  _testCommission(make_rules, suite, expected_commission);
}

function testCommissionMiss(
  make_rules: CommissionRuleCreator,
  suite: TestCaseBase,
) {
  _testCommission(make_rules, suite, null);
}

function _testCommission(
  make_rules: CommissionRuleCreator,
  suite: TestCaseBase,
  expected_commission_value: number | null,
) {
  let descriptor = JSON.stringify(make_rules(0));
  test.concurrent(`${descriptor} ${expected_commission_value !== null ? "match" : "miss"}`, async ({
    ctx,
    merchant,
  }) =>
    ctx.track_bg_rejections(async () => {
      await merchant.set_settings(suite.settings(ctx.uuid));
      for (let rule of make_rules(merchant.id)) {
        await ctx.add_flexy_commission_as_json(rule);
      }

      let res = await merchant.create_payment(suite.request());
      assert.strictEqual(res.payment.status, "approved");
      await ctx.healthcheck(res.token, {
        expect: { commission_value: expected_commission_value ?? 0 },
      });
    }));
}

describe.skipIf(USE_LEGACY_FLEXY).concurrent("mongo commission header", () => {
  testCommissionMatch(
    (mid) => [
      {
        header: { to_profile: mid, currency: CURRENCY, source: DEFAULT_SOURCE },
        body: DEFAULT_BODY,
      },
    ],
    default_provider.payinSuite(),
    DEFAULT_COMMISSION,
  );

  testCommissionMiss(
    (mid) => [
      {
        header: { to_profile: mid, currency: "USD", source: DEFAULT_SOURCE },
        body: DEFAULT_BODY,
      },
    ],
    default_provider.payinSuite(),
  );

  testCommissionMiss(
    (mid) => [
      {
        header: {
          to_profile: mid,
          currency: "USD",
          source: DEFAULT_SOURCE,
          amount: { range: [0.0, common.amount / 100] },
        },
        body: DEFAULT_BODY,
      },
      {
        header: {
          to_profile: mid,
          currency: "USD",
          source: DEFAULT_SOURCE,
          amount: { range: [common.amount / 100 + 1, 99999999] },
        },
        body: DEFAULT_BODY,
      },
    ],
    default_provider.payinSuite(),
  );

  // Two rules present: USD at 5% (no match) and RUB at 20% (match) — commission must come from the RUB rule.
  testCommissionMatch(
    (mid) => [
      {
        header: { to_profile: mid, currency: "USD", source: DEFAULT_SOURCE },
        body: {
          self: { rate: "5" },
          provider: { rate: "0" },
          agent: { rate: "0" },
        },
      },
      {
        header: { to_profile: mid, currency: CURRENCY, source: DEFAULT_SOURCE },
        body: {
          self: { rate: "20" },
          provider: { rate: "0" },
          agent: { rate: "0" },
        },
      },
    ],
    default_provider.payinSuite(),
    20,
  );

  // The rule with more header keys beats the rule with less keys
  testCommissionMatch(
    (mid) => [
      {
        header: { to_profile: mid },
        body: {
          self: { rate: "5" },
          provider: { rate: "0" },
          agent: { rate: "0" },
        },
      },
      {
        header: { to_profile: mid, currency: "RUB", source: DEFAULT_SOURCE },
        body: {
          self: { rate: "10" },
          provider: { rate: "0" },
          agent: { rate: "0" },
        },
      },
      {
        header: { to_profile: mid, currency: "RUB" },
        body: {
          self: { rate: "15" },
          provider: { rate: "0" },
          agent: { rate: "0" },
        },
      },
    ],
    default_provider.payinSuite(),
    10,
  );

  // The rule with equal header keys length but rule with range wins over others.
  testCommissionMatch(
    (mid) => [
      {
        header: { to_profile: mid, currency: "RUB", agent_id: { eq: null } },
        body: {
          self: { rate: "5" },
          provider: { rate: "0" },
          agent: { rate: "0" },
        },
      },
      {
        header: {
          to_profile: mid,
          currency: "RUB",
          amount: { range: [10.0, 1000000.0] },
        },
        body: {
          self: { rate: "10" },
          provider: { rate: "0" },
          agent: { rate: "0" },
        },
      },
      {
        header: { to_profile: mid, currency: "RUB", source: DEFAULT_SOURCE },
        body: {
          self: { rate: "15" },
          provider: { rate: "0" },
          agent: { rate: "0" },
        },
      },
    ],
    default_provider.payinSuite(),
    10,
  );
});
