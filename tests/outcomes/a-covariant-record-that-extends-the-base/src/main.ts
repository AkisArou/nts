// A `toJSON` override returning a record that `extends` the base's return
// record, called through the base: perf_hooks' PerformanceMark/Measure/
// NodeEntry. The JVM declines it (NTS4009, a covariant return). **Expected,
// confirmed under node:** `m 2`. One arm per program: an abort reports nothing.
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
interface DetailJSON extends EntryJSON {
  detail: unknown;
}
class Mark extends Entry {
  toJSON(): DetailJSON {
    return { name: "m", entryType: "mark", startTime: 0, duration: 2, detail: null };
  }
}
observe("through the base", show(new Mark()));
done();
