// production_rb_patcher.ts

const EXCLUDE: string[] = ["redis_url"];

const MAPPING_START_PORT = 64530;

/**
 * Extremely unfortunate solution.
 * Some integrations do not respect relative path in BASE_URL, thus making it impossible
 * to identify them when receiving request.
 */
class MappingBuilder {
  private inner: Map<string, number>;
  private nextPort: number;

  constructor(firstPort: number) {
    this.inner = new Map();
    this.nextPort = firstPort;
  }

  insert(name: string): void {
    this.inner.set(name, this.nextPort);
    this.nextPort += 1;
  }

  intoInner(): Map<string, number> {
    return this.inner;
  }

  get next_port(): number {
    return this.nextPort;
  }
}

class RubyConfigLine {
  constructor(
    public readonly configName: string,
    public readonly variant: RubyConfigVariant,
    public readonly url: string,
  ) {}

  /**
   * Configuration name without suffix
   */
  strippedConfigName(): string {
    return this.configName.endsWith("_base_url")
      ? this.configName.slice(0, -"_base_url".length)
      : this.configName;
  }

  urlParsed(): URL {
    return new URL(this.url);
  }

  getInternalHostLine(port: number): string {
    let replacementUrl = `http://host.docker.internal:${port}`;

    switch (this.variant.kind) {
      case "EnvCall":
        return `  config.${this.configName} = ENV.fetch(${this.variant.envName}, '${replacementUrl}')`;
      case "Literal":
        return `  config.${this.configName} = "${replacementUrl}"`;
    }
  }
}

type RubyConfigVariant =
  | { kind: "EnvCall"; envName: string }
  | { kind: "Literal" };

let QUOTES = ['"', "'"];

function unquote(s: string): string {
  let first = QUOTES.find((q) => s.startsWith(q));
  let last = QUOTES.find((q) => s.endsWith(q));
  if (first && last && first === last) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Parse a single line into a RubyConfigLine if possible
 */
function parseRubyConfigLine(line: string): RubyConfigLine | undefined {
  let trimmed = line.trim();
  if (!trimmed.startsWith("config.")) return;

  let afterConfig = trimmed.split("config.")[1];
  if (!afterConfig) return;

  let eqIndex = afterConfig.indexOf(" = ");
  if (eqIndex === -1) return;

  let configName = afterConfig.slice(0, eqIndex);
  let rest = afterConfig.slice(eqIndex + 3); // after " = "

  // Case 1: ENV.fetch("VAR", "url")
  if (rest.startsWith("ENV.fetch(") && rest.endsWith(")")) {
    let inner = rest.slice("ENV.fetch(".length, -1);
    let commaIndex = inner.indexOf(",");
    if (commaIndex !== -1) {
      let envName = inner.slice(0, commaIndex);
      let quotedUrl = inner.slice(commaIndex + 1).trim();
      return new RubyConfigLine(
        configName,
        { kind: "EnvCall", envName },
        unquote(quotedUrl),
      );
    }
  }

  // Case 2: "http://..." or 'http://...'
  let firstQuote = QUOTES.find((q) => rest.startsWith(q));
  if (firstQuote && rest.slice(1).startsWith("http")) {
    return new RubyConfigLine(configName, { kind: "Literal" }, unquote(rest));
  }

  return;
}

/**
 * Patch environment/production.rb file.
 * All providers base urls will lead to local machine
 */
export function patchProductionRb(contents: string): {
  patched: string;
  mapping: Map<string, number>;
} {
  let mapping = new MappingBuilder(MAPPING_START_PORT);
  let lines = contents.split("\n");
  let patchedLines: string[] = [];

  for (let line of lines) {
    let config = parseRubyConfigLine(line);

    if (config && EXCLUDE.includes(config.configName)) {
      patchedLines.push(line);
      console.debug(`Filtered out ${config.configName}`);
      continue;
    }

    if (config) {
      patchedLines.push(config.getInternalHostLine(mapping.next_port));
      mapping.insert(config.strippedConfigName());
    } else {
      patchedLines.push(line);
      if (line.trim().startsWith("config.")) {
        console.debug(`Failed to patch config line: ${line}`);
      }
    }
  }

  let patched = patchedLines.join("\n");
  // Ensure final newline
  if (contents.endsWith("\n") && !patched.endsWith("\n")) {
    patched += "\n";
  }

  return { patched, mapping: mapping.intoInner() };
}

/**
 * Read environment/production.rb file and create a mapping from existing docker-internal URLs
 */
export function readProductionRb(contents: string): Map<string, number> {
  let mapping = new Map<string, number>();
  let lines = contents.split("\n");

  for (let line of lines) {
    let config = parseRubyConfigLine(line);
    if (!config) continue;

    try {
      let url = config.urlParsed();
      if (url.hostname === "host.docker.internal") {
        if (url.port) {
          mapping.set(config.strippedConfigName(), parseInt(url.port));
        } else {
          console.error(`docker host without port: ${url}`);
        }
      } else {
        console.debug(`Skipping non docker url: ${url}`);
      }
    } catch (e) {
      console.error(`Failed to parse url: ${e}`);
    }
  }

  console.log(`Found ${mapping.size} entries in production.rb file`);
  return mapping;
}
