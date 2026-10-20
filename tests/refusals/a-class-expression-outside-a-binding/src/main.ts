// expect: a class expression is not supported
//
// A class expression anywhere but a binding's initializer -- an argument, an
// assignment, a conditional's operand -- is refused by name,
// at the expression. Evaluating one runs its static fields and blocks, which
// this lowering does only where a binding holds the class
// (`evaluate_a_class_initializer`): `const C = class { static { bump(); } }`
// runs the block, as node does, and is tests/programs/a-class-expression-runs-
// its-statics.
//
// Kept as a guard so that a change admitting these positions has to evaluate
// the class there too: a class expression that lowered as a value and skipped
// its statics would be a silent wrong answer, the defect the binding form had
// until 2026-10-20.

let bumped = 0;

function bump(): number {
  bumped = bumped + 1;
  return bumped;
}

function take(c: unknown): number {
  return c === undefined ? 1 : 0;
}

let held: unknown;

export function asArgument(n: number): number {
  bumped = 0;
  take(
    class {
      static {
        bump();
      }
    },
  );
  return bumped + n * 0;
}

export function asAssignment(n: number): number {
  bumped = 0;
  held = class {
    static {
      bump();
    }
  };
  return bumped + n * 0;
}

export function asOperand(n: number): number {
  bumped = 0;
  const k =
    n > -1
      ? class {
          static {
            bump();
          }
        }
      : undefined;
  return bumped + (k === undefined ? 1 : 0) + n * 0;
}
