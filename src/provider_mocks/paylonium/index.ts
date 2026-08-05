import { isElement, parse } from "@std/xml";
import { assert } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import type { PrimeBusinessStatus } from "@/db/business";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import { defaultSettings } from "@/settings_builder";
import type { Status } from "@/suite_interfaces";

type PayoutStatus = "approved" | "declined" | "pending";

const STATUS_CODES: Record<
  PayoutStatus,
  { code: number; state: number; final: number }
> = {
  approved: { code: 0, state: 60, final: 1 },
  declined: { code: 20, state: 80, final: 1 },
  pending: { code: 1, state: 40, final: 0 },
};

const FAKE_TRANS = "924";

export type ParsedPayment = {
  id: string;
  sum: string;
  service: number;
  account: string;
  attrs: Record<string, string>;
};

function buildXmlResponse(id: string, status: PayoutStatus): string {
  const { code, state, final } = STATUS_CODES[status];
  return (
    `<response>\r\n` +
    `  <result id="${id}" code="${code}" state="${state}" final="${final}" trans="${FAKE_TRANS}">\r\n` +
    `    <attribute name="fee" value="32000"></attribute>\r\n` +
    `  </result>\r\n` +
    `</response>`
  );
}

function parseRequest(
  body: string,
): { type: "payment"; data: ParsedPayment } | { type: "status"; id: string } {
  const doc = parse(body);
  const root = doc.root;
  for (const child of root.children ?? []) {
    if (!isElement(child)) continue;
    if (child.name.local === "payment") {
      const attrs: Record<string, string> = {};
      for (const attr of child.children ?? []) {
        if (!isElement(attr)) continue;
        if (attr.name.local === "attribute") {
          attrs[attr.attributes.name as string] = attr.attributes
            .value as string;
        }
      }
      return {
        type: "payment",
        data: {
          id: child.attributes.id as string,
          sum: child.attributes.sum as string,
          service: Number(child.attributes.service),
          account: child.attributes.account as string,
          attrs,
        },
      };
    }
    if (child.name.local === "status") {
      return { type: "status", id: child.attributes.id as string };
    }
  }
  throw new Error(`Unknown paylonium XML request: ${body}`);
}

function toPrimeStatus(s: PrimeBusinessStatus): PayoutStatus {
  if (s === "approved") return "approved";
  if (s === "declined") return "declined";
  return "pending";
}

export class PayloniumPayout {
  payment_id?: string;
  last_payment?: ParsedPayment;

  create_handler(status: PrimeBusinessStatus): Handler {
    return async (c) => {
      const body = await c.req.raw.text();
      const req = parseRequest(body);
      if (req.type !== "payment") {
        throw new Error("Expected payment request in create_handler");
      }
      this.payment_id = req.data.id;
      this.last_payment = req.data;
      return c.text(buildXmlResponse(req.data.id, toPrimeStatus(status)), 200, {
        "content-type": "text/xml",
      });
    };
  }

  status_handler(status: PrimeBusinessStatus): Handler {
    return async (c) => {
      const body = await c.req.raw.text();
      const req = parseRequest(body);
      if (req.type !== "status") {
        throw new Error("Expected status request in status_handler");
      }
      assert.strictEqual(
        req.id,
        this.payment_id,
        "paylonium status id should match payout id",
      );
      return c.text(buildXmlResponse(req.id, toPrimeStatus(status)), 200, {
        "content-type": "text/xml",
      });
    };
  }

  static settings(secret: string) {
    return {
      class: "paylonium",
      key_password: "dummy",
      private_key: CONFIG.dummyRsa(),
      sandbox: false,
      service: 24,
      skip_card_payout_validation: true,
      skip_expired: true,
      username: secret,
    };
  }

  static mock_params(secret: string): MockProviderParams {
    return {
      alias: "paylonium_payout",
      filter_fn: (req) => req.path.endsWith(`/${secret}`),
    };
  }
}

export function payoutSuite(currency = "RUB"): Status<PayloniumPayout> {
  const gw = new PayloniumPayout();
  return {
    type: "payout",
    gw,
    create_handler: (s) => gw.create_handler(s),
    status_handler: (s) => gw.status_handler(s),
    mock_options: PayloniumPayout.mock_params,
    request: () => ({
      ...common.payoutRequest(currency),
      card: { pan: common.visaCard },
    }),
    settings: (secret) => {
      let settings = defaultSettings(
        currency,
        PayloniumPayout.settings(secret),
      );
      settings.gateways.skip_card_payout_validation = true;
      return settings;
    },
  };
}
