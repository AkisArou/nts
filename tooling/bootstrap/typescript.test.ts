import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { corpusPin, verifyCheckout } from "./typescript.ts";

function scratch(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "typescript-corpus-test-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("the corpus and checker must name one TypeScript revision", () => scratch((root) => {
  const pin = "a".repeat(40), other = "b".repeat(40);
  const source = join(root, "tooling/suite/src/test262_runner");
  const vendor = join(root, "third_party/tsrs");
  mkdirSync(source, { recursive: true }); mkdirSync(vendor, { recursive: true });
  writeFileSync(join(source, "mod.rs"), `pub const TYPESCRIPT_PIN: &str = "${pin}";\n`);
  writeFileSync(join(vendor, "UPSTREAM.json"), JSON.stringify({ typescript_commit: pin }));
  assert.equal(corpusPin(root), pin);
  writeFileSync(join(vendor, "UPSTREAM.json"), JSON.stringify({ typescript_commit: other }));
  assert.throws(() => corpusPin(root), (error: Error) => error.message.includes(pin) && error.message.includes(other) && error.message.includes("vendor.ts --source"));
}));

test("an existing checkout is verified without moving it or hiding local edits", () => scratch((root) => {
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init", "-q"]);
  const cases = join(root, "tsc/testdata/tests/cases");
  mkdirSync(cases, { recursive: true });
  const file = join(cases, "probe.ts"); writeFileSync(file, "export const value = 1;\n");
  git(["add", "."]); git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "source"]);
  const pin = git(["rev-parse", "HEAD"]);
  verifyCheckout(root, pin);
  assert.throws(() => verifyCheckout(root, "f".repeat(40)), /bootstrap never moves an existing checkout/);
  assert.equal(git(["rev-parse", "HEAD"]), pin);
  writeFileSync(file, "export const value = 2;\n");
  assert.throws(() => verifyCheckout(root, pin), /local changes/);
}));
