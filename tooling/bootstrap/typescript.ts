// The upstream test corpus follows the TypeScript commit the native checker ports.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 24, stdio: ["ignore", "pipe", "pipe"] }).trim();

export function corpusPin(root = ROOT): string {
  const source = readFileSync(join(root, "tooling/suite/src/test262_runner/mod.rs"), "utf8");
  const pin = /^pub const TYPESCRIPT_PIN: &str = "([0-9a-f]{40})";/m.exec(source)?.[1];
  if (!pin) throw new Error("TYPESCRIPT_PIN is missing or invalid");
  const native = JSON.parse(readFileSync(join(root, "third_party/tsrs/UPSTREAM.json"), "utf8"));
  if (native.typescript_commit !== pin) throw new Error(`TypeScript corpus ${pin} differs from the native checker ${native.typescript_commit}; re-pin with node compiler/frontend-tsrs/vendor.ts --source <tsrs-checkout> --rev <commit>, set TYPESCRIPT_PIN to its typescript_commit, then run node tooling/bootstrap/typescript.ts <fresh-corpus-checkout>`);
  return pin;
}

export function verifyCheckout(destination: string, pin: string): void {
  const actual = git(destination, ["rev-parse", "HEAD"]);
  if (actual !== pin) throw new Error(`TypeScript corpus at ${destination} is ${actual}, requires ${pin}; bootstrap never moves an existing checkout`);
  if (git(destination, ["status", "--porcelain"])) throw new Error(`TypeScript corpus at ${destination} has local changes`);
  if (!existsSync(join(destination, "tsc/testdata/tests/cases"))) throw new Error(`TypeScript corpus at ${destination} has no tsc/testdata/tests/cases`);
}

export function prepare(destination = join(ROOT, "third_party/typescript")): void {
  const pin = corpusPin();
  if (existsSync(destination)) {
    verifyCheckout(destination, pin);
    console.log(`TypeScript corpus already prepared: ${pin}`);
    return;
  }
  mkdirSync(dirname(destination), { recursive: true });
  const stage = mkdtempSync(join(dirname(destination), ".typescript-"));
  try {
    git(stage, ["init", "--quiet"]);
    git(stage, ["remote", "add", "origin", "https://github.com/microsoft/TypeScript"]);
    git(stage, ["sparse-checkout", "set", "--no-cone", "/tsc/testdata/tests/"]);
    git(stage, ["fetch", "--depth", "1", "--filter=blob:none", "origin", pin]);
    git(stage, ["checkout", "--detach", "FETCH_HEAD"]);
    verifyCheckout(stage, pin);
    renameSync(stage, destination);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  console.log(`TypeScript corpus prepared: ${pin}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { prepare(process.argv[2] ? resolve(process.argv[2]) : undefined); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
