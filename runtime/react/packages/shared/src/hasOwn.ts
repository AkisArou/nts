// Whether `key` is an own property of `object`: a fork point, since the fast
// test here is reflection a native program does not have (hasOwn.native.ts).
//
// Upstream's `shared/hasOwnProperty` is this function, called as
// `hasOwnProperty.call(object, key)`. V8 answers that from the enumeration
// cache inside a `for...in` over `object`, and does not for `Object.hasOwn`:
// createElement's props loop took 40% longer with it. A function around the
// call is inlined and keeps the fast path.

const hasOwnProperty = Object.prototype.hasOwnProperty;

export function hasOwn(object: { readonly [key: string]: unknown }, key: string): boolean {
  return hasOwnProperty.call(object, key);
}
