// expect: emit-c --napi -> calls Object.getPrototypeOf(exports.subject("x")) === Object.prototype && Object.getPrototypeOf(exports.control("x")) === Object.prototype && exports.subject("x").VALUE === "x" && exports.control("x").VALUE === "x"
//
// util.parseEnv's Node26 result is a null-prototype dictionary. Only the
// dictionary construction differs below; keys, values and return type match.
// Node gives null for the subject's prototype and Object.prototype for the
// control. The recorded wrapper condition describes the wrong subject shape;
// flip it to null when the boundary preserves the construction contract.
export function subject(value: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  result.VALUE = value;
  return result;
}
export function control(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  result.VALUE = value;
  return result;
}
