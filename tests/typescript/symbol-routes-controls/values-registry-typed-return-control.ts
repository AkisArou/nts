/*---
description: Explicit string-key record control for Symbols returned from a typed registry helper keep identity by key and stay distinct from local symbols.
features: [ts-symbol-route-values, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-null-undefined, ts-record]
---*/
// A declared symbol return carries registry values; node reuses each exact registry key and never registers a local symbol with the same description.
type Token = string;
interface TokenData { description: string | undefined; registered: string | undefined; }
const tokenOrder: Token[] = [], tokenData: Record<string, TokenData> = {};
function fresh(description: string | undefined): Token { const id = "token:" + tokenOrder.length; tokenOrder.push(id); tokenData[id] = { description, registered: undefined }; return id; }
function tokenText(value: Token): string { const description = tokenData[value].description; return "Symbol(" + (description === undefined ? "" : description) + ")"; }
const registry: Record<string, Token> = {};
function registered(key: string): Token { const slot = "registry:" + key; if (registry[slot] === undefined) { const value = fresh(key); tokenData[value].registered = key; registry[slot] = value; } return registry[slot]; }
function registeredKey(value: Token): string | undefined { return tokenData[value].registered; }
function describe(value: Token): string | undefined { return tokenData[value].description; }
const keys: string[] = ["", "same", "constructor", "__proto__", "A\u0000B", "\ud83d\ude00"], saved: Token[] = [];
for (const key of keys) {
  const first: Token = registered(key), again: Token = registered(key), local: Token = fresh(key);
  assert.sameValue(first, again); assert.sameValue(first === local, false); assert.sameValue(saved.includes(first), false);
  assert.sameValue(registeredKey(first), key); assert.sameValue(registeredKey(again), key); assert.sameValue(registeredKey(local), undefined);
  assert.sameValue(describe(first), key); assert.sameValue(describe(local), key); saved.push(first);
}
const repeated: Token[] = []; for (const key of keys) repeated.push(registered(key)); assert.compareArray(repeated, saved);
const observed: (string | undefined)[] = []; for (const token of saved) observed.push(registeredKey(token)); assert.compareArray(observed, keys);
