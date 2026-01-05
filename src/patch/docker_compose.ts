import * as yaml from "@std/yaml";

function insertExtraHost(map: Record<string, any>) {
  map["extra_hosts"] = ["host.docker.internal:host-gateway"];
}

function makeDependency(
  name: string,
  condition: string,
): [string, Record<string, string>] {
  return [name, { condition }];
}

export function patchedDockerCompose(dockerCompose: string): string {
  console.log("raw document", dockerCompose);
  const doc = yaml.parse(dockerCompose) as Record<string, any>;
  console.log("yaml document:", doc);

  const services = doc.services;

  // Patch postgres
  const postgres = services["postgres"];
  if (!postgres) throw new Error("No postgres service found");

  postgres.healthcheck = {
    test: ["CMD-SHELL", "pg_isready -U postgres"],
    interval: "5s",
    timeout: "5s",
    retries: "5",
  };

  // Patch metabase_setup if exists
  const metabaseSetup = services["metabase_setup"];
  if (metabaseSetup) {
    metabaseSetup.depends_on = Object.fromEntries([
      makeDependency("postgres", "service_healthy"),
      makeDependency("metabase", "service_started"),
    ]);
  }

  // Patch business
  const business = services["business"];
  if (business) {
    business.depends_on = Object.fromEntries([
      makeDependency("postgres", "service_healthy"),
      makeDependency("redis", "service_started"),
    ]);
    insertExtraHost(business);
  }

  // Patch business_sidekiq
  const businessSidekiq = services["business_sidekiq"];
  if (businessSidekiq) {
    businessSidekiq.depends_on = Object.fromEntries([
      makeDependency("postgres", "service_healthy"),
      makeDependency("redis", "service_started"),
    ]);
    insertExtraHost(businessSidekiq);
  }

  // Patch trader if exists
  const trader = services["trader"];
  if (trader) {
    trader.depends_on = Object.fromEntries([
      makeDependency("postgres", "service_healthy"),
      makeDependency("redis", "service_started"),
    ]);
  }

  // Patch core
  const core = services["core"];
  if (core) {
    core.depends_on = Object.fromEntries([
      makeDependency("postgres", "service_healthy"),
      makeDependency("redis", "service_started"),
      makeDependency("minio", "service_started"),
    ]);
  }

  // Patch settings
  const settings = services["settings"];
  if (settings) {
    settings.depends_on = Object.fromEntries([
      makeDependency("postgres", "service_healthy"),
    ]);
  }

  return yaml.stringify(doc);
}
