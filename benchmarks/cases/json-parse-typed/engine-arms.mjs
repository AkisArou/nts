import { checksum } from "./source.ts";

function fail(expected, path) { throw new TypeError(`Expected ${expected} at ${path}`); }
function missing(path) { throw new TypeError(`Missing required property at ${path}`); }
function object(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("object", path);
}
function field(value, key, kind, path) {
  if (!Object.hasOwn(value, key)) missing(path);
  if (typeof value[key] !== kind) fail(kind, path);
}
export function validateDocument(value) {
  object(value, "$");
  if (!Object.hasOwn(value, "rows")) missing("$.rows");
  if (!Array.isArray(value.rows)) fail("array", "$.rows");
  for (let i = 0; i < value.rows.length; i++) {
    const row = value.rows[i];
    // Paths are built only on a mismatch, not for every valid field.
    if (row === null || typeof row !== "object" || Array.isArray(row)) fail("object", `$.rows[${i}]`);
    if (!Object.hasOwn(row, "id")) missing(`$.rows[${i}].id`);
    if (typeof row.id !== "number") fail("number", `$.rows[${i}].id`);
    if (!Object.hasOwn(row, "name")) missing(`$.rows[${i}].name`);
    if (typeof row.name !== "string") fail("string", `$.rows[${i}].name`);
    if (!Object.hasOwn(row, "ok")) missing(`$.rows[${i}].ok`);
    if (typeof row.ok !== "boolean") fail("boolean", `$.rows[${i}].ok`);
    if (!Object.hasOwn(row, "score")) missing(`$.rows[${i}].score`);
    if (typeof row.score !== "number") fail("number", `$.rows[${i}].score`);
    if (!Object.hasOwn(row, "tags")) missing(`$.rows[${i}].tags`);
    if (!Array.isArray(row.tags)) fail("array", `$.rows[${i}].tags`);
    for (let j = 0; j < row.tags.length; j++) {
      if (typeof row.tags[j] !== "string") fail("string", `$.rows[${i}].tags[${j}]`);
    }
  }
  field(value, "count", "number", "$.count");
  if (!Object.hasOwn(value, "note")) missing("$.note");
  if (value.note !== null) fail("null", "$.note");
  return value;
}

export function parseAndValidate(text) { return validateDocument(JSON.parse(text)); }
export function nativeWork(docs, offset) {
  let sum = 0;
  const start = (offset | 0) & (docs.length - 1);
  for (let i = 0; i < docs.length; i++) {
    sum += checksum(JSON.parse(docs[(start + i) & (docs.length - 1)]));
  }
  return sum;
}
export function validatedWork(docs, offset) {
  let sum = 0;
  const start = (offset | 0) & (docs.length - 1);
  for (let i = 0; i < docs.length; i++) {
    sum += checksum(parseAndValidate(docs[(start + i) & (docs.length - 1)]));
  }
  return sum;
}
