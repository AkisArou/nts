// A family read the checker narrowed by a test: the subject and its controls.
interface Named {
  readonly displayName?: unknown;
}
class Context {
  displayName: string = "";
}

// Narrowed by `typeof`, every supplier a stored field: a string.
export function nameOf(named: Named): string {
  if (typeof named.displayName === "string") {
    return named.displayName;
  }
  return "none";
}

// The same read asserted, not tested: still the family's erased value.
export function assertedName(named: Named): string {
  return named.displayName as string;
}

interface Labelled {
  readonly label?: unknown;
}
class Stored {
  label: string = "s";
}
class Computed {
  get label(): string {
    return "c";
  }
}

// Narrowed by the same test, with a getter among the suppliers: a getter runs
// again, so the test says nothing about the read after it.
export function labelOf(labelled: Labelled): string {
  if (typeof labelled.label === "string") {
    return labelled.label;
  }
  return "none";
}

export function run(): string {
  const context = new Context();
  context.displayName = "Ctx";
  const held: Named = context;
  const stored: Labelled = new Stored();
  const computed: Labelled = new Computed();
  return (
    nameOf(held) +
    nameOf({ displayName: 3 }) +
    assertedName(held) +
    labelOf(stored) +
    labelOf(computed) +
    labelOf({ label: 1 })
  );
}
