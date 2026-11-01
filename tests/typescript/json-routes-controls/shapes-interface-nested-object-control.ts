/*---
description: Control for shapes-interface-nested-object; parse to unknown and narrow before reading.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-interfaces, ts-objects, ts-numbers, ts-strings, ts-null-undefined, ts-tuples]
---*/
// Only parse, holder or return annotations change to unknown; text, runtime guards and assertions are identical.
interface JsonEnvelope { id: number; detail: { label: string; active: boolean; empty: null }; }
function check(text: string, id: number, label: string, active: boolean): void {
  const value: unknown = JSON.parse(text);
  assert.sameValue(typeof value, "object");
  if (typeof value !== "object" || value === null || !("id" in value) || !("detail" in value)) throw new Error("envelope");
  assert.compareArray(Object.keys(value), ["detail", "id"]);
  assert.sameValue(typeof value.id, "number"); assert.sameValue(Object.is(value.id, id), true);
  assert.sameValue(typeof value.detail, "object");
  const detail = value.detail;
  if (typeof detail !== "object" || detail === null || !("label" in detail) || !("active" in detail) || !("empty" in detail)) throw new Error("detail");
  assert.compareArray(Object.keys(detail), ["label", "active", "empty"]);
  assert.sameValue(typeof detail.label, "string"); assert.sameValue(detail.label, label);
  assert.sameValue(typeof detail.active, "boolean"); assert.sameValue(detail.active, active);
  assert.sameValue(typeof detail.empty, "object"); assert.sameValue(detail.empty, null);
}
const inputs: [string, number, string, boolean][] = [
  ['{"detail":{"label":"a","active":true,"empty":null},"id":-0}', -0, "a", true],
  ['{"detail":{"label":"b","active":false,"empty":null},"id":1.25}', 1.25, "b", false],
  ['{"detail":{"label":"c","active":true,"empty":null},"id":9007199254740993}', 9007199254740992, "c", true],
];
for (const [text, id, label, active] of inputs) check(text, id, label, active);
