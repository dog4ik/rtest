import * as yaml from "@std/yaml";

function insertExtraHost(map: Record<string, any>) {
  map.extra_hosts = ["host.docker.internal:host-gateway"];
}

function makeDependency(
  name: string,
  condition: string,
): [string, Record<string, string>] {
  return [name, { condition }];
}

export function patchedDockerCompose(
  dockerCompose: string,
  patchVolumes: boolean,
): string {
  console.log("raw document", dockerCompose);
  const doc = yaml.parse(dockerCompose) as Record<string, any>;
  console.log("yaml document:", JSON.stringify(doc, null, 2));

  const services = doc.services;
  const volumes = doc.volumes;

  // Patch postgres
  const postgres = services.postgres;
  if (!postgres) throw new Error("No postgres service found");

  postgres.healthcheck = {
    test: ["CMD-SHELL", "pg_isready -U postgres"],
    interval: "5s",
    timeout: "5s",
    retries: "5",
  };

  if (patchVolumes) {
    volumes["postgres-data-test"] = { driver: "local" };
    postgres.volumes = ["postgres-data-test:/var/lib/postgresql/data"];
  }

  const mongoSetup = services.mongo;

  if (mongoSetup) {
    if (patchVolumes) {
      volumes["mongo-data-test"] = { driver: "local" };
      mongoSetup.volumes = ["mongo-data-test:/data/db"];
    }
  }

  const minioSetup = services.minio;

  if (minioSetup) {
    if (patchVolumes) {
      volumes["minio-data-test"] = { driver: "local" };
      volumes["minio-config-test"] = { driver: "local" };
      minioSetup.volumes = [
        "minio-data-test:/export",
        "minio-config-test:/root/.minio",
      ];
    }
  }

  // Patch metabase_setup if exists
  const metabaseSetup = services.metabase_setup;
  if (metabaseSetup) {
    metabaseSetup.depends_on = Object.fromEntries([
      makeDependency("postgres", "service_healthy"),
      makeDependency("metabase", "service_started"),
    ]);
  }

  // Patch business
  const business = services.business;
  if (business) {
    business.depends_on = Object.fromEntries([
      makeDependency("postgres", "service_healthy"),
      makeDependency("redis", "service_started"),
    ]);
    insertExtraHost(business);
  }

  // Patch business_sidekiq
  const businessSidekiq = services.business_sidekiq;
  if (businessSidekiq) {
    businessSidekiq.depends_on = Object.fromEntries([
      makeDependency("postgres", "service_healthy"),
      makeDependency("redis", "service_started"),
    ]);
    insertExtraHost(businessSidekiq);
  }

  // Patch trader if exists
  const trader = services.trader;
  if (trader) {
    trader.depends_on = Object.fromEntries([
      makeDependency("postgres", "service_healthy"),
      makeDependency("redis", "service_started"),
    ]);
  }

  // Patch core
  const core = services.core;
  if (core) {
    console.log({ core });
    let environment = core.environment;
    let threads = "RAILS_MAX_THREADS=20";
    if (Array.isArray(environment) && !environment.includes(threads)) {
      core.environment.push(threads);
    }
    core.depends_on = Object.fromEntries([
      makeDependency("postgres", "service_healthy"),
      makeDependency("redis", "service_started"),
      makeDependency("minio", "service_started"),
    ]);
  }

  // Patch settings
  const settings = services.settings;
  if (settings) {
    settings.depends_on = Object.fromEntries([
      makeDependency("postgres", "service_healthy"),
    ]);
  }

  // Expose mongo port to the host
  const mongo = services.mongo;
  if (mongo) {
    mongo.ports = ["27017:27017"];
  }

  return yaml.stringify(doc);
}
