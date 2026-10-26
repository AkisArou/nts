import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const adapter = dirname(fileURLToPath(import.meta.url));
const script = join(adapter, "roles.ts");
const vendor = join(adapter, "../../third_party/tsrs");
test("native visitor regenerates the committed field roles byte for byte", () => {
  const result = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
test("a child added to an existing native payload is named by the drift check", () => {
  const scratch = mkdtempSync(join(process.env.TMPDIR ?? join(process.env.HOME!, ".cache"), "nts-tsrs-role-control-"));
  try {
    const ast = join(scratch, "crates/tsrs_ast/src");
    mkdirSync(ast, { recursive: true });
    cpSync(join(vendor, "MANIFEST"), join(scratch, "MANIFEST"));
    cpSync(join(vendor, "crates/tsrs_ast/src/ast.rs"), join(ast, "ast.rs"));
    const native = readFileSync(join(vendor, "crates/tsrs_ast/src/generated.rs"), "utf8")
      .replace("pub struct IfStatement {", "pub struct IfStatement {\n    pub extra: P<Node>,")
      .replace("impl IfStatement {", "impl IfStatement {\n    pub fn extra(&self) -> P<Node> { self.extra }")
      .replace("v(self.expression()) || v(self.then_statement())", "v(self.extra()) || v(self.expression()) || v(self.then_statement())");
    writeFileSync(join(ast, "generated.rs"), native);
    const result = spawnSync(process.execPath, [script, "--check", "--vendor", scratch], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /IfStatementExtra/);
    assert.match(result.stdout + result.stderr, /native field-role drift/);
    assert.match(result.stdout + result.stderr, /api\/roles.json/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("SourceFile visitor visibility does not remove its ordered children", () => {
  const scratch = mkdtempSync(join(process.env.TMPDIR ?? join(process.env.HOME!, ".cache"), "nts-tsrs-visibility-control-"));
  try {
    const ast = join(scratch, "crates/tsrs_ast/src");
    const output = join(scratch, "adapter");
    mkdirSync(ast, { recursive: true });
    cpSync(join(vendor, "MANIFEST"), join(scratch, "MANIFEST"));
    cpSync(join(vendor, "crates/tsrs_ast/src/generated.rs"), join(ast, "generated.rs"));
    const native = readFileSync(join(vendor, "crates/tsrs_ast/src/ast.rs"), "utf8");
    const declaration = /(?:pub(?:\([^)]*\))?\s+)?fn for_each_child<V: FnMut\(P<Node>\) -> bool \+ \?Sized>/;
    assert.equal([...native.matchAll(new RegExp(declaration.source, "g"))].length, 1);
    for (const visibility of ["pub ", "pub(crate) ", ""]) {
      writeFileSync(join(ast, "ast.rs"), native.replace(declaration, `${visibility}fn for_each_child<V: FnMut(P<Node>) -> bool + ?Sized>`));
      const result = spawnSync(process.execPath, [script, "--vendor", scratch, "--out", output], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const roles = JSON.parse(readFileSync(join(output, "api/roles.json"), "utf8"));
      const source = roles.nodes.find((node) => node.owner === "SourceFile");
      assert.deepEqual(source?.fields.map((field) => [field.field, field.role]), [
        ["statements", "list"], ["end_of_file_token", "child"],
      ]);
    }
    writeFileSync(join(ast, "ast.rs"), native.replace(
      "pub(crate) fn for_each_child<V: FnMut(P<Node>) -> bool + ?Sized>(&self, v: &mut V) -> bool",
      "pub(crate) fn for_each_child<V: FnMut(P<Node>) -> bool + ?Sized>(&self, v: &mut V) -> VisitResult",
    ));
    const unknown = spawnSync(process.execPath, [script, "--vendor", scratch, "--out", output], { encoding: "utf8" });
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stdout + unknown.stderr, /unrecognized native visitor declaration: SourceFile/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
