// expect: emit-jvm -> implements-interface nts.gen.Closure0 nts.rt.NtsTextPairCallback
// An exported value is callable from outside the library, just like a closure
// returned by a public function. No TypeScript call keeps this arrow alive.
// On the previous compiler Closure0 has no call body or callback interface.
// The one-difference control removes only `export` from joiner and remains dead:
// tests/refusals/a-private-unused-closure-has-no-outside-caller.
let last = "";
export const joiner = (a: string, b: string): void => {
  last = a + "|" + b;
};
void joiner;
export function lastSeen(): string { return last; }
