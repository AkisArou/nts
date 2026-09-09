// expect: `kind` on a union, whose members lay their fields out differently
//
// Reading a field common to both members of a union is refused when the two
// classes lay their fields out differently. Reading the same field from one
// class lowers, so it is the union and not the field.
//
//     left.kind                    -> lowers
//     (left | right).kind          -> REFUSED
//
// `singleClass` is the control. Without it the diagnostic reads as "`kind` is
// not readable", which is false.
//
// Both members here declare `kind` first and a second field of a different
// type, which is what makes the layouts differ -- a discriminated union, the
// ordinary way to write one. 40 distinct sites in `runtime/node`, counted as
// sites rather than summed over cones.

export class Left {
  kind: "l";
  n: number;
  constructor() {
    this.kind = "l";
    this.n = 1;
  }
}

export class Right {
  kind: "r";
  s: string;
  constructor() {
    this.kind = "r";
    this.s = "x";
  }
}

export function singleClass(left: Left): string {
  return left.kind;
}

export function unionField(value: Left | Right): string {
  return value.kind;
}
