import assert from "node:assert/strict";
import test from "node:test";
import { childSucceeded, completedJvmClasses, recordChild } from "./blockers-child.mjs";

const directory = "/owned/out";
const stdout = `wrote 12 class(es) and the runtime to ${directory}\n`;
const good = { status: 0, signal: null, error: null, stdout, stderr: "" };

test("positive complete JVM emission only establishes a vanished-refusal candidate", () => {
  assert.equal(completedJvmClasses(good, directory), 12);
  assert.equal(completedJvmClasses({ ...good, stdout: stdout.replace("12", "1") }, directory), 1);
  assert.equal(completedJvmClasses({ ...good, stdout: stdout.replace("\n", "\r\n") }, directory), 12);
});

test("malformed, partial, declined, interrupted, or failed JVM emission is never clean", () => {
  const negatives = [
    { stdout: "" },
    { stdout: "nothing refused\n" },
    { stdout: stdout.trimEnd() },
    { stdout: stdout.slice(0, -8) },
    { stdout: stdout + stdout },
    { stdout: "NTS4001 distinct bodies\n" + stdout },
    { stdout: stdout + "NTS4001 distinct bodies\n" },
    { stdout: stdout.replace("12", "0") },
    { stdout: stdout.replace("12", "-1") },
    { stdout: stdout.replace("12", "01") },
    { stdout: stdout.replace("12", "9007199254740992") },
    { stdout: stdout.replace(directory, "/wrong/out") },
    { stdout: stdout.replace("class(es)", "classes") },
    { stderr: " " },
    { stderr: "\n" },
    { stderr: "NTS4001 distinct bodies\n" },
    { stderr: "warning: incomplete output\n" },
    { status: 1 },
    { status: null },
    { signal: "SIGKILL" },
    { status: null, signal: "SIGTERM", stdout: "NTS4001 distinct bodies\n" },
    { error: { message: "maxBuffer exceeded", code: "ENOBUFS" } },
    { error: { message: "spawn failed", code: "ENOENT" }, stdout: "NTS4001 distinct bodies\n" },
  ];
  for (const changed of negatives) {
    assert.equal(completedJvmClasses({ ...good, ...changed }, directory), null,
      JSON.stringify(changed));
  }
  assert.equal(completedJvmClasses(good, "/another/out"), null);
});

test("child status is authoritative independently of partial diagnostic text", () => {
  assert.equal(childSucceeded(good), true);
  for (const changed of [{ status: 1 }, { status: null }, { signal: "SIGKILL" },
    { error: { message: "spawn failed" } }]) {
    assert.equal(childSucceeded({ ...good, ...changed }), false);
  }
  const error = Object.assign(new Error("buffer limit"), { code: "ENOBUFS" });
  const raw = { pid: 42, status: null, signal: "SIGTERM", error,
    stdout: "partial NTS4001", stderr: "full error" };
  const saved = recordChild("/pinned/nts", ["emit-jvm", "fixture"], raw);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), {
    command: "/pinned/nts", args: ["emit-jvm", "fixture"], pid: 42,
    status: null, signal: "SIGTERM", error: { name: "Error", message: "buffer limit", code: "ENOBUFS" },
    stdout: "partial NTS4001", stderr: "full error",
  });
  assert.equal(childSucceeded(saved), false);
});
