// Source control for builtin-study-web-abort. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourceSignal { aborted = false; }
class SourceController { signal = new SourceSignal(); abort(): void { this.signal.aborted = true; } }

export function webAbortControl(): boolean {
  const c = new SourceController(); c.abort(); return c.signal.aborted;
}
