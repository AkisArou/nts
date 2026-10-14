// A `toJSON` override returning a record that only *repeats* the base's
// fields, in its order: perf_hooks' PerformanceNodeTiming/ResourceTiming.
// The JVM declines it (NTS4009). **Expected, confirmed under node:**
// `node 3`. One arm per program: an abort reports nothing.
interface EntryJSON {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
}
class Entry {
  toJSON(): EntryJSON {
    return { name: "e", entryType: "e", startTime: 0, duration: 1 };
  }
}
function show(e: Entry): string {
  const j = e.toJSON();
  return `${j.name} ${j.duration}`;
}
interface TimingJSON {
  name: "node";
  entryType: "node";
  startTime: number;
  duration: number;
  nodeStart: number;
}
class Timing extends Entry {
  toJSON(): TimingJSON {
    return { name: "node", entryType: "node", startTime: 0, duration: 3, nodeStart: 9 };
  }
}
observe("through the base", show(new Timing()));
done();
