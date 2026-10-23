// `json-stringify-typed`'s document, serialized by `JSON.stringify` itself.
//
// That row writes the serializer a compiler would generate for these classes by hand, to
// find out what it would be worth. This one asks the compiler to generate it: `JSON.stringify`
// of a value whose type the program states is a writer per type (`hir/lower/json.rs`), keys
// quoted at compile time, a string through the runtime's escape kernel. node and Bun run their
// built-in `JSON.stringify` on the same objects, so this is the row that compares nts's
// generated writer with V8's and JSC's, where the typed row compares a hand-written
// serializer.
//
// The text is byte-identical to `json-stringify-typed`'s and `json-stringify-doc`'s: the same
// keys in the same order, which for these classes is their field declarations' order.

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
    total = total + JSON.stringify(DOCUMENT).length;
  }
  return total;
}

/** One serialization per op, so this row's number is directly comparable to the other two. */
export const seed = 1;
