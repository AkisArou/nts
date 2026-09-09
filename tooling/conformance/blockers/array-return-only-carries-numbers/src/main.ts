// expect: emit-c --napi -> emits-addon napi_set_named_property(env, exports, "texts"
//
// Spelled `emits-addon` and not `publishes texts`, which would be the natural
// form and cannot state this: `publishes X` also requires the module to have no
// wrapper declines at all, and the declines are the point. The same conflation
// `lowers` was added for -- an expectation about one export should not be
// answerable by the state of the others.
//
// **Two of the five now cross.** The expectation moved from `nums` to `texts`
// deliberately: `nums` was the control saying the array machinery exists, and
// `texts` is the first thing that machinery was extended to carry, so guarding
// it is what catches a regression. `nums` stays below as the control it was.
//
//     number[]        published        Row[]          returns an object[]
//     string[]        published        Fn[]           returns an object[]
//     boolean[]       published        Uint8Array[]   returns TypedArray[]
//
// `Cross::Numbers` was `number[]` and nothing else, which made one case the
// shape of the whole boundary -- 71 signatures across ten of node's modules
// differing in nothing but element type. It is `Cross::Elements(Box<Cross>)`
// now: an array crosses when the thing in it does, so the refusal belongs to
// the element and moves when the element does.
//
// The three that remain are the three whose *elements* still refuse. An object
// needs its layout's descriptor to be rebuilt and a view carries the ownership
// question, both of which are refusals this file does not own.
//
// **Outward only for the new kinds.** An array of references has to be
// allocated on this side to be filled, and allocation needs a descriptor
// `program.c` keeps -- the same wall an object parameter meets. `number[]` is
// the one that does not, because `nts_from_napi_numbers` takes its descriptor
// from the runtime.
//
// Verified by running it rather than by reading the emitted C:
//
//     nums()  [ 1 ]     texts()  [ 'a' ]     bools()  [ true ]
//
interface Row {
  name: string;
  size: number;
}
type Fn = (a: number) => number;

// The control. Must keep publishing.
export function nums(): number[] {
  return [1];
}

export function texts(): string[] {
  return ["a"];
}

export function bools(): boolean[] {
  return [true];
}

export function rows(): Row[] {
  return [{ name: "r", size: 1 }];
}

export function fns(): Fn[] {
  return [(a: number) => a];
}

export function views(): Uint8Array[] {
  return [new Uint8Array(1)];
}
