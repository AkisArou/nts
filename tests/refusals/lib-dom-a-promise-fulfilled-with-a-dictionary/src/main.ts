// expect: a type with no native ABI is not supported by this lowering yet
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md):
// a promise fulfilled with a dictionary -- `navigator.storage.
// estimate()` answering a StorageEstimate -- would bind as a foreign
// function returning `Promise<StorageEstimate>` with the dictionary as
// its C struct (src/estimate.d.ts), the adapter filling the struct from
// Blink's dictionary when Blink's promise settles. A foreign promise
// settles through the runtime's slots -- a number, a reference, an
// erased value, a C pointer -- and a record is none of them, so the
// return is refused by name; `Promise<ByValue<...>>` and `Promise<Ptr<
// ...>>` spellings refuse too ("a call result of unrepresentable type
// (`Promise`)"), as does the lib.dom interface itself as the settled
// type. Found 2026-10-17 by the Chromium lane binding dictionary
// results; the synchronous half is lib-dom-a-dictionary-result-with-a-
// string-member and lib-dom-a-dictionary-result-reading-a-given-member.
//
// Control, one difference -- the same manager's promise of a boolean,
// `navigator.storage.persisted()` -- emits and is bound today.

export async function go(): Promise<string> {
  const persisted = await navigator.storage.persisted();
  const e = await navigator.storage.estimate();
  return "" + persisted + "," + (e.usage ?? -1) + "," + (e.quota ?? -1);
}
