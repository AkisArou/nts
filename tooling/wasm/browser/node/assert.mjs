// node:assert/strict, as far as the Wasm checks use it, for a browser page.
export class AssertionError extends Error {
  constructor(message) { super(message); this.name = 'AssertionError'; this.code = 'ERR_ASSERTION'; }
}
function fail(message, fallback) {
  if (message instanceof Error) throw message;
  throw new AssertionError(message ?? fallback);
}
function same(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (a instanceof Date) return Object.is(a.getTime(), b.getTime());
  if (a instanceof RegExp) return String(a) === String(b);
  if (a instanceof Map) return a.size === b.size && [...a].every(([key, value]) => b.has(key) && same(value, b.get(key)));
  if (a instanceof Set) return a.size === b.size && [...a].every(value => b.has(value) || [...b].some(other => same(value, other)));
  const keys = Reflect.ownKeys(a);
  if (keys.length !== Reflect.ownKeys(b).length) return false;
  return keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
}
function matches(error, expected) {
  if (expected === undefined) return true;
  if (typeof expected === 'function' && expected.prototype !== undefined && error instanceof expected) return true;
  if (typeof expected === 'function' && (expected.prototype === undefined || !(Object.prototype.isPrototypeOf.call(Error.prototype, expected.prototype)))) return expected(error) === true;
  if (expected instanceof RegExp) return expected.test(String(error));
  if (typeof expected === 'object') return Object.entries(expected).every(([key, value]) => value instanceof RegExp ? value.test(error?.[key]) : same(error?.[key], value));
  return false;
}
export function ok(value, message) { if (!value) fail(message, `expected a truthy value, got ${String(value)}`); }
export function equal(actual, expected, message) { if (!Object.is(actual, expected)) fail(message, `${String(actual)} !== ${String(expected)}`); }
export function notEqual(actual, expected, message) { if (Object.is(actual, expected)) fail(message, `${String(actual)} === ${String(expected)}`); }
export function deepEqual(actual, expected, message) { if (!same(actual, expected)) fail(message, `${JSON.stringify(actual)} does not deep-equal ${JSON.stringify(expected)}`); }
export function match(text, pattern, message) { if (!pattern.test(text)) fail(message, `${text} does not match ${pattern}`); }
export function throws(fn, expected, message) {
  try { fn(); } catch (error) {
    if (!matches(error, expected)) fail(typeof expected === 'string' ? expected : message, `the thrown value did not match: ${String(error)}`);
    return;
  }
  fail(typeof expected === 'string' ? expected : message, 'Missing expected exception.');
}
export async function rejects(promise, expected, message) {
  try { await (typeof promise === 'function' ? promise() : promise); } catch (error) {
    if (!matches(error, expected)) fail(message, `the rejection did not match: ${String(error)}`);
    return;
  }
  fail(message, 'Missing expected rejection.');
}
const assert = Object.assign((value, message) => ok(value, message), { ok, equal, notEqual, deepEqual, strictEqual: equal, deepStrictEqual: deepEqual, match, throws, rejects, AssertionError });
export default assert;
