import { connectPool } from "@/db";
import { CoreDb } from "@/db/core";
import * as config from "../src/config";
import { basic_healthcheck } from "@/healthcheck";
import { BusinessDb } from "@/db/business";
import { argv } from "node:process";

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
if (!token || token.length != 32) {
  throw Error(`Expected valid token argument, got ${token}`);
}

let hc = await basic_healthcheck({ core_db, business_db }, token);
hc.assert();

process.exit(0);
