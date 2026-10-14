// expect: NTS1001 a property `value` of unrepresentable type (a union of a conditional type | undefined)
//
// **An `in` on an interface is refused when the program also holds a generic
// interface of the same shape instantiated with a conditional type over an
// unbound parameter.** `describe` asks `"reason" in settled` of a `Settled`,
// and is refused for a property of `Box<Awaited<S>>`, a type it never sees:
// `statusOf<S>`, which nothing calls, casts to it. The refusal cuts the
// module-scope print that calls `describe`: the program prints nothing, and
// node prints `rejected without a reason`.
//
// The `in` is answered over every object type that declares `reason`, and an
// open candidate is laid out with its unbound parameters erased
// (outcomes/an-in-beside-a-generic-interface-of-the-same-shape, the fix this
// follows). `Box<Awaited<S>>`'s `value?: Awaited<S>` is not a bare parameter
// but a conditional type over one, so the erasure does not reach it and its
// layout still fails.
//
// **Control**, measured and not kept in this file: the same program with the
// cast written `value as Box<S>`, a one-type-argument difference. On
// aa913009a it compiles and prints node's line. On bcf750d4b, before that
// fix, both refuse alike (`a union of the type parameter T | undefined`).
//
// **Found by the React lane.** `trackUsedThenable`'s
// `!("reason" in thenable)` (runtime/react/packages/react-reconciler/src/
// ReactFiberThenable.ts:188) is this shape: the open candidate is
// `Thenable<Awaited<S>>`, which `useActionState`'s `handleActionReturnValue`
// and `updateActionStateImpl` cast to (ReactFiberHooks.ts:2196 and :2379).
// It refuses `trackUsedThenable<erased>`
// and through it the erased copies of `useThenable` and of the child
// reconciler's `unwrapThenable` (their typed copies stop first at the
// `Thenable` instantiation cast, ReactFiberThenable.ts:96). On aa913009a it is
// the `in` site's one remaining cause.
interface Box<T> {
  then(onFulfill: (value: T) => unknown): unknown;
  status: string;
  value?: T;
  reason?: unknown;
}

function statusOf<S>(value: unknown): string {
  return (value as Box<Awaited<S>>).status;
}

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
