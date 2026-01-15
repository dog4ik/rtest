import fs from "node:fs";
import path from "node:path";
import { describe } from "vitest";

let dirs = ["test"];
while (dirs.length) {
  let dir = dirs.pop()!;
  let entries = fs.readdirSync(dir);
  for (let entry of entries) {
    let entry_path = path.join(dir, entry);
    let stats = fs.statSync(entry_path);
    if (stats.isDirectory()) {
      dirs.push(entry_path);
    } else if (
      stats.isFile() &&
      entry.endsWith(".test.ts") &&
      entry != path.basename(import.meta.filename)
    ) {
      describe.concurrent(entry_path, async () => {
        await import(path.resolve(entry_path));
      });
    }
  }
}
