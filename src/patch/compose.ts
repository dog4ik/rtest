import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Config } from "@/config";
import { generateRuntimeProject } from "./runtime";

/**
 * Run docker compose command against the project with patches applied at runtime.
 */
export async function runCompose(config: Config, args: string[]) {
  let { projectDir, composeFile } = generateRuntimeProject(config);

  let composeArgs = ["compose", "--project-directory", projectDir];
  composeArgs.push("-f", composeFile);
  // Explicit -f disables automatic loading of the override file
  let override = path.join(projectDir, "docker-compose.override.yml");
  if (fs.existsSync(override)) {
    composeArgs.push("-f", override);
  }
  composeArgs.push(...args);

  console.log(`docker ${composeArgs.join(" ")}`);
  let child = spawn("docker", composeArgs, { stdio: "inherit" });

  // Terminal delivers SIGINT to docker compose directly, let it shut down gracefully
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => child.kill("SIGTERM"));

  let code = await new Promise<number>((resolve) => {
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  process.exit(code);
}
