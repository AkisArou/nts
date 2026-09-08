// expect: emit-c --napi -> emits-c NtsValue value;
//
// FIXED, and kept as a guard. A required member typed exactly `undefined` used
// to emit a C field of type `void`, which is not a type a field can have; it
// takes storage now, as `NtsValue value;`. That was 228 of `util`'s clang
// errors' worth of the profile, and the same rule covers tuple elements -- the
// half-void `NtsObj_Tuple249` in the same file.
//
// A required property typed exactly `undefined` is emitted as a C field of type
// `void`, which is not a type a field can have and which clang rejects with
// "field has incomplete type". Nothing refuses: `nts hir` reports nothing, and
// `emit-c` succeeds and writes the broken struct. It fails at the C compiler,
// which is why no refusal count ever showed it.
//
// This began as a reading of `util`'s emitted program.c, where ten structs
// carry a bare-`void` field. Eight of them lose *every* field, and I reported
// that shape to the compiler lane as "a struct emitted with no field type
// resolved". That was wrong as a general rule, and two structs in the same file
// disprove it: `NtsObj_Type7151` resolves `kind`, `name`, `rawName` and `index`
// and voids only `value` and `inlineValue`, and `NtsObj_Tuple249` resolves one
// slot and voids the other. Void-ness is per field.
//
// The two controls are the point, because the obvious reading is that optional
// members are what break -- `QueuingStrategy.highWaterMark?: number` is void in
// the real output, and an optional number is not an exotic type. Both controls
// compile clean, emitting `NtsValue`:
//
//   interface Sink { type?: undefined; write?: (c: number) => void }   -> NtsValue
//   interface Strategy { highWaterMark?: number; size?: ... }          -> NtsValue
//
// So optionality is exonerated and `undefined` alone is not enough either --
// `type?: undefined` is fine. It is `undefined` as a *required* member that
// breaks. That is the shape `util/src/parse-args.ts` declares in one arm of
// ParseArgsOptionToken, and those two fields are exactly the two that voided.
//
// This does NOT explain the eight all-void Streams dictionaries. Their standalone
// forms compile, so something about their real context is a second cause, and it
// is not this one. Recorded so the two are not merged again.
interface Token {
  kind: string;
  index: number;
  value: undefined;
}

export function name(t: Token): string {
  return t.kind;
}
