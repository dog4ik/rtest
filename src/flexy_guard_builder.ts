import type { FlexyGuardHarness } from "./driver/flexy_guard";

type AnyRecord = Record<string, any>;

type Rule = {
  header: AnyRecord;
  body: AnyRecord;
  routing?: AnyRecord | null;
  action?: any;
};

export class RuleBuilder {
  rule: Rule;

  constructor() {
    this.rule = {
      header: {},
      body: {},
      routing: null,
      action: null,
    };
  }

  withHeader(key: string, value: string) {
    this.rule.header[key] = value;
    return this;
  }

  withBody(body: AnyRecord) {
    this.rule.body = body;
    return this;
  }

  withRouting(routing: AnyRecord) {
    this.rule.routing = routing;
    return this;
  }

  build(): Rule {
    return this.rule;
  }
}

export class RoutingBuilder {
  rules: Rule[] = [];
  mid: string;
  last_gateway: string;

  /**
   * @param mid acq_alias of the first gateway
   * @param start starting gateway alias
   */
  constructor(mid: number, start: string) {
    this.mid = mid.toString();
    this.last_gateway = start;
  }

  /**
   * Add a simple status:not_in declined rule
   *
   * @param dest destination alias of this route
   */
  addStatusRoute(dest: string) {
    let rule = new RuleBuilder()
      .withHeader("mid", this.mid)
      .withHeader("acq_alias", this.last_gateway)
      .withBody({
        status: {
          not_in: ["declined"],
        },
      })
      .withRouting({
        "status:not_in": {
          acq_alias: dest,
        },
      })
      .build();

    this.last_gateway = dest;
    this.rules.push(rule);
  }

  /**
   * Create all prepared rules in flexy-guard service
   */
  async save(flexy_guard: FlexyGuardHarness) {
    await Promise.all(
      this.rules.map((rule, index) => {
        flexy_guard.add_rule(rule, `Routing rule #${index + 1}`);
      }),
    );
  }
}
