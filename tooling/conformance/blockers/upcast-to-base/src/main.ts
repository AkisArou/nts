// expect: emit-c --napi -> fails-to-compile incompatible pointer types assigning
//
// **The expectation names a clang error, not a string in `program.c`.** It said
// `emits-c <text>` and that is a substring match: a fragment taken from broken
// output can also occur in correct output, and this one did. It reported
// `reproduces` after the defect was fixed, and would have gone on doing so.
//
// A subclass instance assigned to a base-typed binding emits C that clang
// rejects:
//
//     error: incompatible pointer types assigning to 'NtsObj_Base *'
//            from 'NtsObj_Derived *'
//
// Eight lines, nothing refused, and `emit-c` reports success. In C a derived
// struct is not a base struct even when it begins with one, so an upcast needs a
// cast at the assignment -- the emitter writes the assignment without it.
//
// This is the most ordinary operation in an object-oriented program, which is
// why it is worth being explicit about how it went unnoticed: **nothing in the
// corpus reached it.** Twelve modules were stopped earlier by
// `duplicate-type-name`, and clang's twenty-error limit meant the collisions
// crowded everything behind them off the list. It became visible the same hour
// the collisions were fixed.
//
// Found while trying to reproduce a *different* defect -- the fourth failed
// hypothesis about `Closure54__call` -- which is the second time today that a
// wrong guess produced a real fixture. The class hierarchy was in the file only
// to push the closure call slot above zero.

class Base {
  kind(): number {
    return 1;
  }
}

class Derived extends Base {
  override kind(): number {
    return 2;
  }
}

export const made: Base = new Derived();

export function touch(): number {
  return made.kind();
}
