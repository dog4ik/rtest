import { connectPool } from "@/db";
import { CoreDb } from "@/db/core";
import readline from "node:readline";
import * as config from "../src/config";
import { basic_healthcheck } from "@/healthcheck";
import { BusinessDb } from "@/db/business";

function prompt_token(): Promise<string> {
  let rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question("Token: ", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

let c = config.open("configuration.toml");
let core_db = new CoreDb(
  await connectPool("reactivepay_core_production"),
  c.project,
);
let business_db = new BusinessDb(
  await connectPool("reactivepay_business_production"),
  c.project,
);
let token = await prompt_token();
let hc = await basic_healthcheck({ core_db, business_db }, token);
hc.assert();
