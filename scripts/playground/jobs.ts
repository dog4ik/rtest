import * as assets from "@/assets";
import * as common from "@/common";
import type { Requisite } from "@/driver/trader";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { ExtendedTrader } from "@/entities/trader";
import { counters, log } from "./log";
import { chance, pick, randAmount, randDelay } from "./random";
import type { PlaygroundEnv } from "./setup";

type Status = "approved" | "declined";

export type Job = {
  id: number;
  merchant: ExtendedMerchant;
  operation: "payin" | "payout";
  requisite?: Requisite; // payin only
  amount: number; // kopecks
  status: Status;
  expired?: boolean; // payin only: left unfinalized to expire
  dispute?: { status: Status }; // payin + declined only
};

/**
 * Short human-readable description of all the job's choices, e.g.
 * "approved payin", "declined card payin + approved dispute", "declined payout".
 * Embedded into the merchant request's `order_number` so transactions are
 * self-describing in core/business.
 */
export function jobIntent(job: Job): string {
  if (job.operation === "payin") {
    if (job.expired) {
      return `expired ${job.requisite ?? "card"} payin`;
    }
    let intent = `${job.status} ${job.requisite ?? "card"} payin`;
    if (job.dispute) {
      intent += ` + ${job.dispute.status} dispute`;
    }
    return intent;
  }
  return `${job.status} payout`;
}

export function createJob(env: PlaygroundEnv, id: number): Job {
  let operation = chance() ? "payin" : "payout";
  let status: Status = chance() ? "approved" : "declined";
  let job: Job = {
    id,
    merchant: pick(env.merchants),
    operation: operation as Job["operation"],
    amount: randAmount(),
    status,
  };
  if (operation === "payin") {
    job.requisite = pick<Requisite>(["card", "sbp"]);
    if (chance(0.2)) {
      job.expired = true;
    } else if (status === "declined" && chance()) {
      job.dispute = { status: chance() ? "approved" : "declined" };
    }
  }
  return job;
}

export async function runJob(env: PlaygroundEnv, job: Job) {
  if (job.operation === "payin") {
    await runPayin(env, job);
  } else {
    await runPayout(env, job);
  }
}

function assignedTrader(env: PlaygroundEnv, trader_id: number | null) {
  let trader = env.traders.find((t) => t.id === trader_id);
  if (!trader) {
    throw new Error(`No assigned trader for feed trader_id=${trader_id}`);
  }
  return trader as ExtendedTrader;
}

async function runPayin(env: PlaygroundEnv, job: Job) {
  let requisite = job.requisite ?? "card";

  await randDelay();
  let res = await job.merchant
    .create_payment({
      ...common.traderPaymentRequest("RUB", requisite),
      amount: job.amount,
      order_number: jobIntent(job),
    })
    .then((r) => r.followFirstProcessingUrl())
    .then((r) => r.as_trader_requisites())
    .catch((e: any) => {
      counters.failed++;
      log(
        "create_fail",
        `#${job.id} create failed (collision ok)`,
        e?.message ?? e,
      );
      return null;
    });
  if (res === null) {
    return;
  }

  let token = res.token;
  counters.created++;
  log(
    "payin",
    `#${job.id} created token=${token} req=${requisite} amount=${job.amount}`,
  );

  if (job.expired) {
    counters.expired++;
    log("payin", `#${job.id} left to expire token=${token} (not finalized)`);
    return;
  }

  let feed = await env.ctx.get_feed(token);
  let trader = assignedTrader(env, feed.trader_id);

  await randDelay();
  await trader.finalizeTransaction(token, job.status);
  if (job.status === "approved") counters.approved++;
  else counters.declined++;
  log("payin", `#${job.id} finalized ${job.status} by trader=${trader.id}`);

  if (job.status === "declined" && job.dispute) {
    await runDispute(env, job, token, trader, job.dispute);
  }
}

async function runDispute(
  env: PlaygroundEnv,
  job: Job,
  token: string,
  trader: ExtendedTrader,
  dispute: { status: Status },
) {
  await randDelay();
  await job.merchant.create_dispute({
    token,
    file_path: assets.PngImgPath,
    description: "playground dispute",
  });
  log("dispute", `#${job.id} opened token=${token}`);

  await randDelay();
  let disputes = await env.ctx.get_disputes(token);
  if (disputes.length === 0) {
    counters.failed++;
    log("dispute_fail", `#${job.id} no dispute found token=${token}`);
    return;
  }

  await randDelay();
  await trader.finalize_dispute(disputes[0].dispute_id, dispute.status);
  counters.disputed++;
  log(
    "dispute",
    `#${job.id} finalized ${dispute.status} by trader=${trader.id}`,
  );
}

async function runPayout(env: PlaygroundEnv, job: Job) {
  await randDelay();
  let res = await job.merchant
    .create_payout({
      ...common.payoutRequest("RUB"),
      amount: job.amount,
      order_number: jobIntent(job),
      bank_account: { requisite_type: "card" as const },
      customer: {
        email: common.email,
        ip: common.ip,
        first_name: common.firstName,
        last_name: common.lastName,
      },
      card: { pan: common.visaCard },
    })
    .then((r) => r.followFirstProcessingUrl())
    .then((r) => r.as_payout_response())
    .catch((e: any) => {
      counters.failed++;
      log(
        "payout_fail",
        `#${job.id} create failed (collision ok)`,
        e?.message ?? e,
      );
      return null;
    });
  if (res === null) {
    return;
  }

  let token = res.token;
  counters.created++;
  log("payout", `#${job.id} created token=${token} amount=${job.amount}`);

  let feed = await env.ctx.get_feed(token);
  let trader = assignedTrader(env, feed.trader_id);

  if (job.status === "approved") {
    await randDelay();
    let finalized = await trader.finalizeTransaction(token, "approved");
    await randDelay();
    await env.state.core_harness.approve_payout(finalized.id);
    counters.approved++;
    log("payout", `#${job.id} approved by trader=${trader.id}`);
  } else {
    await randDelay();
    await trader.finalizeTransaction(token, "declined");
    counters.declined++;
    log("payout", `#${job.id} declined by trader=${trader.id}`);
  }

  // await healthcheck(env, job, token, expectedStatus(job.status), "payout");
}
