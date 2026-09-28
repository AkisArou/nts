// A `toJSON` override returning a record with the base's fields in another
// order, called through the base. TypeScript accepts it (the return is
// structurally a subtype), and the caller reads the base record's fields at
// the base record's offsets from a record laid out otherwise. The JVM
// declines the override (NTS4009); C and LLVM have no check. Found beside the
// two perf_hooks shapes, which keep the base's order and agree
// (a-covariant-record-that-extends-the-base, -that-repeats-the-base); no
// runtime site is known.
//
// **Expected, confirmed under node:**
//
//     through the base   r 4
//
// **Refused by name since b09c3e6f6**, which hoisted the JVM's NTS4009 check
// into lowering for this shape: it was SIGSEGV on C until then. The record is
// the refusal; the arms that must stay silent beside it are
// an-override-declaring-fewer-parameters, the two covariant-record fixtures
// that keep the base's fields in order, and a-controller-stored-by-a-generic-branch.
interface EntryJSON {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
}
interface ReorderedJSON {
  nodeStart: number;
  duration: number;
  name: string;
  entryType: string;
  startTime: number;
}
class Entry {
  toJSON(): EntryJSON {
    return { name: "e", entryType: "e", startTime: 0, duration: 1 };
  }
}
class Reordered extends Entry {
  toJSON(): ReorderedJSON {
    return { nodeStart: 9, duration: 4, name: "r", entryType: "r", startTime: 0 };
  }
}
function show(e: Entry): string {
  const j = e.toJSON();
  return `${j.name} ${j.duration}`;
}
observe("through the base", show(new Reordered()));
done();
