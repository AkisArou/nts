// expect: emit-c --napi -> emits-addon napi_set_named_property(env, exports, "nums"
//
// Spelled `emits-addon` and not `publishes nums`, which would be the natural
// form and cannot state this: `publishes X` also requires the module to have no
// wrapper declines at all, and five declines are the point. The same conflation
// `lowers` was added for -- an expectation about one export should not be
// answerable by the state of the others.
//
// **`number[]` is the only array the wrapper can return.** Six functions
// differing in nothing but their element type:
//
//     number[]        published
//     string[]        no wrapper for texts: returns string[]
//     boolean[]       no wrapper for bools: returns bool[]
//     Row[]           no wrapper for rows:  returns an object[]
//     Fn[]            no wrapper for fns:   returns an object[]
//     Uint8Array[]    no wrapper for views: returns TypedArray[]
//
// The expectation is `publishes nums`, which is the control rather than the
// subject: it says the array machinery exists and works, so the other five are
// element kinds it was not given rather than arrays being unsupported. If
// `nums` ever stops publishing, this fixture is about something much larger and
// the diagnosis in it is wrong.
//
// **What it costs: 71 signatures across ten modules** -- `fs` 18, `util` 11,
// `stream` 10, `events` 8, `url` 5, `assert` 4, `path` 4, `http` 3, `dgram` 2,
// `net` 2. By element: `string` 24, `Dirent` 8, `Listener` 7, `Uint8Array` 5,
// `unknown` 5, and a long tail.
//
// It is how `os.cpus` fails at the wrapper -- `no wrapper for cpus: returns an
// object[]` -- which is a *second* blocker behind `NTS2010` on the same export,
// and it is why fixing the heterogeneous-tuple representation alone would not
// publish it. `os` is the module closest to green: 17 of node's 23 names.
//
// Distinct from `view-returns.py`'s 66, which is a *view* in return position --
// `Uint8Array`, not `Uint8Array[]`. The five `TypedArray[]` here are behind
// both.

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
