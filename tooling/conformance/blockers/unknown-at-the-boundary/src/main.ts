// expect: emit-c --napi -> no wrapper for takesUnknown: takes unknown
//
// `unknown` does not cross in either direction. Both subjects lower -- their
// bodies are emitted -- and the wrapper declines both:
//
//     no wrapper for takesUnknown: takes unknown
//     no wrapper for returnsUnknown: returns unknown
//
// `takesNumber` and `returnsNumber` are the controls and must keep crossing.
//
// `parameter-boundary-carries-four-types` surveys what a parameter can be --
// number, string, boolean, their arrays, views, objects, functions, optionals,
// unions, nullables -- and has no `unknown` among them. There is no
// return-direction survey with one either. So this is the form that survey did
// not cover, in both directions, with the return side stated separately because
// a fix for one does not imply the other: `view-parameter-crosses-outward-only`
// is already a case where the two directions came apart.
//
// Where it bites: `async_hooks` publishes thirteen exports and passes nothing,
// and four of its fifteen declines are this --
//
//     pushAsyncContext        takes unknown
//     emitBefore              takes unknown
//     registerDestroyHook     takes unknown
//     executionAsyncResource  returns unknown
//
// which is most of the profile's six `takes unknown` and its only
// `returns unknown`. `unknown` is what `async_hooks` passes around, because an
// async resource is whatever the caller made it.

export function takesNumber(value: number): number {
  return value;
}

export function returnsNumber(flag: boolean): number {
  return flag ? 1 : 0;
}

export function takesUnknown(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

export function returnsUnknown(flag: boolean): unknown {
  return flag ? 1 : "one";
}
