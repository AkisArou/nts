// expect: a generic method used as a value
//
// A method with type parameters of its own is lowered once per type a call pins
// (`tests/programs/a-closure-calling-a-throwing-generic-method-inside-a-try`). Read
// as a value it is one function object for every type it may later be called at,
// and no one copy is that object, so it is refused by name. The control is the
// same method called directly, which that fixture compiles.

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
