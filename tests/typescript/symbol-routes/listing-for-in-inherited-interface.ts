/*---
description: For-in through an interface excludes own and inherited symbols while visiting inherited string fields once.
features: [ts-symbol-route-listing, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-class, ts-class-fields, ts-inheritance, ts-optional-properties, ts-null-undefined, ts-symbols, ts-computed-keys, ts-unique-symbol]
---*/
// A Walkable parameter carries instances with enumerable prototype and own keys; node skips symbols and suppresses a shadowed prototype string key.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const inherited: unique symbol = Symbol("walk"), own: unique symbol = Symbol("walk");
interface Walkable { [inherited]: number; [own]?: number; inheritedText: string; tail: string; ownText?: string; }
function makeTarget(input: number, populated: boolean): Walkable {
  class Base implements Walkable { declare [inherited]: number; declare [own]?: number; declare inheritedText: string; declare tail: string; declare ownText?: string; }
  Object.defineProperty(Base.prototype, inherited, { value: input, enumerable: true });
  Object.defineProperty(Base.prototype, "inheritedText", { value: "parent", writable: true, enumerable: true }); Object.defineProperty(Base.prototype, "tail", { value: "tail", enumerable: true });
  const target: Walkable = new Base(); if (populated) { target.ownText = "own"; target.inheritedText = "shadow"; target[own] = input; } return target;
}
function walk(target: Walkable): string[] { const keys: string[] = []; for (const key in target) keys.push(key); return keys; }
function keys(target: Walkable): string[] { return Object.keys(target); }
function tokens(target: Walkable): symbol[] { return Object.getOwnPropertySymbols(target); }
function read(target: Walkable): number { return target[inherited]; }
function ownRead(target: Walkable): number | undefined { return target[own]; }
function inheritedPresent(target: Walkable): boolean { return inherited in target; }
function text(target: Walkable): string { return target.inheritedText; }
for (const input of [-0, NaN, 17]) for (const populated of [false, true]) {
  const target = makeTarget(input, populated); same(Object.is(inherited, own), false);
  assert.compareArray(walk(target), populated ? ["ownText", "inheritedText", "tail"] : ["inheritedText", "tail"]);
  assert.compareArray(keys(target), populated ? ["ownText", "inheritedText"] : []); assert.compareArray(tokens(target), populated ? [own] : []);
  same(read(target), input); same(ownRead(target), populated ? input : undefined); same(inheritedPresent(target), true); same(text(target), populated ? "shadow" : "parent");
}
