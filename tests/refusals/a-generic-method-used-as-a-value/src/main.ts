// expect: a parameter of unrepresentable type (an array of the type parameter `T`)
//
// A method with type parameters of its own is lowered once per type a call pins
// (`tests/programs/a-closure-calling-a-throwing-generic-method-inside-a-try`). Read as
// a value it is one function object for every type it may later be called at, so the
// wrapper forwards to the method's one unspecialized body, as before instances
// existed, and refuses where the method's parameters reach a representation. An erased
// kernel per value, as a generic function has, is what would compile this; the control
// is the same method called directly, which that fixture compiles.

class Picker {
  pick<T>(values: T[], at: number): T {
    return values[at % values.length];
  }
}

function apply(choose: (values: number[], at: number) => number, n: number): number {
  return choose([3, 1, 4], n & 3);
}

export function picked(n: number): number {
  const picker = new Picker();
  return apply(picker.pick, n);
}
