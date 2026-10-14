// **An `in` on an interface, beside a generic interface of the same shape.**
// `describe` takes a `Settled` and asks `"reason" in settled`. An interface can
// hold any object of its shape, so the question is answered over every object
// type that declares `reason`, and one that declares it optionally is tested
// by its presence bit, which comes from its layout. The declared `Box<T>` is
// such a type, and its `value?: T` has no representation where nothing binds
// `T`: building its layout failed, and `describe` was refused with
// "a property `value` of unrepresentable type" -- a type it never sees.
//
// **The guard.** Only an erased copy ever lays out an open type (a typed copy
// allocates the instantiation), so the candidate is now laid out with its
// unbound parameters erased, which is that copy's layout and the same field
// order, so the same bit. The answer must still be right both ways:
//
// - the original program: a literal `Settled` without a reason reads "rejected
//   without a reason", a `Box<number>` reads its status;
// - a `Made<T>` built by a generic function, with and without `reason` set,
//   reaches the same kind of `in` through `Made<boolean>`, so the bit is read
//   on an instantiated type and on a missing write.
//
// Was `tests/refusals/` (a stage-B regression; React's
// `trackUsedThenable<erased>` was refused the same way). Found by the React lane.
interface Box<T> {
  then(onFulfill: (value: T) => unknown): unknown;
  status: string;
  value?: T;
  reason?: unknown;
}

const box: Box<number> = {
  then(onFulfill: (value: number) => unknown): unknown {
    return onFulfill(1);
  },
  status: "fulfilled",
  value: 1,
};
observe("a box's status", box.status);

interface Settled {
  then(onFulfill: (value: boolean) => unknown): unknown;
  status: string;
  value?: unknown;
  reason?: unknown;
}

function describe(settled: Settled): string {
  if (settled.status === "rejected" && !("reason" in settled)) {
    return "rejected without a reason";
  }
  return settled.status;
}

const rejected: Settled = {
  then(onFulfill: (value: boolean) => unknown): unknown {
    return undefined;
  },
  status: "rejected",
};
observe("a literal without a reason", describe(rejected));

interface Made<T> {
  then: (onFulfill: (value: T) => unknown) => unknown;
  status: string;
  value?: T;
  reason?: unknown;
}

interface MadeSettled {
  then: (onFulfill: (value: boolean) => unknown) => unknown;
  status: string;
  value?: unknown;
  reason?: unknown;
}

function describeMade(settled: MadeSettled): string {
  if (settled.status === "rejected" && !("reason" in settled)) {
    return "rejected without a reason";
  }
  return settled.status;
}

function make<T>(value: T, withReason: boolean): Made<T> {
  const made: Made<T> = {
    then: (onFulfill: (value: T) => unknown): unknown => onFulfill(value),
    status: "rejected",
  };
  if (withReason) {
    made.reason = "because";
  }
  return made;
}

observe("made with a reason", describeMade(make(true, true)));
observe("made without one", describeMade(make(false, false)));
done();
