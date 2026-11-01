/*---
description: "The only break edge establishes the discriminated member read after a loop."
features: [ts-control-flow-routes, ts-control-flow-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-interfaces, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-discriminated-unions, ts-route-loop, ts-unions, ts-narrowing]
---*/
// Pending|Ready follows its typed next field until the ready-only break; node logs zero or one back edges and uses the narrowed Ready payload after exit.
interface Ready { kind: "ready"; value: number; }
interface Pending { kind: "pending"; next: Ready; }
interface FlowRow { kind: string; n: number; ready: Ready; pending: Pending; }
function makeRow(kind: string, n: number): FlowRow { const ready: Ready = { kind: "ready", value: n }; return { kind, n, ready, pending: { kind: "pending", next: ready } }; }
const rows: FlowRow[] = [makeRow("ready", -0), makeRow("pending", -0), makeRow("ready", NaN), makeRow("pending", NaN)];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(value: Pending | Ready, row: FlowRow): void {
  const log: unknown[] = [];
  while (true) {
    if (value.kind === "ready") { log.push("break", value, value.value); break; }
    log.push("pending", value); value = value.next; log.push("back", value);
  }
  log.push("exit:ready", value, value.value, value.value.toFixed(1));
  const expected: unknown[] = [];
  if (row.kind === "pending") expected.push("pending", row.pending, "back", row.ready);
  expected.push("break", row.ready, row.n, "exit:ready", row.ready, row.n, row.n.toFixed(1));
  same(value, row.ready); same(value.value, row.n); assert.compareArray(log, expected);
}
for (const row of rows) inspect(row.kind === "ready" ? row.ready : row.pending, row);
