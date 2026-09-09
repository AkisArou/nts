// expect: NTS1001 an `instanceof` against something this compiler has no class
//         for
//
// The third root of `determineSpecificType`, in its `staticObjectName` helper.
// Tested per class rather than as a chain, because the answer differs:
//
//     Uint8Array   ok        DataView   ok  (was NO CLASS)
//     ArrayBuffer  ok        Map        NO CLASS
//     Promise      ok        Set        NO CLASS
//                            Date       NO CLASS
//
// `Promise` working and `Date` not is the sort of split worth having in a
// fixture: it says the mechanism exists and the table is incomplete, which is a
// different piece of work from building the mechanism.
//
// **`DataView` crosses now and the refusal moved one line down, to `Map`.** It
// is not a class here for the reason a typed array is not: one struct and one
// descriptor, so there is no per-class layout for the search to find and the
// runtime answers it -- `nts_is_data_view`, a descriptor comparison, and unlike
// a view it needs no kind beside it because there is only one `DataView`.
//
// That was the widest single root on the board when it landed: `errors.ts:102`
// under `staticObjectName` -> `determineSpecificType` -> `ERR_INVALID_ARG_TYPE`,
// and `buffer/src/main.ts:182,194` under `objectToBuffer` -> `Buffer.from`. One
// class, one form, two files, both cones.
//
// `Map`, `Set` and `Date` are the same three lines each and are deliberately
// not done here: every one needs a method on the JVM's `NtsValue`, which is
// that lane's file, so each is a coordination rather than a change. The one
// measured to be widest went first.
export function name(value: object): string {
  if (Array.isArray(value)) return "Array";
  if (value instanceof Uint8Array) return "Uint8Array";
  if (value instanceof Promise) return "Promise";
  if (value instanceof DataView) return "DataView";
  if (value instanceof Map) return "Map";
  if (value instanceof Set) return "Set";
  if (value instanceof Date) return "Date";
  return "Object";
}
