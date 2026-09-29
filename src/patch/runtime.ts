import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Config } from "@/config";
import {
  parseDockerCompose,
  patchComposeDoc,
  stringifyDockerCompose,
} from "./docker_compose";
import { applyGitPatch } from "./git_patch";
import { patchProductionRb } from "./production_file";
import { ProjectDir } from "./project_dir";

/**
 * Patched copies of the project files live here, the project repository stays intact.
 */
const GENERATED_ROOT = path.resolve(import.meta.dirname, "../../.generated");

export const BUSINESS_PRODUCTION_RB =
  "services/business/config/environments/production.rb";

export function generatedDir(config: Config) {
  return path.join(GENERATED_ROOT, config.project);
}

export function generatedFilePath(config: Config, relativePath: string) {
  return path.join(generatedDir(config), "files", relativePath);
}

export function generatedComposePath(config: Config) {
  return path.join(generatedDir(config), "docker-compose.yml");
}

function csrfPatches(config: Config) {
  return [
    "csrf_core.patch",
    "csrf_admin.patch",
    config.project === "a2" ? "csrf_settings_a2.patch" : "csrf_settings.patch",
  ];
}

type BindMount = { source: string; target: string };

function parseBindMount(volume: unknown): BindMount | undefined {
  if (typeof volume === "string") {
    let [source, target] = volume.split(":");
    // Named volumes do not look like paths
    if (!source || !target || !/^[.~/]/.test(source)) return;
    return { source, target };
  }
  if (volume && typeof volume === "object") {
    let { type, source, target } = volume as Record<string, unknown>;
    if (
      type === "bind" &&
      typeof source === "string" &&
      typeof target === "string"
    ) {
      return { source, target };
    }
  }
}

function resolveHostPath(projectDir: string, source: string) {
  if (source === "~" || source.startsWith("~/")) {
    return path.join(os.homedir(), source.slice(1));
  }
  return path.resolve(projectDir, source);
}

/**
 * Mount generated files over the originals in every service that bind mounts their directory.
 */
function mountGeneratedFiles(
  doc: Record<string, any>,
  projectDir: string,
  files: { relativePath: string; hostPath: string }[],
) {
  for (let [name, service] of Object.entries<Record<string, any>>(
    doc.services ?? {},
  )) {
    let mounts = (service.volumes ?? [])
      .map(parseBindMount)
      .filter((m: BindMount | undefined): m is BindMount => m !== undefined)
      .map((m: BindMount) => ({
        ...m,
        source: resolveHostPath(projectDir, m.source),
      }));

    let added: string[] = [];
    for (let { relativePath, hostPath } of files) {
      let file = path.join(projectDir, relativePath);
      // The most specific mount wins
      let mount = mounts
        .filter((m: BindMount) => file.startsWith(m.source + path.sep))
        .sort((a: BindMount, b: BindMount) => b.source.length - a.source.length)
        .at(0);
      if (!mount) continue;
      let target = path.posix.join(
        mount.target,
        path.relative(mount.source, file).split(path.sep).join("/"),
      );
      service.volumes.push(`${hostPath}:${target}:ro`);
      added.push(relativePath);
    }
    if (added.length) {
      console.log(`Mounted generated files into ${name}: ${added.join(", ")}`);
    }
  }
}

/**
 * Generate patched project files and docker compose file that mounts them.
 */
export function generateRuntimeProject(config: Config) {
  let project_dir = new ProjectDir(config);
  console.log(`Resolved project dir path: ${project_dir.path}`);

  let readSource = (relativePath: string) => {
    let file = path.join(project_dir.path, relativePath);
    if (!fs.existsSync(file)) return;
    return fs.readFileSync(file, { encoding: "utf8" });
  };

  let files = new Map<string, string>();

  let production_rb = readSource(BUSINESS_PRODUCTION_RB);
  if (production_rb === undefined) {
    throw Error(`${BUSINESS_PRODUCTION_RB} not found in ${project_dir.path}`);
  }
  let { mapping, patched } = patchProductionRb(production_rb);
  files.set(BUSINESS_PRODUCTION_RB, patched);
  console.log(`Patched production rb file with ${mapping.size} entries`);

  for (let patch of csrfPatches(config)) {
    let result = applyGitPatch(
      patch,
      (relativePath) => files.get(relativePath) ?? readSource(relativePath),
    );
    for (let [relativePath, contents] of result ?? []) {
      files.set(relativePath, contents);
    }
  }

  let docker_compose = fs.readFileSync(project_dir.dockerComposePath(), {
    encoding: "utf8",
  });
  let doc = parseDockerCompose(docker_compose);
  patchComposeDoc(doc, config);

  // Files are overwritten in place: single file bind mounts of running containers keep working
  for (let [relativePath, contents] of files) {
    let file = generatedFilePath(config, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }

  mountGeneratedFiles(
    doc,
    project_dir.path,
    [...files.keys()].map((relativePath) => ({
      relativePath,
      hostPath: generatedFilePath(config, relativePath),
    })),
  );

  let compose_file = generatedComposePath(config);
  fs.writeFileSync(compose_file, stringifyDockerCompose(doc));
  console.log(`Generated docker compose file: ${compose_file}`);

  return { projectDir: project_dir.path, composeFile: compose_file };
}
