import assert from "node:assert/strict";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";

const NativeDOMException = globalThis.DOMException;

function construct(message?: unknown, name?: unknown): DOMException {
  return new DOMException(message as string | undefined, name as string | undefined);
}

test("DOMException string conversion agrees with Node for ordinary argument values", () => {
  const values: unknown[] = [undefined, null, false, true, 0, -0, 1n, NaN, Infinity, "", "AbortError", {}, [1, 2]];
  // Node 24.20 has a nonstandard object-valued second-argument options overload.
  // Compare its DOMString branch here; the separate object-name controls follow
  // Web IDL's normative DOMString argument rather than that Node extension.
  const names = values.filter((value) => value === null || typeof value !== "object");
  for (const message of values) {
    for (const name of names) {
      const actual = construct(message, name);
      const expected = new NativeDOMException(message as string, name as string);
      assert.equal(actual.message, expected.message);
      assert.equal(actual.name, expected.name);
      assert.equal(actual.code, expected.code);
    }
  }
});

test("DOMException converts message then name exactly once", () => {
  const order: string[] = [];
  const message = { toString() { order.push("message"); return "detail"; } };
  const name = { toString() { order.push("name"); return "AbortError"; } };
  const actual = construct(message, name);
  assert.deepEqual(order, ["message", "name"]);
  assert.equal(actual.message, "detail");
  assert.equal(actual.name, "AbortError");
  assert.equal(actual.code, 20);
  assert.deepEqual(order, ["message", "name"]);
});

test("DOMException name conversion propagates its exact failure", () => {
  const failure = {};
  const name = { toString(): never { throw failure; } };
  assert.throws(() => construct("message", name), (error: unknown) => error === failure);
});

test("DOMException message conversion failure prevents name conversion", () => {
  const failure = {};
  let names = 0;
  const message = { toString(): never { throw failure; } };
  const name = { toString() { names++; return "AbortError"; } };
  assert.throws(() => construct(message, name), (error: unknown) => error === failure);
  assert.equal(names, 0);
});

test("DOMException rejects Symbol conversion in either argument", () => {
  assert.throws(() => construct(Symbol("message"), "name"), TypeError);
  assert.throws(() => construct("message", Symbol("name")), TypeError);
});

test("DOMException stores converted names without retaining a mutable input", () => {
  let name = "InvalidCharacterError";
  const input = { toString() { return name; } };
  const exception = construct("message", input);
  name = "WrongDocumentError";
  assert.equal(exception.name, "InvalidCharacterError");
  assert.equal(exception.code, 5);
});

test("DOMException code ignores an ordinary subclass name override", () => {
  class Derived extends DOMException {
    override get name(): string { return "WrongDocumentError"; }
  }
  class NativeDerived extends NativeDOMException {
    override get name(): string { return "WrongDocumentError"; }
  }
  const actual = new Derived("message", "InvalidCharacterError");
  const expected = new NativeDerived("message", "InvalidCharacterError");
  assert.equal(actual.name, expected.name);
  assert.equal(actual.code, expected.code);
  assert.equal(actual.code, 5);
  assert.equal(actual.toString(), expected.toString());
});

test("DOMException inherited name and message cannot be assigned", () => {
  const exception = new DOMException("detail", "AbortError");
  const writable: Error = exception;
  assert.throws(() => { writable.name = "WrongDocumentError"; }, TypeError);
  assert.throws(() => { writable.message = "changed"; }, TypeError);
  assert.equal(exception.name, "AbortError");
  assert.equal(exception.message, "detail");
  assert.equal(exception.code, 20);
});

test("DOMException inherits Error string formatting for default and empty names", () => {
  for (const [message, name] of [["", ""], ["detail", ""], ["", "AbortError"], ["detail", "AbortError"]]) {
    assert.equal(new DOMException(message, name).toString(), new NativeDOMException(message, name).toString());
  }
  assert.equal(new DOMException().toString(), new NativeDOMException().toString());
});
