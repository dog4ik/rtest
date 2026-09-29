import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GIT_PATCHES_DIR = path.resolve(import.meta.dirname, "../../git_patches");

/**
 * Project relative paths of the files touched by the patch
 */
export function patchTargets(patchContents: string): string[] {
  return patchContents
    .split("\n")
    .filter((line) => line.startsWith("+++ b/"))
    .map((line) => line.slice("+++ b/".length).trim());
}

function gitApply(cwd: string, patchContents: string, args: string[]) {
  return spawnSync("git", ["apply", ...args, "-"], {
    cwd,
    input: patchContents,
    encoding: "utf8",
  });
}

export function applyGitPatch(
  patch: string,
  readSource: (relativePath: string) => string | undefined,
): Map<string, string> | undefined {
  let patchContents = fs.readFileSync(path.resolve(GIT_PATCHES_DIR, patch), {
    encoding: "utf8",
  });
  let targets = patchTargets(patchContents);
  let sources = new Map<string, string>();
  for (let target of targets) {
    let contents = readSource(target);
    if (contents === undefined) {
      console.log(`Skipping git patch ${patch}: ${target} does not exist`);
      return;
    }
    sources.set(target, contents);
  }

  let tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rtest-patch-"));
  try {
    for (let [target, contents] of sources) {
      let file = path.join(tmp, target);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents);
    }

    let result = gitApply(tmp, patchContents, []);
    if (result.status !== 0) {
      // Files may still carry changes from the old in-place patching
      let reverse = gitApply(tmp, patchContents, ["--reverse", "--check"]);
      if (reverse.status !== 0) {
        throw Error(`Failed to apply git patch ${patch}: ${result.stderr}`);
      }
      console.log(`Git patch ${patch} is already applied in the project`);
    }

    return new Map(
      targets.map((target) => [
        target,
        fs.readFileSync(path.join(tmp, target), { encoding: "utf8" }),
      ]),
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
