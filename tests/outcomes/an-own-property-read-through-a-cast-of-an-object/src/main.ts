// **Ours, not upstream's: an object's own property, asked about through a
// cast, reads as absent.** React reads an element's `$$typeof` this way
// (shared/ReactPerformanceTrackProperties.ts:88):
//
//     "$$typeof" in value && hasOwn(value, "$$typeof") ? (value as { $$typeof?: unknown }).$$typeof : undefined
//
// with `hasOwn(object: { readonly [key: string]: unknown }, key)` calling
// `Object.hasOwn`. Given `{ $$typeof: 7 }` typed `object`, node answers
// `true`, `true`, `7`. Compiled, `in` agrees, but `hasOwn` through the
// index-signature cast answers `false` and the read through
// `{ $$typeof?: unknown }` answers `null`. Nothing is refused: these are
// silent wrong answers.
//
// Two controls, each agreeing: `in` on the same value, and the same property
// read from a binding declared with the record type rather than cast to it.
//
// Observed in one function, as here. Written instead as three `observe` calls
// at the cast sites, the same program ended in SIGSEGV on ede19442c.
//
// Found by the React lane, reducing the root behind React's
// mountChildFibers / reconcileChildFibers module-init skip (ede19442c).
//
// **Expected, confirmed under node:**
//
//     in, hasOwn, read through a cast       true true 7
//     read from a typed binding (control)   7
function hasOwn(object: { readonly [key: string]: unknown }, key: string): boolean {
  return Object.hasOwn(object, key);
}

function probe(value: object): string {
  const has = "$$typeof" in value;
  const own = hasOwn(value as { readonly [key: string]: unknown }, "$$typeof");
  const read = (value as { $$typeof?: unknown }).$$typeof;
  return String(has) + " " + String(own) + " " + String(read);
}

const typed: { $$typeof?: unknown } = { $$typeof: 7 };
observe("in, hasOwn, read through a cast", probe({ $$typeof: 7 }));
observe("read from a typed binding (control)", String(typed.$$typeof));
done();
