// expect: NTS1001 a property `value` of unrepresentable type (a union of the type parameter `T` | undefined)
//
// **An `in` on an interface is refused because of a field of a different,
// generic interface.** `describe` takes a `Settled`, which is not generic, and
// asks `"reason" in settled`. It is refused with `Box<T>`'s `value?: T` in
// the message. `describe` never sees a `Box`; the program's only `Box` is a
// `Box<number>`, and its `then` takes a `number` where `Settled`'s takes a
// `boolean`. What the two share is a shape: `then`, `status`, `value?`,
// `reason?`.
//
// **Control**, measured and not kept in this file: the same program with
// `Box`'s `value?: T` written `value?: number`. That is a one-line difference,
// and it compiles and prints node's `fulfilled` and
// `rejected without a reason`. Replacing the `in` with
// `settled.reason === undefined` also compiles and agrees. A control can't
// sit beside the subject here, because the defect is program-wide: an
// earlier draft added a second, clean interface and function to this file,
// and its `in` was refused with the same message.
//
// **New since da4a2a4a8.** That compiler compiled this program and printed
// node's lines; main at efc71ad44 refuses `describe`. If `Box` and `Settled`
// lose `then` and `status`, both compilers refuse, and the older one says "an
// `in` naming `reason`, which 1 of this union's 2 arms declare optionally".
// The form with a method is the one that regressed.
//
// **Found by the React lane.** React's `trackUsedThenable<T>` has this shape
// (ReactFiberThenable.ts:188): `!("reason" in thenable)` on a `Thenable<T>`,
// which itself declares `value?: T`; asked of `Settled<T>` with `value?: T`,
// the probe for this refuses on main too. Its `<erased>` copy compiled on
// da4a2a4a8 and is refused now. That refuses `unwrapThenable<erased>` (a
// thenable child in the child reconciler, ReactChildFiber.ts:244) and
// `useThenable<erased>`.
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
console.log(box.status);

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
console.log(describe(rejected));
