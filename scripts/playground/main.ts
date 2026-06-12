import { setupPlayground } from "./setup";
import { createJob, runJob } from "./jobs";
import { log, summary } from "./log";

const CONCURRENCY = 40;

let env = await setupPlayground();
process.removeAllListeners("SIGINT");

let running = true;
let nextId = 1;
let stopping = false;
let lastSigint = 0;
// A single Ctrl-C can be delivered more than once (e.g. when a process
// supervisor relays the signal). Coalesce deliveries that land within this
// window so one keypress can't be mistaken for a deliberate double Ctrl-C.
const SIGINT_COALESCE_MS = 300;

process.on("SIGINT", () => {
  let now = Date.now();
  if (now - lastSigint < SIGINT_COALESCE_MS) return;
  lastSigint = now;
  if (!stopping) {
    stopping = true;
    running = false;
    log(
      "shutdown",
      "stopping - no new jobs will start, draining in-flight jobs. Press Ctrl-C again to force quit.",
    );
  } else {
    log("shutdown", "force quit");
    summary();
    process.exit(130);
  }
});

async function worker() {
  while (running) {
    let job = createJob(env, nextId++);
    log(
      "job",
      `#${job.id} ${job.operation} status=${job.status} mid=${job.merchant.id} ` +
      `req=${job.requisite ?? "-"} amount=${job.amount}` +
      (job.dispute ? ` dispute=${job.dispute.status}` : ""),
    );
    try {
      await runJob(env, job);
    } catch (e: any) {
      log("error", `#${job.id} failed`, e?.message ?? e);
    }
  }
}

log("main", `starting ${CONCURRENCY} concurrent workers (Ctrl-C to stop)`);
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

summary();
process.exit(0);
