// expect: a call of a function value in a program with no closures
//
// A value of a function type called from TypeScript, in a program that
// creates no closure of its own: every `Pair` arrives from outside, as a Java
// lambda through the published face, or a native caller. Lowering declares
// the uniform erased entry (`erased_call_slot`) only when some TypeScript
// closure exists, so with none there is no entry to call through and
// `f("x", "y")` refuses. On the JVM the same gap also costs the export its
// typed overload: `keep(f: Pair)` publishes only `keep(Fn…)`, no
// `keep(NtsTextPairCallback)`, so a Java caller cannot even pass a lambda.
//
// Control, one difference: add `export const ignore: Pair = (_a: string,
// _b: string): void => {};` -- one TypeScript closure anywhere -- and the
// program lowers with nothing refused. The fix the compiler lane agreed
// (2026-10-09): declare the erased entry when a signature with a face is
// called or published, not only when a closure exists.
export type Pair = (a: string, b: string) => void;

export function callFromTypeScript(f: Pair): void {
  f("x", "y");
}
