// **A record held in an erased slot and read back through an interface of named
// fields crashes, with no diagnostic.** `fiber.pendingProps as SuspenseProps` is an
// unchecked unerase to a laid-out type: the value is a table, the read is at the
// interface's struct offsets, and the program dies on what it finds. node prints
// `boundary 2`.
//
// The control is the same slot read as the record it is, by key -- React's
// `probes/erased-props-as-record`, which prints `boundary 2` on nts as well. It is
// not an arm here because the subject aborts and an abort reports no observation,
// so a control beside it would be erased rather than shown.
//
// Not the same defect as the static crossing 7db48279c refused. That one is a
// struct pointer arriving where a table is wanted, caught at `coerce` by name;
// this is the same mismatch reached through an **erased** slot, where nothing looks.
// The React lane found it while measuring what blocks a static tree from mounting:
// their port reads every built-in component's props this way, about forty sites, and
// every one of them is on the render path.
//
// **The fix is a checked unerase, and the thing to check is the layout rather than
// the type.** An object laid out for `SuspenseProps` carries that layout's
// descriptor, so a table fails the test and stops by name. `Layout::types` merges
// structurally identical types, so the descriptor cannot tell two same-shaped
// interfaces apart -- which is not a hole: what the read needs is that the
// **offsets** are right, and same-layout is exactly that statement. When it lands
// this reads CHANGED, and `nts` says whether it stops by name or answers.
type Props = Record<string, unknown>;

interface SuspenseProps {
  name?: string;
  count?: number;
}

class Fiber {
  pendingProps: unknown = null;
}

function describe(fiber: Fiber): string {
  const props = fiber.pendingProps as SuspenseProps;
  return String(props.name) + " " + String(props.count);
}

const fiber = new Fiber();
const props: Props = { name: "boundary", count: 2 };
fiber.pendingProps = props;
observe("a record read through an interface", describe(fiber));
done();
