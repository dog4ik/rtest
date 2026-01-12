import type { Handler, MockProviderParams } from "@/mock_server/api";
import * as common from "@/common";
import * as vitest from "vitest";
import crypto from "node:crypto";
import * as encoding from "@std/encoding";
import { z } from "zod";
import { StatusPage, ThreeDsForm } from "./threedspage";
import type { PrimeBusinessStatus } from "@/db/business";

const THREEDS_HANDLER_PATH = "/3dsHandler";

const PAYIN_REQUEST_SCHEMA = z.object({
  ORDER: z.string(),
  AMOUNT: z.coerce.number(),
  CURRENCY: z.string(),
  MERCHANT: z.string(),
  TERMINAL: z.string(),
  CLIENT_ID: z.coerce.number(),
  DESC: z.string(),
  BACKREF: z.url(),

  crd_pan: z.string(),
  crd_exp: z.string(),
  crd_cvc: z.string(),

  P_SIGN: z.string(),
  MERCH_3D_TERM_URL: z.url(),
});

const REFUND_REQUEST_SCHEMA = z.object({
  ORDER: z.string(),
  MERCHANT: z.string(),
  REV_AMOUNT: z.float64(),
  REV_DESC: z.literal("REFUND"),
  P_SIGN: z.string(),
});

const CREQ_SCHEMA = z.object({
  messageType: z.literal("CReq"),
  messageVersion: z.literal("2.2.0"),
  threeDSServerTransID: z.uuidv4(),
  acsTransID: z.uuidv4(),
  challengeWindowSize: z.string().optional(),
});

function randomCreq(): z.infer<typeof CREQ_SCHEMA> {
  return {
    messageType: "CReq",
    messageVersion: "2.2.0",
    threeDSServerTransID: crypto.randomUUID(),
    acsTransID: crypto.randomUUID(),
    challengeWindowSize: "05",
  };
}

function mask_card(card: string) {
  vitest.assert(card.length >= 10, "card should have more than 10 characters");
  return `${card.slice(0, 6)}***${card.slice(-4)}`;
}

export type CResResponse = ReturnType<JusanPayment["cres"]>;

export class JusanPayment {
  gateway_id: string;
  request_data?: z.infer<typeof PAYIN_REQUEST_SCHEMA>;
  creq: ReturnType<typeof randomCreq>;

  constructor() {
    this.gateway_id = crypto.randomUUID();
    this.request_data = undefined;
    this.creq = randomCreq();
  }

  cres(challenge_success: boolean) {
    return {
      acsTransID: this.creq.acsTransID,
      messageType: "CRes",
      messageVersion: this.creq.messageVersion,
      transStatus: challenge_success ? "Y" : "N",
      threeDSServerTransID: this.creq.threeDSServerTransID,
    };
  }

  create_3ds_response(req: any, post_url_base: string, secret: string) {
    this.request_data = PAYIN_REQUEST_SCHEMA.parse(req);
    this.creq;
    return {
      type: "cardauth2",
      "3DSMethodURL": "",
      threeDSMethodData: "",
      postUrl: `${post_url_base}${THREEDS_HANDLER_PATH}?secret=${secret}`,
      request: encoding.encodeBase64Url(JSON.stringify(this.creq)),
      md: encoding.encodeBase64Url(this.creq.threeDSServerTransID),
      termUrl: "https://jpay.alataucitybank.kz:1443/cgi-bin/cgi_link",
    };
  }

  recieveCReq(req: any) {
    let data = z.object({ creq: z.string() }).parse(req);
    let bytes = encoding.decodeBase64Url(data.creq);
    let creq = CREQ_SCHEMA.parse(JSON.parse(new TextDecoder().decode(bytes)));
    vitest.assert.deepEqual(creq, this.creq, "creq should match");
  }

  CReqhandler(): Handler {
    return async (c) => {
      vitest.assert.strictEqual(
        c.req.method,
        "POST",
        "creq delivered using POST method",
      );
      this.recieveCReq(await c.req.parseBody());
      vitest.assert(this.request_data, "request data should be defined");
      // this is bad, use browser to send post via form
      // content type likely needs to be form-data
      // await fetch(this.request_data?.MERCH_3D_TERM_URL, {
      //   method: "POST",
      //   headers: { "content-type": "application/json" },
      //   body: JSON.stringify({
      //     cres: encoding.encodeBase64(JSON.stringify(this.creq)),
      //     threeDSSessionData: "undefined",
      //   }),
      // }).then(err_bad_status);
      return c.render(
        ThreeDsForm({
          termUrl: this.request_data.MERCH_3D_TERM_URL,
          cres: this.cres.bind(this),
        }),
      );
    };
  }

  threeds_challenge_verification_handler(status: PrimeBusinessStatus): Handler {
    return (c) => c.html(StatusPage(status));
  }

  // Non 3ds stuff

  create_response_handler(status: PrimeBusinessStatus): Handler {
    return async (c) => {
      this.request_data = PAYIN_REQUEST_SCHEMA.parse(await c.req.parseBody());
      return c.html(StatusPage(status));
    };
  }

  status_response(status: PrimeBusinessStatus) {
    vitest.assert(this.request_data, "request data should be defined");
    let is_declined = status == "declined";
    type StatusSpecificData = {
      status: "S" | "E";
      status_desc: string;
      result: 0 | 2;
      result_desc: "ok" | "Транзакция отклонена";
      rc: "00" | "51";
      edesc: "Approved" | "";
    };
    let data: StatusSpecificData;
    if (is_declined) {
      data = {
        status: "E",
        status_desc: "Ошибка при оплате",
        result_desc: "Транзакция отклонена",
        edesc: "",
        rc: "51",
        result: 2,
      };
    } else {
      data = {
        status: "S",
        status_desc: "Обработано успешно",
        result_desc: "ok",
        edesc: "Approved",
        rc: "00",
        result: 0,
      };
    }
    return `
    <?xml version="1.0" encoding="utf-8"?>
<result>
<code>0</code>
<description>ок</description>
<operation>
<status>${data.status}</status>
<status_desc>${data.status_desc}</status_desc>
<amount>${this.request_data.AMOUNT}</amount>
<currency>${this.request_data.CURRENCY}</currency>
<description>${this.request_data.DESC}</description>
<desc_order></desc_order>
<email></email>
<lang>ru</lang>
<mpi_order>17681082891439730595958563</mpi_order>
<terminal>${this.request_data.TERMINAL}</terminal>
<phone></phone>
<card_masked>${mask_card(this.request_data.crd_pan)}</card_masked>
<card_name></card_name>
<card_expdt>${this.request_data.crd_exp}</card_expdt>
<card_token></card_token>
<create_date>11.01.2026 10:11:29</create_date>
<result>${data.result}</result>
<result_desc>${data.result}</result_desc>
<rc>${data.rc}</rc>
<rrn>${common.rrn}</rrn>
<int_ref>11DC6AB66DC52DF7</int_ref>
<auth_code></auth_code>
<inv_id></inv_id>
<inv_exp_date></inv_exp_date>
<rev_max_amount>${this.request_data.AMOUNT}</rev_max_amount>
<recur_freq></recur_freq>
<requr_exp></requr_exp>
<recur_ref></recur_ref>
<recur_int_ref></recur_int_ref>
<client_id>29441</client_id>
<card_to_masked></card_to_masked>
<cart_to_token></cart_to_token>
<fee></fee>
<ecode></ecode>
<edesc></edesc>
<merch_rn_id></merch_rn_id>
<refunds></refunds>
</operation>
</result>
    `;
  }

  status_handler(status: PrimeBusinessStatus): Handler {
    return (c) =>
      c.body(this.status_response(status), 200, {
        "content-type": "application/xml; charset=UTF-8",
      });
  }

  refund_response(status: PrimeBusinessStatus, req: any) {
    let refund_request = REFUND_REQUEST_SCHEMA.parse(req);
    vitest.assert(
      status === "approved",
      "refund with status is not implemented yet",
    );
    return `
<?xml version="1.0" encoding="utf-8"?>
<result>
<code>0</code>
<description>ок</description>
<operation>
<status>R</status>
<result_desc>Transaction approved.</result_desc>
<result>9</result>
<rc>00</rc>
<ecode></ecode>
<edesc></edesc>
<amount>${refund_request.REV_AMOUNT}</amount>
<rrn>${common.rrn}</rrn>
<rev_desc>REFUND</rev_desc>
<rev_date>09.01.2026 21:00:04</rev_date>
</operation>
</result>`;
  }

  refund_handler(status: PrimeBusinessStatus): Handler {
    return async (c) =>
      c.body(this.refund_response(status, await c.req.parseBody()), 200, {
        "content-type": "application/xml; charset=UTF-8",
      });
  }

  static settings(secret: string) {
    return {
      MID: secret,
      TID: "11301377",
      class: "jusan",
      // TODO: do something about assets
      public_key: "sJwokM6wprvueFfXHdavDYKA",
      shared_secret: "9654665862569256325656",
    };
  }

  static mock_params(secret: string): MockProviderParams {
    return {
      alias: "jusan_payment",
      filter_fn: async (req) => {
        if (req.path === THREEDS_HANDLER_PATH) {
          return req.query("secret") == secret;
        }
        if (req.path == "/") {
          let body = await req.parseBody();
          return body.MERCHANT == secret;
        }
        return false;
      },
    };
  }

  threeds_verifier_mock_params(): MockProviderParams {
    return {
      alias: "jusan_3ds",
      filter_fn: async (req) => {
        try {
          let data = z
            .object({ cres: z.base64(), threeDSSessionData: z.base64() })
            .parse(await req.parseBody());
          return (
            data.threeDSSessionData ===
            encoding.encodeBase64Url(this.creq.threeDSServerTransID)
          );
        } catch {
          return false;
        }
      },
    };
  }
}
