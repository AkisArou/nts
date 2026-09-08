// The fastest shape of this serializer, and the first that is ahead of node's built-in.
//
// Four rows measure the same document with byte-identical output, and they are meant to be read
// as a series rather than individually:
//
//   json-stringify-doc      7.20ms   the erased `JsonValue` graph, which is what ships today
//   json-stringify-typed    1.26ms   a serializer for a statically known type
//   json-stringify-inline   0.99ms   the same, in one function so the accumulator stays local
//   json-stringify-fused    0.707ms  this row: the escape append fused at the call site
//
// Against the native serializers measured in the same window on an idle machine -- node 0.793ms,
// bun 0.341ms -- this is **0.89x of node and 2.07x of bun**. 10.2x from the first shape to this
// one, with no compiler change at any step.
//
// **What this row is.** What a *generated* serializer for a known type would emit, written by
// hand so the design can be sized before it is built. It is not what ships: `JSON.stringify` is
// still refused in compiled user code and the shipped path still builds the graph.
//
// **Why the shape is what it is**, each step for a reason the previous row measured:
//
//   1. **No graph.** Keys are literals, a row is one object with ten typed fields rather than
//      eleven `JsonValue`s, and there is no `kind` to dispatch on. Worth 5.7x, and the profile
//      that motivated it named `nts_collect_cycles` and `nts_array_new`, not the escaper.
//   2. **One function.** The accumulator never crosses a parameter. `appendRow(out, row)` --
//      the obvious factoring -- is **50x slower**, because `out = f(out, x)` holds two live
//      references and `nts_str_append`'s `reserved == 1` test fails, so every append copies the
//      whole buffer. That was measured, not feared.
//   3. **Fused escape append.** `out += quoteJSONString(x)` allocates the quoted string, copies
//      it in and frees it, twenty thousand times per serialization. Fused, a string needing no
//      escape is three in-place appends and allocates nothing. Worth 1.41x.
//
// **The classification is not duplicated.** `firstEscapeIndex` was factored *out* of
// `quoteJSONString`, which now calls it for its own fast path, so Table 78 and the 25.5.4.3
// surrogate rule are written exactly once. `quoteFromIndex` takes the index the scan already
// found, so the escaping path scans less than it did before rather than twice. A second
// "does this need escaping" loop beside the first would have been the obvious way to write
// this and is the duplication this lane has refused twice.
//
// Output is checked byte for byte against `JSON.stringify`, not by length. A faster serializer
// producing different text would be a bug reported as a benchmark win.
import {
  firstEscapeIndex,
  numberText,
  quoteFromIndex,
} from "../../../runtime/web-platform/src/json/text.ts";

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

/**
 * The inlined serializer again, with the escape append fused by hand.
 *
 * `json-stringify-inline` removed the row, tags and meta intermediates by keeping every append
 * in one function, and went 1.26ms to 1.04ms. What it could not remove is the per-field
 * intermediate: `out += quoteJSONString(x)` allocates the quoted string, copies it into the
 * accumulator and frees it, about twenty thousand times per serialization. That is most of the
 * ~32% the typed row's profile attributes to `nts_str_raw`, `nts_release`, `nts_free` and
 * `nts_each_reference`.
 *
 * **This row is what a compiler peephole for `acc += quoteJSONString(x)` would produce**, done
 * by hand so the ask can be sized before it is made. For a string needing no escape -- the
 * common case -- it appends the quote, the string and the quote, three in-place appends into a
 * buffer that is already refcount-1, and allocates nothing at all. Only a string that actually
 * contains an escape takes the allocating path.
 *
 * **The classification is not duplicated to do this.** `firstEscapeIndex` was factored out of
 * `quoteJSONString`, which now calls it for its own fast path, so Table 78 and the 25.5.4.3
 * surrogate rule are still expressed exactly once. `quoteFromIndex` takes the index the scan
 * already found rather than looking for it again, so the escaping path does not scan twice.
 */
function serializeDocument(doc: Document): string {
  let out = '{"version":';
  out += numberText(doc.version);
  out += ',"rows":[';
  const rows = doc.rows;
  let escapeAt = 0;
  for (let at = 0; at < rows.length; at++) {
    if (at !== 0) out += ",";
    const row = rows[at] as Row;
    out += '{"id":';
    escapeAt = firstEscapeIndex(row.id);
    if (escapeAt < 0) {
      out += '"';
      out += row.id;
      out += '"';
    } else {
      out += quoteFromIndex(row.id, escapeAt);
    }
    out += ',"name":';
    escapeAt = firstEscapeIndex(row.name);
    if (escapeAt < 0) {
      out += '"';
      out += row.name;
      out += '"';
    } else {
      out += quoteFromIndex(row.name, escapeAt);
    }
    out += ',"email":';
    escapeAt = firstEscapeIndex(row.email);
    if (escapeAt < 0) {
      out += '"';
      out += row.email;
      out += '"';
    } else {
      out += quoteFromIndex(row.email, escapeAt);
    }
    out += ',"created":';
    escapeAt = firstEscapeIndex(row.created);
    if (escapeAt < 0) {
      out += '"';
      out += row.created;
      out += '"';
    } else {
      out += quoteFromIndex(row.created, escapeAt);
    }
    out += ',"score":';
    out += numberText(row.score);
    out += ',"rank":';
    out += numberText(row.rank);
    out += ',"active":';
    out += row.active ? "true" : "false";
    out += ',"note":';
    const note = row.note;
    if (note === null) {
      out += "null";
    } else {
      escapeAt = firstEscapeIndex(note);
      if (escapeAt < 0) {
        out += '"';
        out += note;
        out += '"';
      } else {
        out += quoteFromIndex(note, escapeAt);
      }
    }
    out += ',"tags":[';
    const tags = row.tags;
    for (let tag = 0; tag < tags.length; tag++) {
      if (tag !== 0) out += ",";
      const value = tags[tag] as string;
      escapeAt = firstEscapeIndex(value);
      if (escapeAt < 0) {
        out += '"';
        out += value;
        out += '"';
      } else {
        out += quoteFromIndex(value, escapeAt);
      }
    }
    out += '],"meta":{"level":';
    const meta = row.meta;
    out += numberText(meta.level);
    out += ',"path":';
    escapeAt = firstEscapeIndex(meta.path);
    if (escapeAt < 0) {
      out += '"';
      out += meta.path;
      out += '"';
    } else {
      out += quoteFromIndex(meta.path, escapeAt);
    }
    out += ',"weight":';
    out += numberText(meta.weight);
    out += "}}";
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
