// expect: a call to the generic method `pick`, which a subclass overrides
//
// A method with type parameters of its own is lowered once per type a call pins
// (`tests/programs/a-closure-calling-a-throwing-generic-method-inside-a-try`), and
// a dispatch slot holds one entry -- so a call that dispatches, because a subclass
// overrides the method, has no copy to reach through it. Refused by name until a
// slot per instance exists. The control is that fixture's `Picker#pick`, which
// nothing overrides and which compiles.

class Picker {
  pick<T>(values: T[], at: number): T {
    return values[at % values.length];
  }
}

class Last extends Picker {
  override pick<T>(values: T[], at: number): T {
    return values[values.length - 1 - (at % values.length)];
  }
}

export function picked(n: number): number {
  const picker: Picker = n & 1 ? new Last() : new Picker();
  return picker.pick([3, 1, 4], n & 3);
}
