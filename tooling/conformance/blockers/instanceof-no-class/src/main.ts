// expect: NTS1001 an `instanceof` against something this compiler has no class
//         for
//
// The third root of `determineSpecificType`, in its `staticObjectName` helper.
// Tested per class rather than as a chain, because the answer differs:
//
//     Uint8Array   ok        DataView   NO CLASS
//     ArrayBuffer  ok        Map        NO CLASS
//     Promise      ok        Set        NO CLASS
//                            Date       NO CLASS
//
// `Promise` working and `Date` not is the sort of split worth having in a
// fixture: it says the mechanism exists and the table is incomplete, which is a
// different piece of work from building the mechanism.
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
