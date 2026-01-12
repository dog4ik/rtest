import type { OperationType } from "@/db/business";

export function constructCurlRequest(
  request: Record<string, unknown>,
  private_key: string,
  operation_type: OperationType,
): string {
  let suffix = () => {
    if (operation_type === "pay") return "payments";
    else if (operation_type === "payout") return "payouts";
    else if (operation_type === "refund") return "refunds";
  };

  const json = JSON.stringify(request, null, 2);

  return `curl 'http://localhost:4000/api/v1/${suffix()}' \\
-X POST \\
-H 'Content-Type: application/json' \\
-H 'Authorization: Bearer ${private_key}' \\
-d '${json}'`;
}
