import * as common from "@/common";
import { z } from "zod";
import { assert } from "vitest";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import { err_bad_status } from "@/fetch_utils";
import { CurlBuilder } from "@/story/curl";

const METHOD_SCHEMA = z.enum(["CARDNUM", "PHONE", "SBP"]);

export type MadsolutionMethod = z.infer<typeof METHOD_SCHEMA>;

export type MadsolutionStatus =
  | "PENDING"
  | "EXPIRED"
  | "CONFIRMED"
  | "CANCELED";

export type MadsolutionAppealStatus =
  | "OPEN"
  | "CLOSED"
  | "WITHDRAWN"
  | "REJECTED"
  | "APPROVED"
  | "APPROVED_WITH_MODIFICATION";

const PAYIN_REQUEST_SCHEMA = z.object({
  trafficTypeCode: METHOD_SCHEMA,
  amount: z.number(),
  externalId: z.string(),
  externalClientId: z.string(),
});

function appealStatusObject(type: MadsolutionAppealStatus) {
  const map = {
    OPEN: { Id: 1, Code: "OPEN", Name: "Открыта" },
    CLOSED: { Id: 2, Code: "CLOSED", Name: "Закрыта" },
    WITHDRAWN: { Id: 3, Code: "WITHDRAWN", Name: "Отозвана" },
    REJECTED: { Id: 4, Code: "REJECTED", Name: "Отклонена" },
    APPROVED: { Id: 5, Code: "APPROVED", Name: "Принята" },
    APPROVED_WITH_MODIFICATION: {
      Id: 6,
      Code: "APPROVED_WITH_MODIFICATION",
      Name: "Принята с изменением суммы заявки",
    },
  } as const;

  const obj = map[type];
  if (!obj) assert.fail(`unrecognized appeal status: ${type}`);
  return obj;
}

function appealStatusObjectLowercase(type: MadsolutionAppealStatus) {
  const map = {
    OPEN: { id: 1, code: "OPEN", name: "Открыта" },
    CLOSED: { id: 2, code: "CLOSED", name: "Закрыта" },
    WITHDRAWN: { id: 3, code: "WITHDRAWN", name: "Отозвана" },
    REJECTED: { id: 4, code: "REJECTED", name: "Отклонена" },
    APPROVED: { id: 5, code: "APPROVED", name: "Принята" },
    APPROVED_WITH_MODIFICATION: {
      id: 6,
      code: "APPROVED_WITH_MODIFICATION",
      name: "Принята с изменением суммы заявки",
    },
  } as const;

  const obj = map[type];
  if (!obj) assert.fail(`unrecognized appeal status: ${type}`);
  return obj;
}

/**
 * Status object has uppercase letters in callback
 */
function statusObject(status: MadsolutionStatus) {
  const map = {
    PENDING: { Id: 1, Code: "PENDING", Name: "Ожидает подтверждения" },
    EXPIRED: { Id: 2, Code: "EXPIRED", Name: "Вышло время ожидания" },
    CONFIRMED: { Id: 3, Code: "CONFIRMED", Name: "Подтверждена" },
    CANCELED: { Id: 4, Code: "CANCELED", Name: "Отменена" },
  } as const;

  const obj = map[status];
  if (!obj) assert.fail(`unrecognized status type: ${status}`);
  return obj;
}

function statusObjectLowercase(status: MadsolutionStatus) {
  const map = {
    PENDING: { id: 1, code: "PENDING", name: "Ожидает подтверждения" },
    EXPIRED: { id: 2, code: "EXPIRED", name: "Вышло время ожидания" },
    CONFIRMED: { id: 3, code: "CONFIRMED", name: "Подтверждена" },
    CANCELED: { id: 4, code: "CANCELED", name: "Отменена" },
  } as const;

  const obj = map[status];
  if (!obj) assert.fail(`unrecognized status type: ${status}`);
  return obj;
}

function trafficType(type: MadsolutionMethod) {
  const map = {
    CARDNUM: { id: 1, code: "CARDNUM", name: "По номеру карты" },
    PHONE: { id: 2, code: "PHONE", name: "По номеру телефона" },
    SBP: { id: 3, code: "SBP", name: "Через систему быстрых платежей" },
  } as const;

  const obj = map[type];
  if (!obj) assert.fail(`unrecognized traffic type: ${type}`);
  return obj;
}

function cardInfo(method: MadsolutionMethod) {
  let bank = {
    id: 13,
    code: "OZON",
    name: "Ozon Банк",
    countryId: 1,
  };

  if (method == "CARDNUM") {
    return {
      bank,
      cardNumber: common.visaCard,
      phoneNumber: null,
      holderName: "Николай Олегович С",
    };
  } else if (method === "PHONE" || method === "SBP") {
    return {
      bank,
      cardNumber: null,
      phoneNumber: common.phoneNumber,
      holderName: "Николай Олегович С",
    };
  } else {
    assert.fail(`unknown madsolution payment method: ${method}`);
  }
}

const CALLBACK_URL = "http://127.0.0.1:4000/callback/madsolution";

export class MadsolutionPayment {
  gateway_id: string;
  changed_amount?: number;
  request_data?: z.infer<typeof PAYIN_REQUEST_SCHEMA>;
  dispute_data?: { dispute_id: string };

  constructor() {
    this.gateway_id = crypto.randomUUID();
  }

  private positive_response(status: MadsolutionStatus) {
    if (!this.request_data) {
      throw new Error("request_data is missing");
    }

    return {
      externalId: this.request_data.externalId,
      externalClientId: this.request_data.externalClientId,
      amount: this.changed_amount ?? this.request_data.amount,
      currency: {
        id: 1,
        code: "RUB",
        nameEng: "Russian ruble",
        nameRus: "Российский рубль",
      },
      cardInfo: cardInfo(this.request_data.trafficTypeCode),
      paymentInfo: {
        sourceAmount: this.changed_amount ?? this.request_data.amount,
        sourceCurrency: {
          id: 1,
          code: "RUB",
          nameEng: "Russian ruble",
          nameRus: "Российский рубль",
        },
        exchangeRate: 79.596,
        targetCurrency: {
          id: 2,
          code: "USDT",
          nameEng: "Tether USDT",
          nameRus: "Tether USDT",
        },
        grossAmount: 0.188452,
        feeRate: 10.5,
        feeAmount: 0.019787,
        netAmount: 0.168664,
      },
      id: this.gateway_id,
      status: statusObjectLowercase(status),
      trafficType: trafficType(this.request_data.trafficTypeCode),
      createdAtUtc: "2025-12-15T16:57:44.256722Z",
      updatedAtUtc: "2025-12-15T16:57:44.256722Z",
      expiresAtUtc: "2025-12-15T17:07:44.256722Z",
      appealId: null,
    };
  }

  payment_response(status: MadsolutionStatus, request: any) {
    this.request_data = PAYIN_REQUEST_SCHEMA.parse(request);
    let response = this.positive_response(status);
    return { ...response, requestedAmount: request.amount };
  }

  create_handler(status: MadsolutionStatus): Handler {
    return async (c) =>
      c.json(this.payment_response(status, await c.req.json()), 201);
  }

  status_response(status: MadsolutionStatus) {
    return this.positive_response(status);
  }

  status_handler(status: MadsolutionStatus): Handler {
    return (c) => c.json(this.status_response(status));
  }

  dispute_response(status: MadsolutionAppealStatus) {
    assert(
      this.request_data,
      "operation data can't be constructed without request",
    );

    if (status === "OPEN") {
      this.dispute_data = { dispute_id: crypto.randomUUID() };
    }

    return {
      id: this.dispute_data!.dispute_id,
      orderId: this.gateway_id,
      status: appealStatusObjectLowercase(status),
      createdAtUtc: "2025-12-16T12:00:39.8636369Z",
      updatedAtUtc: "2025-12-16T12:00:39.8636369Z",
    };
  }

  dispute_status_handler(status: MadsolutionAppealStatus): Handler {
    return (c) => c.json(this.dispute_response(status), 200);
  }

  create_dispute_handler(): Handler {
    return async (c) => {
      let dispute_data = await c.req.parseBody();
      console.log("DISPUTE DATA", dispute_data);
      return c.json(this.dispute_response("OPEN"), 201);
    };
  }

  callback(status: MadsolutionStatus) {
    return {
      Event: "ORDER_CONFIRMED",
      Order: {
        ExternalId: this.request_data!.externalId,
        Amount: this.changed_amount ?? this.request_data!.amount,
        PaymentInfo: {},
        Id: this.gateway_id,
        Status: statusObject(status),
      },
      Timestamp: "2025-06-03T14:05:21.2824128Z",
    };
  }

  async send_callback(status: MadsolutionStatus) {
    let cb = this.callback(status);
    console.log(
      "Madsolution callback",
      new CurlBuilder(CALLBACK_URL, "POST").json_data(cb).build(),
    );
    return await fetch(CALLBACK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cb),
    }).then(err_bad_status);
  }

  dispute_callback(status: MadsolutionAppealStatus) {
    assert(this.dispute_data, "dispute should be created first");

    return {
      Event: "APPEAL_APPROVED",
      Appeal: {
        OriginalOrderAmount: this.request_data!.amount,
        ModifiedOrderAmount: null,
        Id: this.dispute_data.dispute_id,
        OrderId: this.gateway_id,
        Status: appealStatusObject(status),
        CreatedAtUtc: "2025-12-15T14:56:11.21512Z",
        UpdatedAtUtc: "2025-12-15T14:56:43.196974Z",
      },
      Timestamp: "2025-12-15T14:56:48.8682073Z",
    };
  }

  async send_dispute_callback(status: MadsolutionAppealStatus) {
    let payload = this.dispute_callback(status);
    console.log(
      "Madsolution dispute callback",
      new CurlBuilder(CALLBACK_URL, "POST").json_data(payload).build(),
    );
    return await fetch(CALLBACK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(err_bad_status);
  }

  async appeal_already_exists_response() {
    assert(this.dispute_data);
    return {
      type: "https://tools.ietf.org/html/rfc7231#section-6.5.8",
      title: "Conflict",
      status: 409,
      errors: [
        {
          code: "Order.AlreadyHasAppeal",
          message: ` ${this.dispute_data?.dispute_id}, , .`,
          type: 3,
        },
      ],
    };
  }

  appeal_already_exists_handler(): Handler {
    return (c) => c.json(this.appeal_already_exists_response(), 409);
  }

  static settings(secret: string) {
    return {
      api_key: secret,
      class: "madsolution",
    };
  }

  static mock_params(secret: string): MockProviderParams {
    return {
      alias: "madsolution",
      filter_fn(req) {
        let auth = req.header("authorization");
        if (!auth) return false;
        let token = auth.replace(/^Bearer /, "");
        return token === secret;
      },
    };
  }

  static no_requisites_response() {
    return {
      type: "https://tools.ietf.org/html/rfc7231#section-6.5.4",
      title: "Not Found",
      status: 404,
      errors: [
        {
          code: "Order.NoAvailableCard",
          message: "Нет доступной карты, по которой можно создать заявку.",
          type: 2,
        },
      ],
    };
  }

  static no_requisites_handler(): Handler {
    return (c) => {
      c.status(404);
      return c.json(MadsolutionPayment.no_requisites_response());
    };
  }
}
