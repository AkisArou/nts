// expect: emit-c --rc -> emits-c x_ticker_every(
//
// A delegated call chooses among the binding's overloads by each one's own
// parameters (`overload_signature`), and each overload writes its callback's
// type -- `Closure<(at: Float64) => void>` twice is two function types. The
// frontend decomposed only the first overload's types, the checker's type of
// an overloaded member being its first signature's, and a delegated call is
// resolved to the program's declaration rather than the binding's, so
// nothing else reached the second: its callback was a placeholder, "a type
// with no native ABI". Every overload of a foreign member (a native symbol)
// is recorded now (`decompose::resolve_callable`); a library type's are left
// as they were. types/ticker.d.ts is lib.dom and nts:dom in miniature.
//
// **Kept as a guard from the day it was written (2026-10-07)**, by MainClaude:
// found choosing between the Chromium lane's two `addEventListener`
// overloads, before the lane's binding shared one alias for the callback.
//
// Control, one difference -- both overloads naming one alias
// (`type Callback = Closure<(at: Float64) => void>`): nothing refused before
// this either.

export function go(): number {
  const state = { n: 0 };
  return ticker.start((at: number) => { state.n += at; }, 16);
}
