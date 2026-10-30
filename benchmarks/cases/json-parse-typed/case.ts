// Eight distinct documents, built before timing. Each call parses every document
// in rotated order and checksums every field. The official unit is one eight-
// document batch; the sizing notebook reports time per document.
import { typedBatch } from "./batch.ts";
import { documents } from "./source.ts";
const DOCS = documents(8);
export function work(offset: number): number { return typedBatch(DOCS, offset); }
export const seed = 0;
