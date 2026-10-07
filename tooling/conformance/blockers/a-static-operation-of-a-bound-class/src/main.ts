// expect: emit-c --rc -> emits-c x_ticker_parse_base(
//
// A static operation of a class a binding implements: lib.dom's
// `URL.canParse(x)` is a member of `declare var URL`, and the binding names
// it `<Interface>_<member>` -- `URL_canParse` -- beside the type it binds, as
// it names the constructor `new<Interface>`. `delegated_static` finds it from
// the interface the receiver's name also declares, and the call takes the
// overload its arguments fit, as a bound method's does.
//
// **Kept as a guard from the day it was written (2026-10-08)**, by MainClaude,
// for the Chromium lane binding Blink's static operations (AbortSignal.timeout,
// URL.canParse, DOMRect.fromRect, ...). types/ticker.d.ts is lib.dom and
// nts:dom in miniature.
//
// Control, one difference -- one argument: `x_ticker_parse(`, the other
// overload.

export function go(): number {
  return Ticker.parse("12", 16);
}
