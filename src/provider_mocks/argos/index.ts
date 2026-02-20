import { z } from "zod";
import { createSignature, decryptAES128, buildSignatureInput } from "./sign";
import { err_bad_status } from "@/fetch_utils";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import { assert } from "vitest";
import * as common from "@/common";
import { CurlBuilder } from "@/story/curl";
import type { PrimeBusinessStatus } from "@/db/business";
import type { P2PSuite } from "@/suite_interfaces";

const PAYMENT_MODE_SCHEMA = z.enum(["V2C"]);

export type ArgosPaymentMethod = z.infer<typeof PAYMENT_MODE_SCHEMA>;

const ArgosStatusMap = {
  declined: 0,
  approved: 1,
  pending: 2,
  cancel: 4,
} as const;

export type ArgosPaymentStatus = keyof typeof ArgosStatusMap;

const MERCHANT_KEY = "fd750b1b8e3d0147";

const PAYIN_REQUEST_SCHEMA = z.object({
  mId: z.string(),
  maId: z.string(),
  userName: z.string(),
  password: z.string(),
  remoteIP: z.string(),
  paymentMode: PAYMENT_MODE_SCHEMA,
  metaData: z.object({
    merchantUserId: z.string(),
    bankName: z.string(),
  }),
  txDetails: z.object({
    apiVersion: z.string(),
    requestId: z.string(),
    orderData: z.object({
      orderId: z.string(),
      orderDescription: z.string(),
      amount: z.coerce.number(),
      currencyCode: z.string(),
      billingAddress: z.object({
        email: z.email(),
      }),
    }),
    notificationUrl: z.url(),
  }),
  signature: z.string(),
});

const STATUS_REQUSET_SCHEMA = z.object({
  apiVersion: z.literal("1.0.1"),
  mId: z.string(),
  maId: z.string(),
  userName: z.string(),
  password: z.string(),
  txId: z.uuidv4(),
});

type RequestData = z.infer<typeof PAYIN_REQUEST_SCHEMA>;

export class ArgosPayment {
  gateway_id: string;
  request_data?: RequestData;

  constructor() {
    this.gateway_id = crypto.randomUUID();
    this.request_data = undefined;
  }

  payment_response(status: ArgosPaymentStatus, request: any) {
    this.request_data = PAYIN_REQUEST_SCHEMA.parse(request);
    return this.status_response(status);
  }

  create_handler(status: ArgosPaymentStatus): Handler {
    return async (c) => {
      assert.strictEqual(c.req.path, "/FE/rest/tx/sync/purchase");
      setTimeout(() => this.send_callback(status), 20);
      return c.json(this.payment_response(status, await c.req.json()));
    };
  }

  status_response(status: ArgosPaymentStatus) {
    assert(this.request_data);

    let result =
      status === "declined"
        ? {
            resultCode: "0",
            resultMessage: "Transaction failed.",
            errorId: null,
            error: [
              {
                errorCode: "650",
                errorMessage:
                  "ACQUIRER_ERROR: Transaction has been denied by acquirer.",
                advice: "Please contact gateway customer service.",
              },
            ],
            reasonCode: "650",
          }
        : {
            resultCode: ArgosStatusMap[status].toString(),
            resultMessage:
              "Transaction was successfully received and is now queued for transmission to the provider.",
            errorId: null,
            error: null,
            reasonCode: "3",
          };

    let card_number = () => {
      if (
        status !== "declined" &&
        this.request_data?.metaData.bankName !== "SBP"
      )
        return common.visaCard;
      return null;
    };

    let meta = () => {
      if (status === "declined") {
        return {
          isShowResultMsgScreen: false,
        };
      }
      if (this.request_data?.metaData.bankName === "SBP") {
        return {
          holderName: common.fullName,
          phoneNumber: `+${common.phoneNumber}`,
          bankName: common.bankName,
        };
      } else {
        return {
          destCCHolderName: common.fullName,
          bankName: common.bankName,
          isShowResultMsgScreen: false,
        };
      }
    };

    let data = {
      responseTime: "2026-02-18 11:03:13",
      result,
      signature: "",
      metaData: meta(),
      txId: this.gateway_id,
      txTypeId: "3",
      txType: "PURCHASE",
      recurrentTypeId: "1",
      requestId: this.request_data.txDetails.requestId,
      orderId: this.request_data.txDetails.orderData.orderId,
      sourceAmount: {
        amount: this.request_data.txDetails.orderData.amount.toString(),
        currencyCode: this.request_data.txDetails.orderData.currencyCode,
      },
      amount: {
        amount: this.request_data.txDetails.orderData.amount,
        currencyCode: this.request_data.txDetails.orderData.currencyCode,
      },
      returnUrl: null,
      cancelUrl: null,
      ccNumber: null,
      cardId: null,
      destCCNumber: card_number(),
      redirect3DUrl: null,
      payUrl: null,
    };
    data["signature"] = createSignature(
      buildSignatureInput(data),
      MERCHANT_KEY,
    );
    return data;
  }

  status_handler(status: ArgosPaymentStatus): Handler {
    return async (c) => {
      assert.strictEqual(c.req.method, "POST");
      assert.strictEqual(c.req.path, "/FE/rest/tx/getStatus");
      let req = STATUS_REQUSET_SCHEMA.parse(await c.req.json());
      assert.strictEqual(req.txId, this.gateway_id);
      return c.json(this.status_response(status));
    };
  }

  no_requisites_handler(): Handler {
    return this.create_handler("declined");
  }

  /**
   * Argos callback payload
   */
  callback(status: ArgosPaymentStatus) {
    return this.status_response(status);
  }

  async send_callback(status: ArgosPaymentStatus) {
    assert(this.request_data);
    let payload = this.callback(status);
    let url = this.request_data.txDetails.notificationUrl;
    let curl = new CurlBuilder(url, "POST")
      .header("content-type", "application/json")
      .json_data(payload)
      .build();
    console.log("argos callback", curl);
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
      class: "argospay",
      merchant_account_id: secret,
      merchant_id: secret,
      merchant_key: MERCHANT_KEY,
      password: secret,
      user_name: secret,
      // argos should work in 8pay format everywhere
      wrapped_to_json_response: true,
    };
  }

  static mock_params(secret: string): MockProviderParams {
    return {
      alias: "argospay",
      filter_fn: async (req) => {
        let json = await req.json();
        let pass = json["password"];
        console.log({ pass });
        let decrypted = decryptAES128(pass, MERCHANT_KEY);
        console.log({ decrypted });
        return decrypted === secret;
      },
    };
  }
}

export function payinSuite(currency = "RUB"): P2PSuite<ArgosPayment> {
  let gw = new ArgosPayment();
  let statusMap: Record<PrimeBusinessStatus, ArgosPaymentStatus> = {
    approved: "approved",
    declined: "declined",
    pending: "pending",
  };
  return {
    type: "payin",
    send_callback: async (status, _) => {
      await gw.send_callback(statusMap[status]);
    },
    create_handler: (s) => gw.create_handler(statusMap[s]),
    mock_options: ArgosPayment.mock_params,
    request: () => common.p2pPaymentRequest(currency, "card"),
    settings: ArgosPayment.settings,
    status_handler: (s) => gw.status_handler(statusMap[s]),
    no_requisites_handler: () => gw.no_requisites_handler(),
    gw,
  };
}
