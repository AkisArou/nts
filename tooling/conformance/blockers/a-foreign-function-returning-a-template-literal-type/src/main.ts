// expect: NTS1001 a returned string of unrepresentable type (a template literal type)
//
// A template literal type is refused, though every value of one is a string.
// lib.dom declares `crypto.randomUUID()` as returning
// `${string}-${string}-${string}-${string}-${string}`, so a program calling
// it (bound by the Chromium lane, Blink's Crypto) is refused; the same type
// on a function the program defines is refused too, at another site ("a
// function returning a template literal type"). Lowered as the string it
// is, both would compile. Found 2026-10-08 by the Chromium lane.
//
// Control, one difference -- `make_id` declared returning `string`
// (types/host.d.ts): nothing refused.
import { make_id } from "host";

export function idLength(): number {
  return make_id().length;
}
