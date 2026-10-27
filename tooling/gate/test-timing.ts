// Conservative test-side timing lint. Every new timer or clock expression
// requires review, including timers in generated fixture scripts. Normal tests
// wait on an event/state through test-wait.ts instead of sleeping then asserting.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REVIEWED_TEST_TIMING, type ReviewedTiming } from "./test-timing-reviewed.ts";

export type TimingSite = { file: string; line: number; source: string };
const timing = /\bsetTimeout\b|\bsetInterval\b|\bAtomics\s*\.\s*wait\b|\bsleep\b|\b(?:Date|performance)\s*\.\s*now\s*\(|\btimeout\s*:/;

export function timingSites(file: string, source: string): TimingSite[] {
  return source.split(/\r?\n/).flatMap((text, index) => {
    const line = text.trim();
    return line.startsWith("//") || !timing.test(line) ? [] : [{ file, line: index + 1, source: line }];
  });
}

export function timingProblems(sites: TimingSite[], reviewed: readonly ReviewedTiming[] = REVIEWED_TEST_TIMING): string[] {
  const problems = sites.filter(site => !reviewed.some(rule => rule.file === site.file && rule.source === site.source))
    .map(site => `${site.file}:${site.line}: unreviewed test timing: ${site.source}; wait on the real event, or review a named hang guard/control`);
  for (const rule of reviewed) {
    const found = sites.filter(site => site.file === rule.file && site.source === rule.source).length;
    if (found !== rule.count) problems.push(`${rule.file}: reviewed ${rule.kind} changed: expected ${rule.count}, found ${found}: ${rule.source}`);
  }
  return problems;
}

export function auditTestTiming(root: string): { files: number; sites: TimingSite[]; problems: string[] } {
  const files: string[] = [];
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && /\.test\.(?:ts|mjs)$/.test(entry.name)) files.push(path);
    }
  }
  walk(join(root, "tooling"));
  const sites = files.sort().flatMap(path => timingSites(relative(root, path), readFileSync(path, "utf8")));
  return { files: files.length, sites, problems: timingProblems(sites) };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = auditTestTiming(fileURLToPath(new URL("../../", import.meta.url)));
  if (result.problems.length) {
    console.error(result.problems.join("\n")); process.exitCode = 1;
  } else console.log(`test timing: ${result.files} files checked; ${result.sites.length} exact reviewed controls/guards`);
}
