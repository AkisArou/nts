import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
const adapter = dirname(fileURLToPath(import.meta.url));
const script = join(adapter, "names.ts");
test("the native internal-name table regenerates byte for byte", () => {
  const result = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
test("a new native internal name is named by the drift check", () => {
  const scratch = mkdtempSync(join(process.env.TMPDIR ?? join(process.env.HOME!, ".cache"), "nts-tsrs-name-control-"));
  try {
    const ast = join(scratch, "crates/tsrs_ast/src");
    mkdirSync(ast, { recursive: true });
    const source = readFileSync(join(adapter, "../../third_party/tsrs/crates/tsrs_ast/src/symbol.rs"), "utf8");
    writeFileSync(join(ast, "symbol.rs"), source + String.raw`\npub const INTERNAL_SYMBOL_NAME_EXTRA_FACT: &str = "\u{7f}extraFact";`.replace("\\n", "\n") + "\n");
    const result = spawnSync(process.execPath, [script, "--check", "--vendor", scratch], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /ExtraFact/);
    assert.match(result.stdout + result.stderr, /native internal-name drift/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
