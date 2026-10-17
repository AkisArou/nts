// A field-held callback with an already-typed argument may keep the typed
// body. A forwarding function whose callback signature admits any has to
// retain the uniform entry's argument obligations.
class Box {
  callback: (value: number) => number = (value: number): number => value + 3;
}

export function typedField(n: number): number {
  const box = new Box();
  return box.callback(n);
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
