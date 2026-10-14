// **A heterogeneous tuple is lowered as an array of its first element.**
// `[Source, string]` becomes `array.new : managed<[managed<obj#1>]>`; the
// string is stored into it (`array.set %2[1] = "a"`) and read back as
// `managed<obj#1>`, then `convert`ed to `managed<str>` -- a type no element
// had. `hir::verify` passes the store of a `str` into an array of `obj#1`.
//
// What each backend makes of the false element type:
//
//   C, LLVM  a pointer is a pointer, so `xs[1].length` reads the string and
//            agrees -- but an element read *erased* is tagged as the claimed
//            object: iterating the tuple through `unknown` answers
//            `object,object` where node answers `object,string`.
//   JVM      the array is `obj#1[]`, and storing the `String` throws
//            `ArrayStoreException` at the literal.
//
// The control is a tuple whose elements share one type, `[Source, Source]`,
// which agrees. Not caused by object literals as interface implementers: a
// class instance in the first place does the same on main at ede19442c.
//
// Found on 2026-10-11 by the JVM lane, from MainCodex's 1c probe
// `tuple-context`.

interface Source {
  read(): number;
}

class Src implements Source {
  constructor(private b: number) {}
  read(): number {
    return this.b;
  }
}

function kind(v: unknown): string {
  return typeof v;
}

function mixed(n: number): string {
  const xs: [Source, string] = [new Src(n), "a"];
  let out = "";
  for (const v of xs) out += kind(v) + ",";
  return out;
}

function same(n: number): string {
  const xs: [Source, Source] = [new Src(n), new Src(n + 1)];
  let out = "";
  for (const v of xs) out += kind(v) + ",";
  return out;
}

observe("[Source, string]", mixed(1));
observe("[Source, Source]", same(1));
done();
