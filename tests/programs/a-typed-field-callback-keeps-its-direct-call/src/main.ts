// A field-held callback with an already-typed argument may keep the typed
// body. A forwarding function whose callback signature admits any has to
// retain the uniform entry's argument obligations.
// The optional field exercises the existing field-devirtualization path.
// Its one erase stores the closure in the field; n reaches #call as f64.
// Clean main 6ead61dae14e (binary 2e88745755bd6263): C, LLVM, JVM and Wasm
// each agree on all 58 cases across 2 exports, with no refused/declined cases.
class Box {
  callback?: (value: number) => number = (value: number): number => value + 3;
}

export function typedField(n: number): number {
  const box = new Box();
  return box.callback!(n);
}

export function forward(callback: (value?: any) => number, n: number): number {
  return callback(n);
}

export function forwardedControl(n: number): number {
  const callback = (value: number): number => value + 3;
  return forward(callback, n);
}

// expect-ir: all: no tagof in typedField
// expect-ir: all: no call.extern(nts_refused) in typedField
// expect-ir: all: no call.closure in typedField
// expect-ir: all: count erase in typedField == 1
// expect-ir: all: count tagof in Closure1#erased_call == 1
// expect-ir: all: count call.extern(nts_refused) in Closure1#erased_call == 1
