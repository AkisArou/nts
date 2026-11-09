// The test262 record's one reader and writer: what conformance262.ts writes,
// what --recorded and --check read back, and what the summary counts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTest262Record, serializeTest262Record, type Test262Writer } from "./test262-record.ts";

const writer: Test262Writer = {
  under: "test/annexB", compiler: "e71242a74d0d558a", commit: "7".repeat(40), backend: "llvm",
  harness: "bbd3d84004e74dad", machine: "19.8 GB available, swap 10.8/31.5 GB, load 15.3/15 (1m/5m), 30 cores", jobs: 4,
};
const rows = [
  { path: "test/annexB/b.js", outcome: "fail" as const, detail: "nts: uncaught Test262Error: during loop body evaluation" },
  { path: "test/annexB/a.js", outcome: "pass" as const, detail: "" },
];

test("a record is written as conformance262.ts always wrote it, rows sorted, a pass without detail", () => {
  assert.equal(serializeTest262Record(writer, rows),
    "# Test262 test/annexB cases that ran, and what each did. Written by\n" +
    "# tooling/census/conformance262.ts --record; compared by --check.\n" +
    `# compiler e71242a74d0d558a, commit ${"7".repeat(40)}, backend llvm, harness bbd3d84004e74dad; machine at start: ${writer.machine}; 4 worker(s)\n` +
    "test/annexB/a.js\tpass\t\n" +
    "test/annexB/b.js\tfail\tnts: uncaught Test262Error: during loop body evaluation\n");
  // A compiler that is not a clean pin names no commit.
  assert.match(serializeTest262Record({ ...writer, commit: null }, rows), /^# compiler e71242a74d0d558a, backend llvm, harness /m);
});

test("what is written reads back: header, rows and what a fail threw", () => {
  const record = parseTest262Record(serializeTest262Record(writer, rows));
  assert.deepEqual(record.header, { under: "test/annexB", compiler: "e71242a74d0d558a", commit: "7".repeat(40), backend: "llvm", harness: "bbd3d84004e74dad" });
  assert.deepEqual(record.rows, [...rows].reverse());
  // A tab in what a fail threw stays in it.
  const tabbed = parseTest262Record("test/x.js\tfail\tthrew\tthis\n");
  assert.equal(tabbed.rows[0]!.detail, "threw\tthis");
});

test("an older record reads as its header says: C's when it names no backend, no commit when it names none", () => {
  const record = parseTest262Record("# a comment\ntest/language/a.js\tpass\t\n");
  assert.deepEqual(record.header, { under: null, compiler: null, commit: null, backend: "c", harness: null });
  assert.equal(record.rows.length, 1);
  assert.deepEqual(parseTest262Record("").rows, []);
});

test("a row that is not a pass or a fail, a row without its fields and a case recorded twice are errors", () => {
  assert.throws(() => parseTest262Record("test/a.js\trefused\t\n"), /unknown test262 outcome refused/);
  assert.throws(() => parseTest262Record("test/a.js\tpass\n"), /malformed test262 record row/);
  assert.throws(() => parseTest262Record("test/a.js\tpass\t\ntest/a.js\tfail\tx\n"), /duplicate recorded case: test\/a.js/);
});
