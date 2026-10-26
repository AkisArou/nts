// The stable landing sample has zero compiler and output failures.
// The full upstream selection remains a separate survey until its own ratchet.
// An explicit root gives tests and independent runs private worker/report paths.
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function main(args: readonly string[]): number {
  const [root, mode] = args;
  if (!root || mode !== "core") {
    console.error("usage: corpus.ts root core");
    return 2;
  }
  const report = join(root, "target", "suite-report.txt");
  mkdirSync(join(root, "target"), { recursive: true });
  const fd = openSync(report, "w");
  const result = spawnSync(process.env.NTS_SUITE_BIN ?? join(root, "target/release/nts-suite"),
    ["--root", root],
    { stdio: ["ignore", fd, fd], env: process.env });
  closeSync(fd);
  const text = readFileSync(report, "utf8");
  if (result.status !== 0) {
    process.stdout.write(text);
    console.error(result.error?.message ?? `suite exit ${result.status}, signal ${result.signal}`);
    console.log("  ^ TypeScript corpus did not finish");
    return 1;
  }
  for (const line of text.split("\n")) {
    if (/single-file|lowered completely|refused a construct|rejected by|frontend failed|invalid HIR|compiler crashed|uncompilable C|unverifiable class/.test(line)) {
      console.log(line);
    }
  }
  if (!/^[1-9]\d* single-file cases$/m.test(text)) {
    console.log("  ^ TypeScript corpus measured no cases");
    return 1;
  }
  // A failed checker never reached HIR. Its zero invalid count cannot pass.
  // HIR validity does not prove C syntax; C/LLVM pointer erasure also cannot
  // prove JVM class types. Each independently measured row must remain zero.
  // The JVM backend step separately requires a JDK; no-JDK is not verification.
  for (const [row, reason] of [
    ["frontend failed", "frontend failures must be zero"],
    ["invalid HIR", "invalid HIR must be zero"],
    ["compiler crashed", "compiler crashes must be zero"],
    ["uncompilable C", "uncompilable C must be zero"],
    ["unverifiable class", "unverifiable class must be zero"],
  ]) {
    const counts = [...text.matchAll(new RegExp(`^\\s+${row}\\s+(\\d+)$`, "mg"))];
    if (counts.length !== 1 || Number(counts[0][1]) !== 0) {
      console.log(`  ^ ${reason}`);
      return 1;
    }
  }
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
