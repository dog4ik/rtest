import * as common from "@/common";
import { assert, describe } from "vitest";
import { providers } from "@/settings_builder";
import { BestpayPayout, type OperationStatus } from "@/provider_mocks/bestpay";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  statusFinalizationSuite,
  type Callback,
  type Status,
} from "@/suite_interfaces";
import type { PrimeBusinessStatus } from "@/db/business";
import { CONFIG } from "@/config";

const CURRENCY = "BDT";

function bestpaySuite() {
  const statusMap: Record<PrimeBusinessStatus, OperationStatus> = {
    approved: "Approved",
    pending: "Pending",
    declined: "Declined",
  };
  let gw = new BestpayPayout();
  return {
    settings(secret) {
      return providers(CURRENCY, BestpayPayout.settings(secret));
    },
    status_handler(status) {
      return gw.status_handler(statusMap[status]);
    },
    create_handler(status) {
      return gw.create_handler(statusMap[status]);
    },
    async send_callback(status, secret) {
      return await gw.send_callback(statusMap[status], secret);
    },
    request() {
      return {
        ...common.payoutRequest(CURRENCY),
        bank_account: {
          account_holder: common.fullName,
          account_number: common.accountNumber,
        },
        extra_return_param: "ROCKET",
      };
    },
    type: "payout",
    mock_options: BestpayPayout.mock_options,
    gw,
  } satisfies Callback & Status & { gw: BestpayPayout };
}

describe
  .runIf(CONFIG.in_project(["reactivepay", "8pay"]))
  .concurrent("best payout test", () => {
    dataFlowTest("default bank mapping", {
      ...bestpaySuite(),
      settings(secret) {
        return providers(CURRENCY, {
          ...BestpayPayout.settings(secret),
          bank_code: {
            OkWallet: 2006,
            ROCKET: 2002,
          },
        });
      },
      after_create_check() {
        let req = this.gw.request_data;
        assert.strictEqual(req?.Details.BankCode, "2002");
        assert.strictEqual(req?.Details.AccountName, common.fullName);
        assert.strictEqual(req?.Details.AccountNo, common.accountNumber);
        assert.strictEqual(req?.Currency, CURRENCY);
      },
    });

    statusFinalizationSuite(bestpaySuite);
    callbackFinalizationSuite(bestpaySuite);
  });
