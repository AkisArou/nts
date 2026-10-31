// expect: emit-jvm -> lacks-interface nts.gen.Closure0 nts.rt.NtsTextPairCallback
// Control: the same arrow is private, so no caller outside the library can
// invoke it and its dead body must remain absent.
let last = "";
const joiner = (a: string, b: string): void => {
  last = a + "|" + b;
};
void joiner;
export function lastSeen(): string { return last; }
