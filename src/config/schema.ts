import fs from "node:fs";
import * as toml from "@std/toml";
import z from "zod";
import { ProjectSchema } from "@/project";

const DEFAULT_LOGIN_PASSWORD = {
  login: "admin@admin.admin",
  password: "admin@admin.admin",
};

const DEFAULT_ADMIN_CREDENTIALS = {
  login: "admin@admin.admin",
  password: "admin@admin.admin",
};

const DUMMY_KEY_PLACEHOLDER = "replace with the path to the minio assert";

// Values `npm run init` writes for missing fields.
const DEFAULT_POSTGRES_CREDS = {
  host: "127.0.0.1",
  port: 5432,
  user: "postgres",
  password: "postgres",
} as const;

const DEFAULT_URLS = {
  core: "http://localhost:3000",
  business: "http://localhost:4000",
  settings: "http://localhost:6001",
  flexy_commission: "http://localhost:7082",
  flexy_guard: "http://localhost:7081",
  admin: "http://localhost:3002",
  trader: "http://localhost:4080",
  trader_sms: "http://localhost:5070",
  pixelwave: "http://localhost:4207",
  gcgcgen: "http://localhost:64476",
  postgres: {
    core: {
      ...DEFAULT_POSTGRES_CREDS,
      database: "reactivepay_core_production",
    },
    business: {
      ...DEFAULT_POSTGRES_CREDS,
      database: "reactivepay_business_production",
    },
    settings: {
      ...DEFAULT_POSTGRES_CREDS,
      database: "reactivepay_settings_production",
    },
  },
  redis: "redis://localhost:6379",
  mongo: "mongodb://localhost:27017",
} as const;

const DEFAULT_PROJECT_CONFIG = {
  core_credentials: DEFAULT_LOGIN_PASSWORD,
  flexy_commission_credentials: DEFAULT_LOGIN_PASSWORD,
  flexy_guard_credentials: DEFAULT_LOGIN_PASSWORD,
  settings_credentials: DEFAULT_LOGIN_PASSWORD,
  admin_credentials: DEFAULT_ADMIN_CREDENTIALS,
  dummy_ssl_path: DUMMY_KEY_PLACEHOLDER,
  dummy_rsa_public_key_path: DUMMY_KEY_PLACEHOLDER,
  dummy_rsa_private_key_path: DUMMY_KEY_PLACEHOLDER,
  urls: DEFAULT_URLS,
} as const;

type NonUndefined<T> = T extends undefined ? never : T;

// Optional keys, left out of DEFAULT_CONFIG.
type NoDefaultKey = "path";

type RecursiveNonUndefineable<T> = {
  [K in keyof T as K extends NoDefaultKey
    ? never
    : K]-?: RecursiveNonUndefineable<NonUndefined<T[K]>>;
};

export const DEFAULT_CONFIG: RecursiveNonUndefineable<
  z.infer<typeof CONFIG_SCHEMA>
> = {
  project: "reactivepay",
  debug: false,
  projects_dir: "..",
  browser: {
    headless: true,
    ws_url: "",
  },
  "8pay": DEFAULT_PROJECT_CONFIG,
  reactivepay: DEFAULT_PROJECT_CONFIG,
  spinpay: DEFAULT_PROJECT_CONFIG,
  paygateway: DEFAULT_PROJECT_CONFIG,
  a2: DEFAULT_PROJECT_CONFIG,
  paysure: DEFAULT_PROJECT_CONFIG,
  fxmb: DEFAULT_PROJECT_CONFIG,
  kotulapay: DEFAULT_PROJECT_CONFIG,
  settlixx: DEFAULT_PROJECT_CONFIG,
  extra_mapping: {},
  mock_rate: true,
  patch_volumes: false,
} as const;

const LOGIN_PASSWORD_SCHEMA = z.strictObject({
  login: z.string(),
  password: z.string(),
});

const POSTGRES_DB_SCHEMA = z.strictObject({
  database: z.string(),
  host: z.string(),
  port: z.int().positive(),
  user: z.string(),
  password: z.string(),
});

const URLS_SCHEMA = z.strictObject({
  core: z.string(),
  business: z.string(),
  settings: z.string(),
  flexy_commission: z.string(),
  flexy_guard: z.string(),
  admin: z.string(),
  trader: z.string(),
  trader_sms: z.string(),
  pixelwave: z.string(),
  gcgcgen: z.string(),
  postgres: z.strictObject({
    core: POSTGRES_DB_SCHEMA,
    business: POSTGRES_DB_SCHEMA,
    settings: POSTGRES_DB_SCHEMA,
  }),
  redis: z.string(),
  mongo: z.string(),
});

const PROJECT_CONFIG = z.strictObject({
  // Path to the project repository. Takes precedence over `projects_dir`.
  path: z.string().optional(),
  core_credentials: LOGIN_PASSWORD_SCHEMA,
  settings_credentials: LOGIN_PASSWORD_SCHEMA,
  flexy_guard_credentials: LOGIN_PASSWORD_SCHEMA,
  flexy_commission_credentials: LOGIN_PASSWORD_SCHEMA,
  admin_credentials: LOGIN_PASSWORD_SCHEMA,
  dummy_ssl_path: z.string(),
  dummy_rsa_public_key_path: z.string(),
  dummy_rsa_private_key_path: z.string(),
  urls: URLS_SCHEMA,
});

const BROWSER_OBJECT = z.strictObject({
  headless: z.boolean(),
  ws_url: z.string(),
});

// Only the section of the selected `project` is required.
const CONFIG_SCHEMA = z
  .strictObject({
    extra_mapping: z.record(z.string(), z.int().positive()),
    project: ProjectSchema,
    "8pay": PROJECT_CONFIG.optional(),
    reactivepay: PROJECT_CONFIG.optional(),
    kotulapay: PROJECT_CONFIG.optional(),
    settlixx: PROJECT_CONFIG.optional(),
    spinpay: PROJECT_CONFIG.optional(),
    paygateway: PROJECT_CONFIG.optional(),
    a2: PROJECT_CONFIG.optional(),
    fxmb: PROJECT_CONFIG.optional(),
    paysure: PROJECT_CONFIG.optional(),
    browser: BROWSER_OBJECT,
    debug: z.boolean(),
    patch_volumes: z.boolean(),
    projects_dir: z.string(),
    mock_rate: z.boolean(),
  })
  .check((ctx) => {
    if (ctx.value[ctx.value.project] === undefined) {
      ctx.issues.push({
        code: "invalid_type",
        expected: "object",
        input: undefined,
        path: [ctx.value.project],
        message: `Missing section for the selected project "${ctx.value.project}"`,
      });
    }
  });

export type Config = z.infer<typeof CONFIG_SCHEMA>;

export function parseConfig(contents: string) {
  return CONFIG_SCHEMA.parse(toml.parse(contents));
}

export function projectCredentials(
  config: Config,
): z.infer<typeof PROJECT_CONFIG> {
  let section = config[config.project];
  if (section === undefined) {
    throw new ConfigError(`Missing section for project "${config.project}"`);
  }
  return section;
}

export function projectUrls(config: Config): z.infer<typeof URLS_SCHEMA> {
  return projectCredentials(config).urls;
}

export type PostgresDatabase = "core" | "business" | "settings";

/** Resolve connection params for one of a project's postgres databases. */
export function postgresConnection(config: Config, db: PostgresDatabase) {
  return projectUrls(config).postgres[db];
}

const INIT_HINT = "Run `npm run init` to create or repair it.";

export class ConfigError extends Error {
  override name = "ConfigError";
}

function readRaw(path: string): unknown {
  let contents: string;
  try {
    contents = fs.readFileSync(path).toString();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConfigError(`Config file ${path} not found. ${INIT_HINT}`);
    }
    throw e;
  }
  try {
    return toml.parse(contents);
  } catch (e) {
    throw new ConfigError(
      `Failed to parse ${path}: ${(e as Error).message}\n${INIT_HINT}`,
      { cause: e },
    );
  }
}

/** Read and validate the config file, throwing a ConfigError on any problem. */
export function open(path: string) {
  let result = CONFIG_SCHEMA.safeParse(readRaw(path));
  if (!result.success) {
    throw new ConfigError(
      `Invalid config schema in ${path}:\n${z.prettifyError(result.error)}\n${INIT_HINT}`,
    );
  }
  return result.data;
}

function removeAt(root: unknown, path: PropertyKey[]) {
  let node = root as Record<PropertyKey, unknown> | undefined;
  for (let key of path.slice(0, -1)) {
    node = node?.[key] as Record<PropertyKey, unknown> | undefined;
  }
  if (node && typeof node === "object" && path.length > 0) {
    delete node[path[path.length - 1]];
  }
}

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Fill keys missing in `target` from `template`, recording each added path.
function fillMissing(
  target: Record<string, unknown>,
  template: Record<string, unknown>,
  path: string[],
  changes: string[],
) {
  for (let [key, value] of Object.entries(template)) {
    if (target[key] === undefined) {
      target[key] = structuredClone(value);
      changes.push(`added missing ${[...path, key].join(".")}`);
    } else if (isTable(target[key]) && isTable(value)) {
      fillMissing(target[key], value, [...path, key], changes);
    }
  }
}

function defaultConfig(): Config {
  return CONFIG_SCHEMA.parse(structuredClone(DEFAULT_CONFIG));
}

/**
 * Load the config file and fix it up: a missing or unparsable file is replaced
 * with DEFAULT_CONFIG, invalid and unknown fields are dropped and missing ones
 * are filled from DEFAULT_CONFIG. Project sections are only filled for the
 * selected project and the ones already present.
 * Returns the valid config and a list of what was changed.
 */
export function repair(path: string): { config: Config; changes: string[] } {
  if (!fs.existsSync(path)) {
    return { config: defaultConfig(), changes: ["created default config"] };
  }
  let raw: Record<string, unknown>;
  try {
    let parsed = toml.parse(fs.readFileSync(path).toString());
    raw = isTable(parsed) ? parsed : {};
  } catch (e) {
    return {
      config: defaultConfig(),
      changes: [
        `replaced unparsable config with defaults: ${(e as Error).message}`,
      ],
    };
  }

  let changes: string[] = [];
  // Each pass drops invalid fields and fills the gaps, until the config parses.
  for (let pass = 0; pass < 10; pass++) {
    let template: Record<string, unknown> = { ...DEFAULT_CONFIG };
    let project = ProjectSchema.safeParse(raw.project);
    for (let name of ProjectSchema.options) {
      if (raw[name] === undefined && name !== project.data) {
        delete template[name];
      }
    }
    fillMissing(raw, template, [], changes);

    let result = CONFIG_SCHEMA.safeParse(raw);
    if (result.success) {
      return { config: result.data, changes };
    }
    for (let issue of result.error.issues) {
      if (issue.code === "unrecognized_keys") {
        for (let key of issue.keys) {
          changes.push(`removed unknown key ${[...issue.path, key].join(".")}`);
          removeAt(raw, [...issue.path, key]);
        }
      } else if (issue.path.length === 0) {
        changes.push(`reset config: ${issue.message}`);
        raw = {};
      } else {
        changes.push(`reset ${issue.path.join(".")}: ${issue.message}`);
        removeAt(raw, issue.path);
      }
    }
  }
  return { config: defaultConfig(), changes: ["reset whole config"] };
}
