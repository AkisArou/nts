// The optional property is never read. Only its declaration distinguishes
// the refused view from the method-syntax control.
interface PropertySink {
  write(n: number): number;
  end?: (() => void) | undefined;
}
interface MethodSink {
  write(n: number): number;
  end?(): void;
}
class Sink {
  seen: number = 7;
  write(n: number): number { return this.seen + n; }
  end(): void { this.seen = 0; }
}
export function propertyView(n: number): number {
  const sink: PropertySink = new Sink();
  return sink.write(n);
}
export function methodView(n: number): number {
  const sink: MethodSink = new Sink();
  return sink.write(n);
}
