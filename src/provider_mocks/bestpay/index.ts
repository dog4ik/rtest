import crypto from "node:crypto";
import { assert } from "vitest";
import * as sign from "./signature";
import * as encoding from "@std/encoding";
import { z } from "zod";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import { err_bad_status } from "@/fetch_utils";

export type OperationStatus = "Pending" | "Approved" | "Declined";

const StatusCodeMap: Record<OperationStatus, number> = {
  Pending: 1,
  Approved: 2,
  Declined: 3,
} as const;

const RequestDataSchema = z.object({
  MerchantOrderNo: z.string().length(32),
  MerchantNo: z.string(),
  Amount: z.float64(),
  Currency: z.string().length(3),
  CallBackURL: z.string(),
  PayOutMethod: z.string().optional(),
  Details: z.object({
    ClientIP: z.string(),
    AccountNo: z.string(),
    AccountName: z.string(),
    BankCode: z.coerce.string(),
  }),
});

export class BestpayPayout {
  gateway_id: string;
  request_data?: z.infer<typeof RequestDataSchema>;

  constructor() {
    this.gateway_id = crypto.randomBytes(16).toString("hex");
    this.request_data = undefined;
  }

  callback(status: OperationStatus) {
    assert(this.request_data);

    return {
      BPOrderNo: this.gateway_id,
      MerchantOrderNo: this.request_data.MerchantOrderNo,
      // WARN: Provider docs incorrectly say that status should be int.
      // Int does not play well with RP. So we use string here
      Status: StatusCodeMap[status].toString(),
      Remarks: "Target Account Number is not a Bangladesh phone number.",
      Amount: this.request_data.Amount,
      AccountNo: this.request_data.Details.AccountNo,
      AccountName: this.request_data.Details.AccountName,
      AccountIFSC: "",
      BankCode: this.request_data.Details.BankCode,
      VPA: "",
      UTR: "SPPTID1297416",
    };
  }

  async send_callback(status: OperationStatus, secret: string) {
    assert(this.request_data);
    const payload = this.callback(status);
    let body = JSON.stringify(payload);
    let signature = sign.calculateSignature(
      {
        method: "POST",
        url: this.request_data.CallBackURL,
        body,
      },
      encoding.encodeBase64(secret),
    );
    console.log("callback body", JSON.stringify(payload, null, 2));
    await fetch(this.request_data.CallBackURL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        HMacAuthorization: `hmacauth ${signature}`,
      },
      body,
    }).then(err_bad_status);
  }

  status_response(status: OperationStatus) {
    assert(this.request_data, "request data can't be nil");

    return {
      Message: "Data Received successfully",
      Status: true,
      Data: {
        MerchantOrderNo: this.request_data.MerchantOrderNo,
        StatusId: StatusCodeMap[status].toString(),
        Status: status,
        Notes: "Target Account Number is not a Bangladesh phone number.",
        VPA: "",
        MerchantNo: "BP0186",
        Amount: this.request_data.Amount,
        Fees: "1.01",
        UTR: "SPPTID1297416",
      },
    };
  }

  error_handler(): Handler {
    return (c) =>
      c.json({ Message: "There is some error", Status: false, Data: null });
  }

  status_handler(status: OperationStatus): Handler {
    return (c) => c.json(this.status_response(status));
  }

  create_response(_: OperationStatus, request: any) {
    this.request_data = RequestDataSchema.parse(request);
    return {
      Message: "Data Received successfully",
      Status: true,
      Data: {
        BPOrderNo: this.gateway_id,
        MerchantOrderNo: this.request_data.MerchantOrderNo,
        Amount: this.request_data.Amount,
        Fee: 1.0,
        RequestSuccessTime: new Date().getTime(),
        PayURL: null,
        Details: {
          ClientIP: "127.0.0.1",
          AccountNo: null,
          AccountName: null,
          AccountIFSC: null,
          BankCode: null,
          BankName: null,
          BankType: null,
          QRLink: null,
          UPILink: null,
          QR: null,
          QRImage: null,
          VPA: null,
          BankId: null,
          UTR: null,
          UpiId: null,
          MerchantNotes: null,
          BankProvince: null,
          BankCity: null,
          BankBranch: null,
          BankBranchCode: null,
          PRefId: null,
          Phone: null,
          Memo: null,
          BankAddress: null,
          AccountType: null,
          BranchName: null,
        },
        ReceiverDetails: null,
        SuccessURL: "https://bpglobalfav.live/Pay/Success",
        FailureURL: "https://bpglobalfav.live/Pay/Failure",
      },
    };
  }

  create_handler(status: OperationStatus): Handler {
    return async (c) =>
      c.json(this.create_response(status, await c.req.json()));
  }

  static settings(secret: string) {
    return {
      account_name: "TestAccount",
      api_id: secret,
      bank_code: {
        BKASH: 2001,
        NAGAD: 2004,
        OkWallet: 2006,
        ROCKET: 2002,
        TAP: 2005,
        UPPAY: 2003,
      },
      bdt: true,
      class: "bestpay",
      merchant_no: secret,
      token: encoding.encodeBase64(secret),
    };
  }

  static mock_options(secret: string): MockProviderParams {
    return {
      alias: "bestpay_payment",
      filter_fn: async (c) => {
        return c.header("merchantno") === secret;
      },
    };
  }
}
