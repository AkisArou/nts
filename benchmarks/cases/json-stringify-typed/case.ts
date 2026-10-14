// The same document again, serialized straight from a typed structure with no erased graph.
//
// `json-stringify-doc` measures the route we ship today: build a `JsonValue` graph, walk it,
// produce text. It is 8.8x off node's built-in `JSON.stringify`, and its profile says the cost
// is not character processing but the graph itself -- `nts_collect_cycles`, `nts_array_new`,
// `nts_mark_gray_child`, `nts_release`. Switching reclamation off is worth 1.6x on that row,
// which is the controlled version of the same claim.
//
// **This row is the counterfactual for the architecture rather than for the collector.** It is
// what "direct typed materialization" produces: at a boundary where the type is statically
// known, the compiler emits a serializer for *that* type instead of building a generic
// representation and walking it. Written by hand here because the compiler cannot emit it yet;
// the point is to find out what it would be worth before anyone builds it, or ports the
// implementation to native code on the assumption that it would not be enough.
//
// Three things this shape gets that the graph cannot, and all three are consequences of knowing
// the type rather than tricks:
//
//   1. **Keys are literals.** `'"email":'` is in the emitted text, not a `quoteJSONString` call
//      on a string that is the same every time. The graph escapes all ten keys of all two
//      thousand rows on every serialization.
//   2. **No wrapper per field.** A row is one object with ten typed fields, not one `JsonValue`
//      plus ten `JsonValue` children plus two container arrays.
//   3. **No dispatch.** There is no `kind` to switch on; the field's type decides the code at
//      compile time.
//
// Everything under the type is still the shared implementation: `quoteJSONString` and
// `numberText` from `text.ts`, unchanged, because the escaping and number rules are the part
// that must not be written twice. Only the traversal changes.
//
// The output is byte-identical to `JSON.stringify` on the equivalent ordinary object and to
// `json-stringify-doc`'s, which is checked rather than assumed -- see `native.mjs` beside the
// other case. A faster serializer that produced different text would be a bug reported as a
// benchmark win.
import { numberText, quoteJSONString } from "../../../runtime/web-platform/src/json/text.ts";

const ROWS = 2000;

class Meta {
  readonly level: number;
  readonly path: string;
  readonly weight: number;

  constructor(level: number, path: string, weight: number) {
    this.level = level;
    this.path = path;
    this.weight = weight;
  }
}

class Row {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly created: string;
  readonly score: number;
  readonly rank: number;
  readonly active: boolean;
  /** Nullable in the type, so the emitted serializer carries exactly one branch for it. */
  readonly note: string | null;
  readonly tags: readonly string[];
  readonly meta: Meta;

  constructor(
    id: string,
    name: string,
    email: string,
    created: string,
    score: number,
    rank: number,
    active: boolean,
    note: string | null,
    tags: readonly string[],
    meta: Meta,
  ) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.created = created;
    this.score = score;
    this.rank = rank;
    this.active = active;
    this.note = note;
    this.tags = tags;
    this.meta = meta;
  }
}

class Document {
  readonly version: number;
  readonly rows: readonly Row[];

  constructor(version: number, rows: readonly Row[]) {
    this.version = version;
    this.rows = rows;
  }
}

/** What a generated serializer for `Meta` looks like: three known keys, three known types. */
function serializeMeta(meta: Meta): string {
  let out = '{"level":';
  out += numberText(meta.level);
  out += ',"path":';
  out += quoteJSONString(meta.path);
  out += ',"weight":';
  out += numberText(meta.weight);
  out += "}";
  return out;
}

function serializeTags(tags: readonly string[]): string {
  let out = "[";
  for (let at = 0; at < tags.length; at++) {
    if (at !== 0) out += ",";
    out += quoteJSONString(tags[at] as string);
  }
  out += "]";
  return out;
}

function serializeRow(row: Row): string {
  let out = '{"id":';
  out += quoteJSONString(row.id);
  out += ',"name":';
  out += quoteJSONString(row.name);
  out += ',"email":';
  out += quoteJSONString(row.email);
  out += ',"created":';
  out += quoteJSONString(row.created);
  out += ',"score":';
  out += numberText(row.score);
  out += ',"rank":';
  out += numberText(row.rank);
  out += ',"active":';
  out += row.active ? "true" : "false";
  out += ',"note":';
  // The one branch the type asks for. A non-nullable field would not have it.
  const note = row.note;
  out += note === null ? "null" : quoteJSONString(note);
  out += ',"tags":';
  out += serializeTags(row.tags);
  out += ',"meta":';
  out += serializeMeta(row.meta);
  out += "}";
  return out;
}

function serializeDocument(doc: Document): string {
  let out = '{"version":';
  out += numberText(doc.version);
  out += ',"rows":[';
  const rows = doc.rows;
  for (let at = 0; at < rows.length; at++) {
    if (at !== 0) out += ",";
    out += serializeRow(rows[at] as Row);
  }
  out += "]}";
  return out;
}

/** The identical corpus to `json-stringify-doc`, as ordinary typed values. */
function document(): Document {
  const rows: Row[] = [];
  for (let at = 0; at < ROWS; at++) {
    rows.push(
      new Row(
        "8f3a2b1c-" + at,
        at % 7 === 0 ? 'Ada "Countess" Lovelace' : "Ada Lovelace",
        "user" + at + "@example.test",
        "2026-09-08T12:00:00Z",
        at * 1.5,
        at,
        at % 3 !== 0,
        at % 11 === 0 ? "line\nbreak\ttab" : null,
        ["founder", "analyst", "engineering"],
        new Meta(at % 5, "/a/b/c", at / 7),
      ),
    );
  }
  return new Document(1, rows);
}

const DOCUMENT = document();

export function work(iterations: number): number {
  let total = 0;
  for (let round = 0; round < iterations; round++) {
    total = total + serializeDocument(DOCUMENT).length;
  }
  return total;
}

/** One serialization per op, so this row's number is directly comparable to the other two. */
export const seed = 1;
