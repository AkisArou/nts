// expect: a union of a function type | undefined
// Node v26.13.0 lib/internal/streams/iter/transform.js:306,468,503 and the
// runtime/node/zlib/src/iter.ts nativeWrite seam call signal.throwIfAborted.
// The shared StreamAbortSignal spells that method as optional. A non-null
// assertion erases on Node; nts refuses the optional function representation.
// The control changes only the method signature's optional marker.

interface OptionalSignal {
  throwIfAborted?(): number;
}

interface RequiredSignal {
  throwIfAborted(): number;
}

class Signal {
  throwIfAborted(): number { return 17; }
}

function callOptional(signal: OptionalSignal): number {
  return signal.throwIfAborted!();
}

function callRequired(signal: RequiredSignal): number {
  return signal.throwIfAborted();
}

export function optionalSignature(): number {
  return callOptional(new Signal());
}

export function requiredSignature(): number {
  return callRequired(new Signal());
}
