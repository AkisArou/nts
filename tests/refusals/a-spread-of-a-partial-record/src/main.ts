// expect: NTS1001 an erased value where a concrete representation is wanted

// `{ ...prev, ...partial }` with `partial: Partial<State>`: a class
// component's `setState` merge, which the React stage writes per class
// because it cannot name the fields (runtime/react/CLASS-COMPONENTS.md,
// "State merges by type"). The same merge written field by field with `in`
// compiles, and keeps presence as `Object.assign` does:
//
//     count: "count" in partial ? partial.count! : prev.count,
//
// so the spread is representable. Filed from the React lane.

type State = { count: number; label: string; flag: boolean };

function merge(prev: State, partial: Partial<State>): State {
  return { ...prev, ...partial };
}

const one = merge({ count: 1, label: "a", flag: false }, { count: 2 });
export const answer = String(one.count) + one.label + String(one.flag);
