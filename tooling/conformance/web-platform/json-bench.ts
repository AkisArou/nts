// The shared JSON implementation against node's native one.
//
// Two things this is and is not. It **is** the baseline the plan asks for before any
// optimization: one measurement, taken before anything is tuned, so a later change has
// something to be compared against. It is **not** a fair fight on the host, and saying so up
// front matters more than the numbers: node's `JSON` is C++ inside V8 with a bytecode-level
// fast path, and this is TypeScript running on that same V8. Losing here is the expected
// result and is not the question the project is asking.
//
// The question the project is asking is the compiled axis: `nts`-compiled JSON against node's,
// where node's C++ is the thing to beat and the shared implementation is compiled rather than
// interpreted. That comparison cannot be run for the parser yet -- it does not compile, for
// the `SyntaxError` reason the ledger records -- so what this file measures is the host
// distance, which is the number that says how much the compiled axis has to make up.
//
// Methodology: a warmup that is discarded, then repeated timed rounds, reported by **median**
// rather than mean. A mean over a run that includes one GC pause reports the pause; the median
// reports the common case, and the spread between fastest and median says whether to trust it.
import { parseJsonText } from "../../../runtime/web-platform/src/json/parse.ts";
import { stringifyJsonValue } from "../../../runtime/web-platform/src/json/stringify.ts";
import { stringifyPlain, toPlainValue } from "../../../runtime/web-platform/src/json/plain.ts";

interface Corpus {
  readonly name: string;
  readonly text: string;
  readonly note: string;
}

/** Deterministic, so two runs measure the same bytes. */
function pseudoRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function buildCorpora(): Corpus[] {
  const random = pseudoRandom(20260908);
  const words = [
    "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
    "café", "naïve", "日本語", "emoji \u{1f600}", "quote\"inside", "back\\slash",
  ];
  const pick = (): string => words[Math.floor(random() * words.length)] as string;

  // A typical API response: many small uniform records. This is the shape most real JSON has.
  const records: unknown[] = [];
  for (let at = 0; at < 2000; at++) {
    records.push({
      id: at,
      name: pick(),
      active: random() > 0.5,
      score: Math.round(random() * 100000) / 100,
      tags: [pick(), pick()],
      meta: { created: 1700000000000 + at * 1000, parent: at === 0 ? null : at - 1 },
    });
  }

  // Number-heavy: the formatter and the grammar validator, with nothing else in the way.
  const numbers: number[] = [];
  for (let at = 0; at < 20000; at++) {
    const kind = at % 4;
    if (kind === 0) numbers.push(Math.floor(random() * 1e9));
    else if (kind === 1) numbers.push(random());
    else if (kind === 2) numbers.push(random() * 1e-7);
    else numbers.push(-random() * 1e21);
  }

  // String-heavy, with the escapes that force the slow path in both directions.
  const strings: string[] = [];
  for (let at = 0; at < 8000; at++) {
    strings.push(`${pick()}\t${pick()}\n${pick()}`);
  }

  // Deep rather than wide: the case an implementation with a recursive traversal dies on.
  const depth = 2000;
  const deep = "[".repeat(depth) + "1" + "]".repeat(depth);

  // Wide and flat, all keys, no nesting: the object-key path alone.
  const flat: Record<string, number> = {};
  for (let at = 0; at < 5000; at++) flat[`key_${at}`] = at;

  return [
    { name: "records", text: JSON.stringify(records), note: "2,000 uniform records, the common shape" },
    { name: "numbers", text: JSON.stringify(numbers), note: "20,000 numbers across four magnitudes" },
    { name: "strings", text: JSON.stringify(strings), note: "8,000 strings, all with escapes" },
    { name: "deep", text: deep, note: `${depth} levels of nesting` },
    { name: "flat", text: JSON.stringify(flat), note: "5,000 keys, no nesting" },
  ];
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

interface Timing {
  readonly median: number;
  readonly best: number;
}

function time(run: () => void, rounds: number, warmup: number): Timing {
  for (let at = 0; at < warmup; at++) run();
  const samples: number[] = [];
  for (let at = 0; at < rounds; at++) {
    const started = process.hrtime.bigint();
    run();
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  return { median: median(samples), best: Math.min(...samples) };
}

function throughput(bytes: number, milliseconds: number): string {
  return `${((bytes / 1048576) / (milliseconds / 1000)).toFixed(1)} MB/s`;
}

function ratio(mine: number, theirs: number): string {
  const factor = mine / theirs;
  return factor >= 1 ? `${factor.toFixed(2)}x slower` : `${(1 / factor).toFixed(2)}x faster`;
}

function row(label: string, mine: Timing, theirs: Timing, bytes: number): void {
  console.log(
    `  ${label.padEnd(22)} ` +
      `mine ${mine.median.toFixed(2).padStart(8)} ms (${throughput(bytes, mine.median).padStart(10)})  ` +
      `node ${theirs.median.toFixed(2).padStart(8)} ms (${throughput(bytes, theirs.median).padStart(10)})  ` +
      `${ratio(mine.median, theirs.median)}`,
  );
}

const ROUNDS = Number(process.env.NTS_JSON_BENCH_ROUNDS ?? "15");
const WARMUP = Number(process.env.NTS_JSON_BENCH_WARMUP ?? "5");

console.log(`node ${process.version}, ${ROUNDS} timed rounds after ${WARMUP} discarded\n`);

for (const corpus of buildCorpora()) {
  const bytes = Buffer.byteLength(corpus.text, "utf8");
  console.log(`${corpus.name} -- ${corpus.note}, ${(bytes / 1024).toFixed(0)} KiB`);

  // Parse to the graph, which is what a compiled target would carry. No host object is built,
  // so this is the comparison that flatters the graph most -- and it is the honest one for the
  // compiled axis, where there is nothing else to build.
  const mineParse = time(() => void parseJsonText(corpus.text), ROUNDS, WARMUP);
  const theirsParse = time(() => void JSON.parse(corpus.text), ROUNDS, WARMUP);
  row("parse to graph", mineParse, theirsParse, bytes);

  // Parse all the way to ordinary values, which is what `response.json()` actually returns.
  // The gap between this row and the one above is the price of materializing.
  const mineFull = time(() => void toPlainValue(parseJsonText(corpus.text)), ROUNDS, WARMUP);
  row("parse to values", mineFull, theirsParse, bytes);

  const graph = parseJsonText(corpus.text);
  const value: unknown = JSON.parse(corpus.text);
  const mineGraphOut = time(() => void stringifyJsonValue(graph), ROUNDS, WARMUP);
  const minePlainOut = time(() => void stringifyPlain(value), ROUNDS, WARMUP);
  const theirsOut = time(() => void JSON.stringify(value), ROUNDS, WARMUP);
  row("stringify graph", mineGraphOut, theirsOut, bytes);
  row("stringify values", minePlainOut, theirsOut, bytes);

  const spread = (mineParse.median - mineParse.best) / mineParse.median;
  if (spread > 0.25) {
    console.log(`  (noisy: median is ${(spread * 100).toFixed(0)}% above the best round)`);
  }
  console.log("");
}
