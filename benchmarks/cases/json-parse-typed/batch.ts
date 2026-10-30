import { parseTypedDocument } from "./parser.ts";
import { checksum } from "./source.ts";

// Both regimes run this body; the selected pool is built before timing.
export function typedBatch(docs: string[], offset: number): number {
  let sum = 0;
  const mask = docs.length - 1;
  const start = (offset | 0) & mask;
  for (let i = 0; i < docs.length; i++) {
    sum += checksum(parseTypedDocument(docs[(start + i) & mask]));
  }
  return sum;
}
