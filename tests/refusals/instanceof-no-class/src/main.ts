// expect: nothing refused -- FIXED, kept as a guard
//
// Every `instanceof` in this file lowers now. It was filed for the third root
// of `determineSpecificType`, in `staticObjectName`, and it tested per class
// rather than as a chain because the answer differed per class:
//
//     Uint8Array   ok        DataView   ok  (was NO CLASS)
//     ArrayBuffer  ok        Map        ok  (was NO CLASS)
//     Promise      ok        Set        ok  (was NO CLASS)
//                            Date       ok  (was NO CLASS)
//
// None of the four is a class here and none ever will be. Each is one struct
// and one descriptor, so there is no per-class layout for the class search to
// find, and the runtime answers by descriptor comparison instead --
// `nts_is_data_view`, `nts_is_date`, `nts_is_map`, `nts_is_set`. A typed array
// needs a kind beside the descriptor because nine share one struct; these do
// not, except `Map` and `Set`, which share one struct with each other and are
// told apart by `holds_values`.
//
// **`DataView` was the widest single root on the board when it landed**:
// `errors.ts:102` under `staticObjectName` -> `determineSpecificType` ->
// `ERR_INVALID_ARG_TYPE`, and `buffer/src/main.ts:182,194` under
// `objectToBuffer` -> `Buffer.from`. One class, one form, two files, both cones.
//
// Two things had to be true and only one was obvious. The predicate is half a
// feature if a *constructed* value cannot reach an `unknown` to be asked about,
// and `erasable` had learned neither `DataView` nor `Date` -- found by the JVM
// lane failing to exercise their half and the C lane refusing the identical
// program, which is what said the gap was upstream of either backend.
//
// `a-constructed-dataview-reaches-unknown` and `a-map-is-not-a-set` hold the
// other halves: that the value gets in, and that the two sharing a struct
// disagree.

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
