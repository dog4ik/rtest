import type { Context } from "./test_context/context";

type AnyRecord = Record<string, {}>;

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
  constructor(
    private ctx: Context,
    mid: number,
    start: string,
  ) {
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
    return this;
  }

  /**
   * Create all prepared rules in flexy-guard service
   */
  async save() {
    await Promise.all(
      this.rules.map((rule, index) => {
        this.ctx.story.add_chapter("Create flexy guard rule", rule);
        this.ctx
          .shared_state()
          .guard_service.add_rule(rule, `Routing rule #${index + 1}`);
      }),
    );
  }
}
