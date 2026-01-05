import fs from "node:fs";
import path from "node:path";
import process from "node:child_process";
import tracing from "@/tracing";

export async function applyGitPatch(project_dir: string, patch: string) {
  let patchPath = path.resolve("git_patches", patch);
  let patchContents = fs.readFileSync(patchPath);
  tracing.debug({ patchPath, project_dir }, "Applying git patch");

  let { resolve, promise } = Promise.withResolvers();
  let child = process.spawn("git", ["apply", "-"], { cwd: project_dir });
  child.on("exit", async (code) => {
    console.log("git process existed with status", code);
    let res = await child.stderr.toArray();
    console.log(String(res));

    resolve(true);
  });
  child.stdin.write(patchContents);
  child.stdin.end();
  await promise;
}
