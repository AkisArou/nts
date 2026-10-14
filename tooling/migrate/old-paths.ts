// Fail if anything is still where the corpora used to be.
//
//   node tooling/migrate/old-paths.ts
//
// Two questions, both against what git tracks:
// - **A file under an old root.** A lane's fixture written before the move and
//   landed after it would sit in `tooling/conformance/blockers/` where no step
//   looks any more, and pass by never being run.
// - **A path naming an old root**, in anything but `docs/records/` (history,
//   which keeps the paths it was written with). A tool still globbing
//   `examples/*/` finds nothing and reports zero cases, which reads as green.
//
// The old roots and their new homes are `table.ts`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { OLD_ROOTS, references } from "./table.ts";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

/** Text files a path could be written in. */
const TEXT = /\.(ts|tsx|mts|mjs|js|cjs|json|jsonc|ya?ml|toml|sh|bash|py|rs|md|txt|known|tsv|cfg|mk)$|(^|\/)(Makefile|Dockerfile|\.gitignore|\.gitattributes)$/;

function tracked(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

function main(): void {
  const files = tracked();
  const stranded = files.filter((file) => OLD_ROOTS.some((old) => file.startsWith(`${old}/`)));
  const named: string[] = [];
  for (const file of files) {
    if (file.startsWith("docs/records/") || file.startsWith("third_party/") || !TEXT.test(file)) continue;
    if (file.startsWith("tooling/migrate/")) continue;
    let text: string;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    const found = references(text, file, root);
    if (found.length === 0) continue;
    const starts: number[] = [];
    let offset = 0;
    for (const line of lines) {
      starts.push(offset);
      offset += line.length + 1;
    }
    const seen = new Set<number>();
    for (const { at } of found) {
      let line = starts.length - 1;
      while (line > 0 && starts[line] > at) line--;
      if (seen.has(line)) continue;
      seen.add(line);
      named.push(`${file}:${line + 1}: ${lines[line].trim().slice(0, 140)}`);
    }
  }
  for (const file of stranded.slice(0, 20)) console.log(`  under an old root: ${file}`);
  for (const line of named.slice(0, 40)) console.log(`  names an old root: ${line}`);
  console.log(
    `  ${stranded.length} file(s) under an old root, ${named.length} line(s) naming one` +
      (stranded.length + named.length > 40 ? " (first 40 shown)" : ""),
  );
  process.exit(stranded.length + named.length === 0 ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
