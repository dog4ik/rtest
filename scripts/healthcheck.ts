import { argv } from "node:process";
import { connectPool } from "@/db";
import { BusinessDb } from "@/db/business";
import { CoreDb } from "@/db/core";
import { basic_healthcheck } from "@/healthcheck";
import * as config from "../src/config";

let c = config.open("configuration.toml");
let core_db = new CoreDb(
  await connectPool(config.postgresConnection(c, "core")),
  c.project,
);
let business_db = new BusinessDb(
  await connectPool(config.postgresConnection(c, "business")),
  c.project,
);
let token = argv[2];
if (token?.length !== 32) {
  throw Error(`Expected valid token argument, got ${token}`);
}

let hc = await basic_healthcheck({ core_db, business_db }, token);
hc.assert();

process.exit(0);
