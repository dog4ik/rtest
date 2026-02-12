import { z } from "zod";
import crypto from "node:crypto";
import { err_bad_status } from "@/fetch_utils";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import { assert } from "vitest";
import * as common from "@/common";
import { CurlBuilder } from "@/story/curl";
import type { PrimeBusinessStatus } from "@/db/business";
import type { P2PSuite } from "@/suite_interfaces";
import { providers } from "@/settings_builder";

const BankSchema = z.enum(["ANY", "SBP", "SBP_TG", "tpay"]);

export type FortaBank = z.infer<typeof BankSchema>;

export type FortaPaymentStatus = "INIT" | "INPROGRESS" | "PAID" | "CANCELED";

const PAYIN_REQUEST_SCHEMA = z.object({
  orderId: z.string().length(32),
  payerHash: z.string(),
  callbackUrl: z.url(),
  returnUrl: z.url(),
  amount: z.number(),
  bank: BankSchema,
});

function success_response(data: Record<string, any>) {
  return {
    status: true,
    data,
    error: "",
  };
}

const EMPTY_REQUISITES = {
  cardNumber: "",
  qrCodeLink: "",
  receiverPhone: "",
  bankAccount: "",
};

type FortaRequisites = typeof EMPTY_REQUISITES;

export class FortaPayment {
  gateway_id: string;
  request_data?: z.infer<typeof PAYIN_REQUEST_SCHEMA>;

  constructor() {
    this.gateway_id = crypto.randomUUID();
    this.request_data = undefined;
  }

  requisites(bank: FortaBank): FortaRequisites {
    let partial = (): Partial<FortaRequisites> => {
      switch (bank) {
        case "ANY":
          return { cardNumber: common.visaCard };
        case "SBP":
          return { receiverPhone: `+${common.phoneNumber}` };
        case "SBP_TG":
          return { receiverPhone: `+${common.phoneNumber}` };
        case "tpay":
          let base = "https://app-redir.wallet-expert.com";
          assert(this.request_data);
          let phone = `+${common.phoneNumber}`;

          let params = {
            amount: this.request_data.amount.toString(),
            account: phone,
            bank: "ru_tpay",
            fio: common.fullName,
            workflowType: "RTLNTransfer",
          };

          let url = new URL(base);
          url.search = new URLSearchParams(params).toString();
          return { qrCodeLink: String(url), receiverPhone: phone };
        default:
          assert.fail(`unhandled payment bank: ${bank}`);
      }
    };
    return { ...EMPTY_REQUISITES, ...partial() };
  }

  payment_response(status: FortaPaymentStatus, request: any) {
    this.request_data = PAYIN_REQUEST_SCHEMA.parse(request);
    console.log(this.request_data);

    let data = {
      amount: this.request_data.amount,
      currency: "RUB",
      paidAmount: 0,
      guid: this.gateway_id,
      orderId: this.request_data.orderId,
      paymentStartDate: "2026-01-21T09:42:21",
      status,
      merchantUrl: this.request_data.returnUrl,
      callbackUrl: this.request_data.callbackUrl,
      paymentUrl:
        "https://pay-form.wallet-expert.com/12675701-7454-85d9-ed74-9440a52876d9",
      bank: this.request_data.bank,
      receiverName: common.fullName,
      receiverBank: common.bankName,
      until: "",
      expires: "2026-01-21T10:02:19",
      reason: "",
      disputeAvailable: false,
      finalized: false,
      arbitrage: [],
      showHiddenFields: true,
      receiverBankLogo:
        "https://pt.wallet-expert.com/logo/412ab30d-f382-11ef-a096-0050568daab3.png",
      bgColor: "#54dbd1",
      formPaymentMethods: ["SBP_TG", "TPAY", "SPAY", "VTBPAY"],
      ChangedAmount: false,
      ...this.requisites(this.request_data.bank),
    };

    return success_response(data);
  }

  create_handler(status: FortaPaymentStatus): Handler {
    return async (c) =>
      c.json(this.payment_response(status, await c.req.json()));
  }

  static no_requisites_response() {
    return {
      status: false,
      data: "",
      error: "Произошла непредвиденная ошибка, обратитесь в службу поддержки",
    };
  }

  static no_requisites_handler(): Handler {
    return (c) => c.json(this.no_requisites_response(), 400);
  }

  /**
   * Forta callback payload
   */
  callback(status: FortaPaymentStatus, secret: string) {
    assert(this.request_data);
    let data: Record<string, any> = {
      ChangedAmount: false,
      formPaymentMethods: ["SBP_TG", "TPAY", "SPAY", "VTBPAY"],
      showHiddenFields: true,
      finalized: true,
      bgColor: "#54dbd1",
      receiverName: common.fullName,
      bank: this.request_data.bank,
      paymentUrl:
        "https://pay-form.wallet-expert.com/12675701-7454-85d9-ed74-9440a52876d9",
      receiverBank: common.bankName,
      disputeAvailable: true,
      reason: "",
      callbackUrl: "https://business.processinprocess.com/callback/forta",
      receiverBankLogo:
        "https://pt.wallet-expert.com/logo/412ab30d-f382-11ef-a096-0050568daab3.png",
      merchantUrl:
        "https://business.processinprocess.com/checkout_results/fxRcMbksRdDnrQDYAMgmpRdvCfCN8h9z/processing",
      status: status,
      paymentStartDate: "2026-01-21T09:42:21",
      until: "",
      guid: this.gateway_id,
      orderId: this.request_data.orderId,
      paidAmount: this.request_data.amount,
      arbitrage: [],
      expires: "",
      currency: "RUB",
      amount: this.request_data.amount,
      ...this.requisites(this.request_data.bank),
    };
    let signatureStr = `${data["orderId"]}${data["amount"]}${secret}`;
    let sign = crypto.createHash("md5").update(signatureStr).digest("hex");
    data["sign"] = sign;
    return data;
  }

  async send_callback(status: FortaPaymentStatus, secret: string) {
    assert(this.request_data);
    let payload = this.callback(status, secret);
    let url = this.request_data.callbackUrl;
    let curl = new CurlBuilder(url, "POST")
      .header("content-type", "application/json")
      .json_data(payload)
      .build();
    console.log("brusnkika callback", curl);
    return await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    }).then(err_bad_status);
  }

  static settings(secret: string) {
    return {
      bank_list: {
        default: "100000000111",
        ВТБ: "100000000005",
        Сбербанк: "100000000111",
        "Тинькофф Банк": "100000000004",
      },
      class: "forta",
      pay_methods_list: {
        any: "ANY",
        cards: "ANY",
        default: "SBP_TG",
        sbp: "SBP",
        sbp_tg: "SBP_TG",
        tpay: "tpay",
      },
      token: secret,
    };
  }

  static mock_params(secret: string): MockProviderParams {
    return {
      alias: "forta_payment",
      filter_fn: (req) => {
        return req.header("authorization") === `Token ${secret}`;
      },
    };
  }
}

export function payinSuite(currency = "RUB"): P2PSuite<FortaPayment> {
  let gw = new FortaPayment();
  let statusMap: Record<PrimeBusinessStatus, FortaPaymentStatus> = {
    approved: "PAID",
    declined: "CANCELED",
    pending: "INPROGRESS",
  };
  return {
    type: "payin",
    send_callback: async (status, secret) => {
      await gw.send_callback(statusMap[status], secret);
    },
    create_handler: (s) => gw.create_handler(statusMap[s]),
    mock_options: FortaPayment.mock_params,
    request: () => common.p2pPaymentRequest(currency, "card"),
    settings: (secret) => FortaPayment.settings(secret),
    status_handler: (s) => {
      // Forta doesn't have a native status handler, return create_handler as status
      return gw.create_handler(statusMap[s]);
    },
    no_requisites_handler: () => FortaPayment.no_requisites_handler(),
    gw,
  };
}
