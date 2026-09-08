// The internal machinery that is publicly reachable, and the assertion that there is none.
//
// This file began as a measurement of a deviation too large to close in passing: sixty-three
// members that Web IDL does not define, sitting on interface prototypes because they were
// ordinary public methods. It recorded them, asserted the list could shrink and never grow,
// and named the mechanism that would close it.
//
// The list is empty. What the file is for now is keeping it that way.
//
// **The three mechanisms, in the order they apply.** `#private` where a member is used only
// inside its own class -- free on the frontier, measured, after this file spent a day
// carrying the opposite claim as a reason not to try. **Symbol keys** where it crosses
// classes or modules, because `Object.getOwnPropertyNames` does not report symbols. **Then**
// the enumerability fix, which is only safe once a prototype has no non-standard names left:
// a blanket pass before that point would have enumerated the internals too, making one
// deviation worse to improve the other.
//
// **`tsc` finds every syntactic use of a renamed member and none of the reflective ones.**
// `in`, `typeof x.name`, `hasOwnProperty`, a name in a lookup table. Run that grep first.
//
// The oracle is node's prototype per interface, with the divergences cited individually in
// `webidl-surface.test.mjs` -- five places where node is the best available oracle for
// interface shape and is not the standard.

import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";

import * as api from "../src/index.ts";
import { prototypeNamed } from "./harness.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};

/** Web IDL constants legitimately appear on the interface prototype object. */
const IDL_CONSTANTS = new Set([
  "NONE",
  "CAPTURING_PHASE",
  "AT_TARGET",
  "BUBBLING_PHASE",
  "CONNECTING",
  "OPEN",
  "CLOSING",
  "CLOSED",
]);

/**
 * Members this runtime exposes on an interface prototype that Web IDL does not define.
 *
 * Forty-five, down from sixty-three. Shrinking this table is progress; growing it is a
 * regression. The assertion is exact equality in both directions, so a removal has to
 * change this table and the count below rather than passing silently.
 */
// Empty, and the type is what keeps it meaningful: an untyped `{}` makes every read off it
// `unknown`, so the count assertion below could not add up its entries.
const INTERNAL_PROTOTYPE_MEMBERS: Readonly<Record<string, readonly string[]>> = {};

/**
 * Standard members this runtime has that the oracle does not implement.
 *
 * `CustomEvent.initCustomEvent` is declared in `interfaces/dom.idl` -- marked `// legacy`, but
 * declared -- and node does not provide it. Excluded by citation, not convenience: the claim
 * is checkable against an IDL file pinned in this repository.
 */
const ORACLE_OMITS: Readonly<Record<string, readonly string[]>> = {
  CustomEvent: ["initCustomEvent"],
};

function internalMembers(name: string): string[] {
  const ours = prototypeNamed(api, name);
  const theirs = prototypeNamed(globalThis, name);
  if (ours === undefined || theirs === undefined) return [];
  const mine = Object.getOwnPropertyNames(ours).filter(
    (key) => key !== "constructor" && !IDL_CONSTANTS.has(key),
  );
  const conformant = new Set([
    ...Object.getOwnPropertyNames(theirs),
    ...(ORACLE_OMITS[name] ?? []),
  ]);
  return mine.filter((key) => !conformant.has(key)).sort();
}

suite("the non-standard prototype surface is exactly what is written down", () => {
  for (const [name, expected] of Object.entries(INTERNAL_PROTOTYPE_MEMBERS)) {
    assert.notEqual(prototypeNamed(globalThis, name), undefined, `${name} needs a conformant oracle`);
    assert.deepEqual(
      internalMembers(name),
      expected,
      `${name}: this list may shrink, never grow -- see the header`,
    );
  }
});

suite("no interface has grown a non-standard member", () => {
  // Enumerated from the barrel rather than from a list. The list version was written when the
  // table above held sixty-three entries and only a handful of interfaces were clean; with the
  // table empty it was checking thirteen names and missing every other interface in the
  // runtime -- including `ReadableStream`, which is where all seventeen of the last batch
  // were. A sabotage adding a named method to `ReadableStream` passed it.
  //
  // A gate whose coverage is a list goes stale the moment the thing it guards changes shape.
  const grown: string[] = [];
  for (const [name] of Object.entries(api)) {
    if (!/^[A-Z]/.test(name)) continue;
    if (prototypeNamed(api, name) === undefined) continue;
    if (prototypeNamed(globalThis, name) === undefined) continue;
    const extra = internalMembers(name);
    if (extra.length > 0) grown.push(`${name}: ${extra.join(" ")}`);
  }
  assert.deepEqual(grown, []);
});

suite("the count is stated, so shrinking it is visible", () => {
  const total = Object.values(INTERNAL_PROTOTYPE_MEMBERS).reduce((n, list) => n + list.length, 0);
  // Written as a number rather than derived, so that removing an entry has to change this
  // line too and cannot pass unnoticed as a no-op.
  assert.equal(total, 0);
});

suite("interface members are enumerable, as Web IDL requires", () => {
  // This assertion used to run the other way. It pinned the deviation -- every member
  // non-enumerable, where Web IDL gives operations
  // `{ writable: true, enumerable: true, configurable: true }` -- with a note saying that if
  // it ever started failing, the deviation was fixed and this was what needed updating.
  //
  // It started failing. The blocker was never enumerability itself: it was that a blanket
  // pass would also enumerate the sixty-three internal members, making one deviation worse to
  // improve the other. Those are gone, so this is safe, and the assertion is now the fix.
  const wrong: string[] = [];
  for (const name of ["Headers", "ReadableStream", "Request", "Response", "Event"]) {
    const proto = prototypeNamed(api, name);
    assert.notEqual(proto, undefined, `${name} is not on the platform surface`);
    if (proto === undefined) continue;
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === "constructor") continue;
      // A descriptor for a name `getOwnPropertyNames` just returned is always present; saying
      // so out loud beats an assertion, because a missing one would otherwise read as enumerable.
      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      if (descriptor === undefined || !descriptor.enumerable) {
        wrong.push(`${name}.${key}`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});
