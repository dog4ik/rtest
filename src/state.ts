import fs from "node:fs/promises";
import { projectCredentials, type Config } from "@/config";
import { connectPool } from "@/db";
import { BusinessDb } from "@/db/business";
import { CoreDb } from "@/db/core";
import { CoreDriver } from "./driver/core";
import { SettingsDriver } from "./driver/settings";
import { SettingsDb } from "./db/settings";
import { MockServerState } from "./mock_server";
import { readProductionRb } from "./patch/production_file";
import { ProjectDir } from "./patch/project_dir";
import { createBrowser } from "./test_context/browser";
import { FlexyCommission } from "./driver/flexy_commission";
import { FlexyGuardHarness } from "./driver/flexy_guard";

export type SharedState = Awaited<ReturnType<typeof initState>>;

export async function initState(config: Config) {
  console.log("Initiating state", config);
  let p = config.project;
  let business_url = "http://localhost:4000";
  let core_harness = new CoreDriver("http://localhost:3000");
  let project_dir = new ProjectDir(config);

  let credentials = projectCredentials(config);

  let settings_service = new SettingsDriver(
    "http://127.0.0.1:6001",
    credentials.settings_credentials,
  );

  let commission_service = new FlexyCommission(
    "http://127.0.0.1:7082",
    credentials.flexy_commission_credentials,
  );

  let [core_db, business_db, settings_db, mapping, browser] = await Promise.all(
    [
      connectPool("reactivepay_core_production"),
      connectPool("reactivepay_business_production"),
      connectPool("reactivepay_settings_production"),
      fs
        .readFile(project_dir.businessProductionRbPath())
        .then((b) => b.toString())
        .then(readProductionRb),
      createBrowser(),
      core_harness.login(credentials.core_credentials),
      settings_service.login(),
      commission_service.login(credentials.flexy_commission_credentials),
    ],
  );

  if (config.extra_mapping !== undefined) {
    for (let [key, val] of Object.entries(config.extra_mapping)) {
      mapping.set(key, val);
    }
  }

  return {
    business_url,
    project: config.project,
    core_db: new CoreDb(core_db, p),
    business_db: new BusinessDb(business_db, p),
    settings_db: new SettingsDb(settings_db, p),
    core_harness,
    settings_service,
    commission_service,
    guard_service: new FlexyGuardHarness(
      "http://127.0.0.1:7081",
      credentials.flexy_guard_credentials,
    ),
    mock_servers: new MockServerState(mapping),
    browser,
  };
}
