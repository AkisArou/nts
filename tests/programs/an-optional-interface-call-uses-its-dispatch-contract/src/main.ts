// The optional library method accepts a value, while this implementation
// takes none. The control changes only the receiver's declared type.
class Cursor implements Iterator<number> {
  count = 0;
  next(): IteratorResult<number> { return { value: 1, done: true }; }
  return(): IteratorResult<number> { this.count++; return { value: 0, done: true }; }
}
class InterfaceController {
  #sourceIterator: Iterator<number> | null = null;
  constructor(cursor: Cursor) { this.#sourceIterator = cursor; }
  cancel(): void {
    if (this.#sourceIterator?.return !== undefined) this.#sourceIterator.return();
  }
}
class ConcreteController {
  #sourceIterator: Cursor | null = null;
  constructor(cursor: Cursor) { this.#sourceIterator = cursor; }
  cancel(): void {
    if (this.#sourceIterator?.return !== undefined) this.#sourceIterator.return();
  }
}
export function subject(n: number): number {
  const cursor = new Cursor();
  new InterfaceController(cursor).cancel();
  return cursor.count + n;
}
export function control(n: number): number {
  const cursor = new Cursor();
  new ConcreteController(cursor).cancel();
  return cursor.count + n;
}

interface OptionalFinisher {
  readonly marker: number;
  finish?(value?: number): number;
}
class Finisher implements OptionalFinisher {
  readonly marker = 1;
  finish(value?: number): number { return value === undefined ? 7 : value + 1; }
}
class InheritedFinisher extends Finisher {}
class OverriddenFinisher extends Finisher {
  override finish(value?: number): number { return super.finish(value) * 2; }
}
function omitValue(finisher: OptionalFinisher): number {
  return finisher.finish === undefined ? -1 : finisher.finish();
}
function passValue(finisher: OptionalFinisher, n: number): number {
  return finisher.finish === undefined ? -1 : finisher.finish(n);
}
export function consumingBase(n: number): number {
  const finisher = new Finisher();
  return omitValue(finisher) + passValue(finisher, n);
}
export function consumingInherited(n: number): number {
  const finisher = new InheritedFinisher();
  return omitValue(finisher) + passValue(finisher, n);
}
export function consumingOverride(n: number): number {
  const finisher = new OverriddenFinisher();
  return omitValue(finisher) + passValue(finisher, n);
}
