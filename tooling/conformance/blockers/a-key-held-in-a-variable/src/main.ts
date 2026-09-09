// expect: `key`, which `Options` does not declare
//
// A computed member read whose key is a **variable**, where the interface
// declares that key. The message says the type does not declare it, and the
// type does.
//
// # What it is standing in front of
//
//     stream/src/state.ts:64   options[duplexKey]
//         getHighWaterMark                      refused here
//         ReadableState#constructor             cannot be compiled, it calls getHighWaterMark
//         Readable#constructor                  cannot be compiled, it calls ReadableState
//         Readable                              no wrapper: a class whose constructor was not compiled
//
// Against the compiled `stream` addon: 249 failing test files, **59 of them
// stopping at `Readable is not a constructor`** -- the second largest
// concentration in the tree after `http.createServer`. `WritableState` cascades
// off the same function, so `Writable` goes with it.
//
// `duplexKey` is declared
// `"readableHighWaterMark" | "writableHighWaterMark"`, and
// `HighWaterMarkOptions` declares both of those keys as optional numbers. There
// is nothing undeclared anywhere in it.
//
// # Three controls, and the second is the surprise
//
//     options[key]  key: "a" | "b"     refuses
//     options[key]  key: "a"           refuses    <- a single literal, still refuses
//     options["a"]  written in source  compiles
//
// **It is not the union.** A key whose type is one string literal that the
// interface declares refuses exactly as a two-member union does. What compiles
// is the literal written at the site.
//
// So the condition is that the key is *held in a variable at all*, and the
// message names the variable as though it were the property. A reader following
// the message goes looking for a missing member and finds the member.
//
// # It is not `annotated-const-read`
//
// That fixture reads `code` off an `Error`-typed parameter, and `Error` really
// does not declare `code` -- the message there is true and the defect is that
// the value's own type is narrower than the annotation. Here the declared type
// has the member. Same message, opposite fact, and the census groups them
// together because it groups by text.

interface Options {
  readableHighWaterMark?: number;
  writableHighWaterMark?: number;
}

export function readMark(
  options: Options,
  key: "readableHighWaterMark" | "writableHighWaterMark",
): number {
  return options[key] ?? 0;
}
