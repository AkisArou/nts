import assert from "node:assert/strict";
import { test } from "node:test";
import { constants } from "node:os";
import { compilerStop, compilerStopped, normalizeGeneratedNumbers, stableCheckText } from "../conformance/observation-text.ts";
import * as observations from "../conformance/observation-text.ts";
const { compilerExternalStop } = observations;

test("diagnostic normalization retains source names, positions, arity and widths", () => {
  assert.equal(normalizeGeneratedNumbers('Queue<35>#push Wrapper<37, 42>#map type 99 BlockId(12) at: 14 bits: 64 OwnType35'),
    'Queue<N>#push Wrapper<N, N>#map type N BlockId(N) at: 14 bits: 64 OwnType35');
  assert.notEqual(normalizeGeneratedNumbers('Queue<35>#push'), normalizeGeneratedNumbers('Queue<35>#shift'));
});

test("scratch-location normalization never changes an answer's numbers", () => {
  assert.equal(stableCheckText('refused: /scratch/src/main.ts:12:5: NTS1001 Queue<35>'), 'refused: NTS1001 Queue<35>');
  assert.equal(stableCheckText('not rendered: /scratch/src/main.ts:12:5: NTS4001'), 'not rendered: NTS4001');
  assert.equal(stableCheckText('observed <35> type 42 at 17'), 'observed <35> type 42 at 17');
});

test("a compiler stop is named by the stop itself, never by a refusal printed first", () => {
  const panic = "/scratch/src/main.ts:11:1: NTS1001 `Object.defineProperty` is not supported by this lowering yet\n" +
    "thread 'nts' (1010068) panicked at compiler/codegen/common/src/symbols.rs:649:5:\n" +
    "invalid emitted C identifier \"\" from \"\"\n" +
    "note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace\n";
  assert.equal(compilerStop(panic, 101, null), "thread 'nts' panicked: invalid emitted C identifier \"\" from \"\"");
  assert.equal(compilerStop(panic.replace("1010068", "77").replace("649:5", "702:9"), 101, null), compilerStop(panic, 101, null),
    "the thread id and the panic's location are not the defect's identity");
  assert.notEqual(compilerStop(panic.replace("invalid emitted C identifier", "index out of bounds"), 101, null), compilerStop(panic, 101, null));
  assert.equal(compilerStop("thread 'main' (42) panicked at /first/compiler/lower.rs:12:3: invalid operand", 101, null),
    "thread 'main' panicked: invalid operand", "a panic whose message shares its location's line");
  assert.equal(compilerStop("NTS1100 `Object.freeze`\nthread 'nts' (9) has overflowed its stack\nfatal runtime error: stack overflow\n", 134, null),
    "thread 'nts' (N) has overflowed its stack");
  assert.equal(compilerStop("memory allocation of 103079215080 bytes failed\n", null, "SIGABRT"), "memory allocation of N bytes failed");
  assert.equal(compilerStop("", null, "SIGSEGV"), "stopped by SIGSEGV");
  assert.equal(compilerStop("NTS1001 a refusal\n", 139, null), "stopped with exit 139");
});

test("only a self-raised signal or Rust panic belongs to the compiler", () => {
  for (const [status, signal] of [[101, null], [134, null], [null, "SIGABRT"]] as const) assert.equal(compilerStopped(status, signal), true);
  for (const signal of ["SIGSEGV", "SIGBUS", "SIGILL", "SIGFPE", "SIGABRT", "SIGTRAP", "SIGSYS"] as const) {
    assert.equal(compilerStopped(null, signal), true, signal);
    const number = constants.signals[signal];
    if (number !== undefined) assert.equal(compilerStopped(128 + number, null), true, `exit ${128 + number}`);
  }
  for (const signal of ["SIGKILL", "SIGTERM", "SIGINT", "SIGHUP"] as const) {
    assert.equal(compilerStopped(null, signal), false, signal);
    assert.equal(compilerExternalStop(null, signal), true, signal);
    assert.match(compilerStop("NTS1001 earlier refusal\nthread 'nts' panicked at a.rs:1:2: earlier panic", null, signal), new RegExp(signal));
    assert.equal(compilerStopped(128 + constants.signals[signal], null), false, signal);
    assert.equal(compilerExternalStop(128 + constants.signals[signal], null), true, signal);
    assert.match(compilerStop("", 128 + constants.signals[signal], null), new RegExp(signal));
  }
  assert.equal(compilerStopped(1, null), false, "invalid HIR and type errors exit 1: answers, not stops");
  assert.equal(compilerStopped(0, null), false);
  assert.equal(compilerExternalStop(1, null), false);
  assert.equal(compilerExternalStop(0, null), false);
});
