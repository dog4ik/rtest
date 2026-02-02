import type { Handler, MockProviderParams } from "@/mock_server/api";
import * as common from "@/common";
import { assert } from "vitest";
import { z } from "zod";
import type { PrimeBusinessStatus } from "@/db/business";
import { CONFIG } from "@/test_context";

type TbankStatus =
  | "NEW"
  | "AUTHORIZING"
  | "UNKNOWN"
  | "CHECKING"
  | "CREDIT_CHECKING"
  | "COMPLETING"
  | "REJECTED"
  | "CHECKED"
  | "COMPLETED";

const TbankStatusMap: Record<PrimeBusinessStatus, TbankStatus> = {
  approved: "COMPLETED",
  pending: "UNKNOWN",
  declined: "REJECTED",
};

const TerminalAuthSchema = {
  TerminalKey: z.string(),
  DigestValue: z.base64(),
  SignatureValue: z.base64(),
  X509SerialNumber: z.coerce.string(),
};

const CheckCustomerParamsSchema = z.object({
  CustomerKey: z.string(),
  ...TerminalAuthSchema,
});

const GetSbpMembersParamsSchema = z.object({
  ...TerminalAuthSchema,
});

const AddCustomerParamsSchema = z.object({
  Email: z.email(),
  CustomerKey: z.string(),
  ...TerminalAuthSchema,
});

const AddCardParamsSchema = z.object({
  CheckType: z.literal("NO"),
  CustomerKey: z.string(),
  ...TerminalAuthSchema,
});

const AttachCardParamsSchema = z.object({
  RequestKey: z.string(),
  CardData: z.base64(),
  ...TerminalAuthSchema,
});

const InitCardRequestSchema = z.object({
  OrderId: z.string(),
  Amount: z.number(),
  CardId: z.string(),
  ...TerminalAuthSchema,
});

const InitSbpRequestSchema = z.object({
  OrderId: z.string().length(32),
  Amount: z.number().min(1),
  PhoneNumber: z.string().min(1),
  SbpMemberId: z.string().min(1),
  ...TerminalAuthSchema,
});

const PayoutParamsSchema = z.object({
  PaymentId: z.string(),
  ...TerminalAuthSchema,
});

const RemoveCardParamsSchema = z.object({
  CustomerKey: z.string(),
  CardId: z.string(),
  ...TerminalAuthSchema,
});

const GetStatusParamsSchema = z.object({
  PaymentId: z.string(),
  ...TerminalAuthSchema,
});

function randomNumId() {
  return Math.floor(Math.random() * Math.pow(10, 10)).toString();
}

export class TbankPayout {
  gateway_id: string;
  check_customer_params?: z.infer<typeof CheckCustomerParamsSchema>;
  get_sbp_members?: z.infer<typeof GetSbpMembersParamsSchema>;
  add_customer_params?: z.infer<typeof AddCustomerParamsSchema>;
  add_card_params?: z.infer<typeof AddCardParamsSchema>;
  attach_card_params?: z.infer<typeof AttachCardParamsSchema>;
  init_card_request_params?: z.infer<typeof InitCardRequestSchema>;
  init_sbp_request_params?: z.infer<typeof InitSbpRequestSchema>;
  payout_request_params?: z.infer<typeof PayoutParamsSchema>;
  remove_card_schema?: z.infer<typeof RemoveCardParamsSchema>;
  get_status_schema?: z.infer<typeof GetStatusParamsSchema>;

  customer?: { email: string; phone: string };
  card?: { id: string };

  constructor() {
    this.gateway_id = randomNumId();
  }

  ok_res<T>(val: T) {
    return {
      Success: true,
      ErrorCode: "0",
      TerminalKey: "1762332910910E2CDEMO",
      ...val,
    };
  }

  bad_res(code: number, message?: string, details?: string) {
    return {
      Success: false,
      ErrorCode: code.toString(),
      Message: message ?? "Fallback test error message",
      Details: details ?? "Fallback test details message",
    };
  }

  check_customer_handler(): Handler {
    return async (c) => {
      assert.strictEqual(c.req.path, "/e2c/v2/GetCustomer");
      this.check_customer_params = CheckCustomerParamsSchema.parse(
        await c.req.json(),
      );
      if (this.customer) {
        return c.json(
          this.ok_res({
            CustomerKey: this.check_customer_params.CustomerKey,
            Email: "test13@test.test",
            Phone: "10001234567",
          }),
        );
      } else {
        return c.json(
          this.bad_res(
            7,
            "Неверный статус покупателя.",
            "Покупатель не найден.",
          ),
        );
      }
    };
  }

  add_customer_handler(): Handler {
    return async (c) => {
      assert.strictEqual(c.req.path, "/e2c/v2/AddCustomer");
      this.add_customer_params = AddCustomerParamsSchema.parse(
        await c.req.json(),
      );

      this.customer = {
        email: this.add_customer_params.Email,
        phone: common.phoneNumber,
      };

      return c.json({
        Success: true,
        ErrorCode: "0",
        TerminalKey: "1762332910910E2CDEMO",
        CustomerKey: "esattuhaesohuaso@test.test",
      });
    };
  }

  get_sbp_members_handler(): Handler {
    return async (c) => {
      assert.strictEqual(c.req.path, "/a2c/sbp/GetSbpMembers");
      return c.json({
        Success: true,
        ErrorCode: "0",
        Members: [
          {
            MemberId: "100000000233",
            MemberName: "NK Bank",
            MemberNameRus: "НК Банк",
          },
          {
            MemberId: "100000000129",
            MemberName: "CB ARESBANK",
            MemberNameRus: "КБ АРЕСБАНК",
          },
        ],
      });
    };
  }

  add_card_handler(): Handler {
    return async (c) => {
      assert.strictEqual(c.req.path, "/e2c/v2/AddCard");
      this.add_card_params = AddCardParamsSchema.parse(await c.req.json());
      this.card = { id: randomNumId() };
      return c.json(
        this.ok_res({
          PaymentURL: "1110a78d-5995-432a-a206-d530a9216973",
          RequestKey: "a0e7a14c-41dc-4246-8a50-a03167fde936",
        }),
      );
    };
  }

  attach_card_handler(): Handler {
    return async (c) => {
      assert.strictEqual(c.req.path, "/e2c/v2/AttachCard");
      this.attach_card_params = AttachCardParamsSchema.parse(
        await c.req.json(),
      );
      this.card = { id: randomNumId() };
      return c.json(
        this.ok_res({
          RequestKey: "a0e7a14c-41dc-4246-8a50-a03167fde936",
          CustomerKey: "test13@test.test",
          CardId: this.card.id,
        }),
      );
    };
  }

  init_card_handler(): Handler {
    return async (c) => {
      assert.strictEqual(c.req.path, "/e2c/v2/Init");
      this.init_card_request_params = InitCardRequestSchema.parse(
        await c.req.json(),
      );
      assert(this.card);
      return c.json(
        this.ok_res({
          Status: "CHECKED",
          PaymentId: this.gateway_id,
          OrderId: this.init_card_request_params.OrderId,
          Amount: this.init_card_request_params.Amount,
          CardId: this.card.id,
        }),
      );
    };
  }

  init_sbp_handler(): Handler {
    return async (c) => {
      assert.strictEqual(c.req.path, "/a2c/sbp/Init");
      this.init_sbp_request_params = InitSbpRequestSchema.parse(
        await c.req.json(),
      );
      return c.json(
        this.ok_res({
          Status: "CHECKED",
          PaymentId: this.gateway_id,
          OrderId: this.init_sbp_request_params.OrderId,
          Amount: this.init_sbp_request_params.Amount,
          Currency: "643",
        }),
      );
    };
  }

  payout_card_handler(status: PrimeBusinessStatus): Handler {
    return async (c) => {
      assert.strictEqual(c.req.path, "/e2c/v2/Payment");
      this.payout_request_params = PayoutParamsSchema.parse(await c.req.json());
      assert(this.init_card_request_params);
      return c.json({
        Success: true,
        ErrorCode: status === "declined" ? "1057" : "0",
        Message: "Покупатель запретил такие операции для своей карты",
        TerminalKey: "1762332910910E2CDEMO",
        Status: TbankStatusMap[status],
        PaymentId: this.gateway_id,
        OrderId: this.init_card_request_params.OrderId,
      });
    };
  }

  payout_sbp_handler(status: PrimeBusinessStatus): Handler {
    return async (c) => {
      assert.strictEqual(c.req.path, "/a2c/sbp/Payment");
      this.payout_request_params = PayoutParamsSchema.parse(await c.req.json());
      assert(this.init_sbp_request_params);
      return c.json({
        Success: true,
        ErrorCode: status === "declined" ? "1057" : "0",
        Message:
          status === "declined"
            ? "Покупатель запретил такие операции для своей карты"
            : undefined,
        TerminalKey: "1762332910910E2CDEMO",
        Status: TbankStatusMap[status],
        PaymentId: this.gateway_id,
        OrderId: this.init_sbp_request_params.OrderId,
      });
    };
  }

  remove_card_handler(): Handler {
    return async (c) => {
      assert.strictEqual(c.req.path, "/e2c/v2/RemoveCard");
      this.remove_card_schema = RemoveCardParamsSchema.parse(
        await c.req.json(),
      );
      assert(this.card);
      assert(this.customer);
      return c.json({
        Success: true,
        ErrorCode: "0",
        TerminalKey: "1762332910910E2CDEMO",
        CustomerKey: this.customer.email,
        CardId: this.card.id,
        Status: "D",
        CardType: 1,
      });
    };
  }

  status_handler(status: PrimeBusinessStatus): Handler {
    return async (c) => {
      this.get_status_schema = GetStatusParamsSchema.parse(await c.req.json());
      assert(this.customer);
      let request_params =
        this.init_card_request_params || this.init_sbp_request_params;
      assert(request_params);
      return c.json({
        Success: true,
        ErrorCode: "0",
        TerminalKey: "1762332910910E2CDEMO",
        Status: TbankStatusMap[status],
        PaymentId: this.gateway_id,
        OrderId: request_params.OrderId,
      });
    };
  }

  custom_error_handler(
    code: number,
    message?: string,
    details?: string,
  ): Handler {
    return async (c) => {
      return c.json(this.bad_res(code, message, details));
    };
  }

  invalid_params_handler(): Handler {
    return async (c) => {
      return c.json({
        Success: false,
        ErrorCode: "9999",
        Message: "Неверные параметры.",
        Details: "Телефон должен приводиться к виду ^\\d{11}$",
      });
    };
  }

  shop_blocked_error_handler(): Handler {
    return async (c) => {
      return c.json({
        Success: false,
        ErrorCode: "648",
        Message:
          "Магазин заблокирован или еще не активирован. Обратитесь в поддержку, чтобы уточнить детали",
        Details: "submerchant_id заблокирован",
      });
    };
  }

  static settings(secret: string) {
    return {
      certificate: CONFIG.dummyCert(),
      class: "tbank",
      customer_key: "TestCustomer20",
      password: secret,
      private_key: CONFIG.dummyRsa(),
      public_key: CONFIG.dummyRsaPub(),
      terminal_key: secret,
    };
  }

  static mock_params(secret: string): MockProviderParams {
    return {
      alias: "tbank",
      filter_fn: async (req) => {
        try {
          let body = await req.json();
          return body.TerminalKey == secret;
        } catch {
          return false;
        }
      },
    };
  }
}
