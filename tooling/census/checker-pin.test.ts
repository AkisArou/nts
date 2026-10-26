import assert from "node:assert/strict";
import { test } from "node:test";
import { checkerPin } from "./checker-pin.ts";

test("parser evidence binds to both independently moving upstream revisions", () => {
  const native = "a".repeat(40), typescript = "b".repeat(40);
  const text = (port: string, compiler: string) => `nts 0.0.0\nfrontend tsrs 0.19.0 (${port})\nTypeScript commit ${compiler}\n`;
  const original = checkerPin(text(native, typescript));
  assert.equal(original, `tsrs:${native}/typescript:${typescript}`);
  assert.notEqual(checkerPin(text("c".repeat(40), typescript)), original);
  assert.notEqual(checkerPin(text(native, "d".repeat(40))), original);
  for (const missing of ["", `frontend tsrs 0.19.0 (${native})`, `TypeScript commit ${typescript}`]) {
    assert.throws(() => checkerPin(missing), /both native checker and TypeScript commits/);
  }
});

test("carried patch contents participate in the checker evidence identity", () => {
  const version = `frontend tsrs 0.19.0 (${"a".repeat(40)})\nTypeScript commit ${"b".repeat(40)}\n`;
  const patch = (digest: string) => `tsrs local patch yield-recovery ${digest}\n`;
  assert.notEqual(checkerPin(version), checkerPin(version + patch("c".repeat(64))));
  assert.notEqual(checkerPin(version + patch("c".repeat(64))), checkerPin(version + patch("d".repeat(64))));
  assert.throws(() => checkerPin(version + patch("broken")), /invalid carried checker patch/);
  assert.throws(() => checkerPin(version + patch("c".repeat(64)) + patch("c".repeat(64))), /invalid carried checker patch/);
});
