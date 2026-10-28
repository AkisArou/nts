// Payload facts join actual writers, including wider aliases. A written
// number value type is not a proof that an erased read contains a number.
export function closedNumber(n: number): number {
  const values = new Map<string, number>();
  values.set("key", n);
  const held = values.get("key") ?? 0;
  values.clear();
  return held;
}

export function scalarThroughWide(n: number): string {
  const narrow = new Map<string, number>();
  const wide: Map<string, unknown> = narrow;
  wide.set("key", n);
  const held = wide.get("key");
  wide.clear();
  return String(held);
}

// One difference: the same wider writer stores a managed, freshly built value.
// The retained read must survive clear and release its own reference afterward.
export function managedThroughWide(n: number): string {
  const narrow = new Map<string, number>();
  const wide: Map<string, unknown> = narrow;
  wide.set("key", "owned:" + String(n));
  const held = wide.get("key");
  wide.clear();
  return String(held);
}

export function absent(n: number): string {
  const values = new Map<string, unknown>();
  values.set("key", n);
  const held = values.get("missing");
  values.clear();
  return typeof held;
}

export function mergedScalar(n: number): string {
  const values = new Map<string, unknown>();
  values.set("key", (n | 0) & 1 ? n : true);
  const held = values.get("key");
  values.clear();
  return String(held);
}

export function mergedManaged(n: number): string {
  const values = new Map<string, unknown>();
  values.set("key", (n | 0) & 1 ? n : "owned:" + String(n));
  const held = values.get("key");
  values.clear();
  return String(held);
}

function makeValues(n: number): Map<string, unknown> {
  const values = new Map<string, unknown>();
  values.set("key", "returned:" + String(n));
  return values;
}

export function returned(n: number): string {
  const values = makeValues(n);
  const held = values.get("key");
  values.clear();
  return String(held);
}

function callWriter(values: Map<string, unknown>, n: number): void {
  values.set("key", "called:" + String(n));
}

export function otherWriter(n: number): string {
  const values = new Map<string, unknown>();
  values.set("key", n);
  callWriter(values, n);
  const held = values.get("key");
  values.clear();
  return String(held);
}

export function closureWriter(n: number): string {
  const values = new Map<string, unknown>();
  values.set("key", n);
  const write = (): void => { values.set("key", "captured:" + String(n)); };
  write();
  const held = values.get("key");
  values.clear();
  return String(held);
}

export function mergedIdentity(n: number): string {
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  a.set("key", n);
  b.set("key", "other:" + String(n));
  const values = (n | 0) & 1 ? a : b;
  const held = values.get("key");
  values.clear();
  return String(held);
}

// This provider has no array proof. Its owned read keeps the existing path.
export function arrayControl(n: number): string {
  const values: unknown[] = ["array:" + String(n)];
  const held = values[0];
  values.length = 0;
  return String(held);
}

// Catch annotations do not summarize every exception producer.
export function exceptionControl(n: number): string {
  try {
    throw "thrown:" + String(n);
  } catch (held) {
    return String(held);
  }
}

// Numeric facts keep both NaN and the sign of zero. The first cleanup consumer
// only asks about tags; it neither folds arithmetic nor removes absence.
export function numericEdges(n: number): string {
  const values = new Map<string, unknown>();
  values.set("key", (n | 0) & 1 ? NaN : -0);
  const held = values.get("key");
  return String(held) + ":" + String(Object.is(held, -0));
}
