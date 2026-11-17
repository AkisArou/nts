// expect: a function returning the type parameter `T`
//
// A method with type parameters of its own is lowered once per type a call pins
// (`tests/programs/a-closure-calling-a-throwing-generic-method-inside-a-try`) -- where
// the call's dispatch is direct. A dispatch slot holds one entry, so a call that
// dispatches, because a subclass overrides the method, reaches the method's one
// unspecialized body, as before instances existed: it refuses wherever the method's
// parameters reach a representation, and the slot stops by name. A slot per instance
// is what would compile this; the control is that fixture's `Picker#pick`, which
// nothing overrides and which compiles per instance.

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
