// Source control for builtin-study-web-streams. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourceStream<T> { locked = false; }

export function webStreamsControl(): boolean {
  return new SourceStream<number>().locked;
}
