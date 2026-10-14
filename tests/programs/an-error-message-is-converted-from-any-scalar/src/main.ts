// `new Error(message)` stores ToString(message), and an `undefined` message
// leaves the empty one. The message was stored as lowered: a bigint went into
// a string field (invalid HIR, the whole program refused), and `null as any`
// -- a null at the string type its context gave it -- erased as a present
// string and crashed when read, because a lone `null` was not recognised as an
// absence when erased. From the Codex branch's e51ababaa fixture.
export function explicitUndefined(n: number): number {
  return new Error(undefined).message.length + n * 0;
}
export function dynamicUndefined(n: number): number {
  const message = n < 0 ? undefined : "message";
  return new Error(message).message.length;
}
export function erasedUndefined(n: number): number {
  const message = n < 0 ? undefined : "message";
  return new Error(message as any).message.length;
}
export function numericMessage(n: number): number {
  return new Error((n + 1) as any).message.length;
}
export function booleanMessage(n: number): number {
  return new Error((n < 0) as any).message.length;
}
export function bigintMessage(n: number): number {
  // @ts-expect-error JavaScript Error performs ToString on a BigInt; TS narrows its signature.
  return new Error(12345678901234567890n).message.length + n * 0;
}
export function nullMessage(n: number): number {
  return new Error(null as any).message.length + n * 0;
}
export function nullableString(n: number): number {
  const message = n < 0 ? null : "message";
  return new Error(message as any).message.length;
}
export function scalarUnion(n: number): number {
  const message: number | undefined = n < 0 ? undefined : n;
  return new Error(message as any).message.length;
}
