// expect: emit-c --napi -> lacks-c void abort;
//
// FIXED. This is a regression guard, not an open blocker.
//
// The standing description of the compiled axis was "228 of 244 clang errors are
// one struct emitter writing `void` fields", and the evidence was three WHATWG
// Streams dictionaries in real generated C:
//
//     struct NtsObj_Type1880 { NtsHeader header;
//         void abort; void close; void start; void type; void write; };
//
// Every field `void`, not just the exotic ones -- `highWaterMark` is
// `number | undefined`, which compiles perfectly well on its own. So it was
// never "this field's type is unrepresentable" five times over; it was a struct
// laid out with no field type resolved at all. The plan's reading was that
// `UnderlyingSink<W>` is generic and its members are optional callbacks over
// `W`, so the struct was being laid out with no instantiation to resolve them
// against. This file is that shape, staged as the plan described and never run.
//
// **Run on 2026-09-08 it does not reproduce**, and the first version of that
// claim was made on too small a sample. It rested on the seven modules that
// *build*, which is exactly the wrong set: the `void` fields were reported from
// modules that do not. Redone properly -- `emit-c` over all twenty-two, every
// `program.c` that came out, 24MB of generated C:
//
//     assert 0   async_hooks 0   buffer 0    console 0    dgram 0
//     diagnostics_channel 0      events 0    fs 0         http 0
//     net 0      os 0            path 0      process 0    punycode 0
//     querystring 0              readline 0  stream 0     string_decoder 0
//     timers 0   url 0           util 0      zlib 0
//
// Zero across the corpus, including `fs` at 2.2MB and every module that pulls
// in WHATWG Streams -- which is where the three dictionaries above came from.
// What happens instead is a clean refusal, `a parameter of unrepresentable type
// (Sink)`, which is a diagnostic rather than invalid C.
//
// So this cannot be made to reproduce without fabricating a defect that is not
// there, and a fixture that manufactured one would be worse than none: it would
// report a fixed compiler as broken forever.
//
// So the fixture asserts the *absence*. `emits-c` cannot state this: one
// correct emission has no `void` field either, so an expectation phrased that
// way would pass for the wrong reason forever. `lacks-c` says program.c was
// produced and this is not in it, and it fails loudly on the day it is again.
//
// The blocker underneath is still open and is a different thing: a generic
// interface of optional callbacks remains unrepresentable as a parameter, and
// the two exported functions here get no wrapper. That refusal is the honest
// description of what stops this shape today, and it is what the historical
// sentence should be replaced with wherever it still appears.

export interface Sink<W> {
  start?: (controller: number) => void;
  write?: (chunk: W, controller: number) => void;
  close?: () => void;
  abort?: (reason: string) => void;
  type?: string;
}

export interface Strategy<W> {
  highWaterMark?: number;
  size?: (chunk: W) => number;
}

export function drive<W>(sink: Sink<W>, strategy: Strategy<W>, chunk: W): number {
  if (sink.write !== undefined) sink.write(chunk, 0);
  if (sink.close !== undefined) sink.close();
  return strategy.highWaterMark ?? 1;
}

export function run(): number {
  const sink: Sink<number> = {};
  const strategy: Strategy<number> = { highWaterMark: 3 };
  return drive(sink, strategy, 7);
}

// Present so that `program.c` is not empty.
//
// Without it every function here is refused, the backend emits a zero-byte
// `program.c`, and `lacks-c` cannot tell "the struct is absent" from "nothing
// was emitted at all" -- an absence check against a file with no contents
// passes for the wrong reason. The harness caught exactly that and reported
// `NO OUTPUT` rather than a green tick, which is what it is for.
export function compiles(a: number, b: number): number {
  return a + b;
}
