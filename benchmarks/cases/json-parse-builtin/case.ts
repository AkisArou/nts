// `json-parse-typed`'s eight documents, parsed by `JSON.parse(text) as Document` itself.
//
// That row writes the parser a compiler would generate for `Document` by hand, over the
// runtime's TypeScript scanner, to size it. This one asks the compiler to generate it: a
// reader per type over the runtime's scan (`hir/lower/json_parse.rs`,
// `runtime/c/nts_json.c`), which checks every field it reads. node and Bun run their built-in
// `JSON.parse` on the same texts and check nothing, so this is the row that compares nts's
// generated parser with V8's and JSC's own.
//
// The workload, the documents and the checksum are `json-parse-typed`'s, unchanged: one
// operation is a complete eight-document batch, every field observed.
import { checksum, documents, type Document } from "../json-parse-typed/source.ts";

const DOCS = documents(8);

export function work(offset: number): number {
  let sum = 0;
  const mask = DOCS.length - 1;
  const start = (offset | 0) & mask;
  for (let i = 0; i < DOCS.length; i++) {
    sum += checksum(JSON.parse(DOCS[(start + i) & mask]) as Document);
  }
  return sum;
}

export const seed = 0;
