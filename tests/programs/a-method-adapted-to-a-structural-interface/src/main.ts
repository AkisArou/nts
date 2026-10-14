// The interface's convention belongs to its slot, including when an
// implementation takes fewer or wider inputs, or returns a narrower value.
// Mixed arrays force dispatch after the concrete receiver has been lost.
interface Sink { take(x: number): number }
class Wide {
  take(x: number | string): number {
    if (typeof x !== "number") return x.length;
    let total = 0;
    for (let i = 0; i < ((x | 0) & 7); i++) total += i;
    return total;
  }
}
class Drops { take(): number { return 9; } }
class Base { take(x: number | string): number { return typeof x === "number" ? x + 1 : 0; } }
class Inherited extends Base { other(): number { return 7; } }
class Overridden extends Base { take(x: number | string): number { return typeof x === "number" ? x * 3 : 0; } }
class Exact implements Sink { take(x: number): number { return x - 1; } }
export function mixed(n: number): number {
  const all: Sink[] = [new Wide(), new Drops(), new Inherited(), new Overridden(), new Exact()];
  let total = 0;
  for (const sink of all) total = total * 11 + sink.take((n | 0) & 3);
  return total;
}
export function concrete(n: number): number { return new Wide().take(String(n)); }

interface TaggedSink { take(x: number): number; tag(): number }
class TaggedInherited extends Base { tag(): number { return 1; } }
class OtherBase { take(x: number | string): number { return typeof x === "number" ? x * 2 : 0; } }
class OtherTaggedInherited extends OtherBase { tag(): number { return 2; } }
export function inheritedFace(n: number): number {
  const sinks: TaggedSink[] = [new TaggedInherited(), new OtherTaggedInherited()];
  let answer = 0;
  for (const sink of sinks) answer += sink.take(n) + sink.tag();
  return answer;
}

class Animal { legs(): number { return 4; } }
class Dog extends Animal { legs(): number { return 3; } }
interface Maker { make(): Animal }
class DogMaker { make(): Dog { return new Dog(); } }
class AnimalMaker { make(): Animal { return new Animal(); } }
export function narrowedResult(n: number): number {
  const makers: Maker[] = [new DogMaker(), new AnimalMaker()];
  let total = 0;
  for (const maker of makers) total = total * 10 + maker.make().legs();
  return total + n;
}

interface Trainer { train(dog: Dog): number }
class BroadTrainer { train(animal: Animal): number { return animal.legs(); } }
class DogTrainer { train(dog: Dog): number { return dog.legs() + 1; } }
export function widenedObjectInput(n: number): number {
  const trainers: Trainer[] = [new BroadTrainer(), new DogTrainer()];
  let total = 0;
  for (const trainer of trainers) total = total * 10 + trainer.train(new Dog());
  return total + n;
}

type Count = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
interface Counter { tally(x: Count): unknown }
class SpecializedCounter {
  tally(x: number): number {
    let total = 0;
    for (let i = 0; i < x; i++) total += i;
    return total;
  }
}
class ConstantCounter { tally(): number { return 13; } }
export function specializedInput(n: number): number {
  const counters: Counter[] = [new SpecializedCounter(), new ConstantCounter()];
  let total = 0;
  for (const counter of counters) {
    const value = counter.tally(((n | 0) & 7) as Count);
    total = total * 10 + (typeof value === "number" ? value : 0);
  }
  return total;
}

interface Wakeable { then(fulfill: () => unknown, reject: () => unknown): unknown }
interface OtherWakeable { then(fulfill: () => number, reject: () => number): unknown }
class Empty { then(): void {} }
class Listener { then(fulfill: () => void): void { fulfill(); } }
export function voidResult(n: number): number {
  const box = { value: n | 0 };
  const all: Wakeable[] = [new Empty(), new Listener()];
  let absent = 0;
  for (const wakeable of all) {
    const result = wakeable.then(() => { box.value += 3; return box.value; }, () => { box.value += 7; return box.value; });
    if (result === undefined) absent++;
  }
  return box.value + absent;
}
export function anotherFace(n: number): number {
  const box = { value: n | 0 };
  const all: OtherWakeable[] = [new Empty(), new Listener()];
  for (const wakeable of all) wakeable.then(() => { box.value += 5; return box.value; }, () => 0);
  return box.value;
}
export function erasedCallback(n: number): number {
  const box = { value: n | 0 };
  const all: Wakeable[] = [new Empty(), new Listener()];
  for (const wakeable of all) {
    const result = wakeable.then((): unknown => {
      box.value += 2;
      return (n | 0) & 1 ? "value" + n : n;
    }, (): unknown => undefined);
    if (result !== undefined) box.value += 100;
  }
  return box.value;
}

interface Producer { read(): unknown }
class Optional { read(): string | undefined { return undefined; } }
class Nullable { read(): string | null { return null; } }
class Present { read(): string { return "present"; } }
export function absences(n: number): string {
  const all: Producer[] = [new Optional(), new Nullable(), new Present()];
  let result = "";
  for (const producer of all) {
    const value = producer.read();
    result += value === undefined ? "u" : value === null ? "n" : typeof value;
  }
  return result + n;
}

interface Raising { invoke(x: number): unknown }
class Throwing {
  invoke(x: number | string): number {
    if (typeof x !== "number") return 0;
    if ((x | 0) & 1) throw new Error("odd");
    return x + 2;
  }
}
class Returning { invoke(): void {} }
export function caught(n: number): number {
  const all: Raising[] = [new Throwing(), new Returning()];
  let total = 0;
  for (const raising of all) {
    try {
      const result = raising.invoke(n | 0);
      total += typeof result === "number" ? result : 7;
    } catch { total += 11; }
  }
  return total;
}

class ParentReader implements Producer { read(): unknown { return 1; } }
class ChildReader extends ParentReader { read(): string { return "child"; } }
export function throughBothErasedRoots(n: number): string {
  const parents: ParentReader[] = [new ParentReader(), new ChildReader()];
  const producers: Producer[] = [new ParentReader(), new ChildReader()];
  let answer = "";
  for (const parent of parents) answer += String(parent.read());
  for (const producer of producers) answer += String(producer.read());
  return answer + n;
}

class ParentMaker implements Maker { make(): Animal { return new Animal(); } }
class ChildMaker extends ParentMaker { make(): Dog { return new Dog(); } }
class Hound extends Dog { legs(): number { return 2; } }
class GrandchildMaker extends ChildMaker { make(): Dog { return new Hound(); } }
export function throughBothObjectRoots(n: number): number {
  const parents: ParentMaker[] = [new ParentMaker(), new ChildMaker(), new GrandchildMaker()];
  const makers: Maker[] = [new ParentMaker(), new ChildMaker(), new GrandchildMaker()];
  let answer = 0;
  for (const parent of parents) answer = answer * 10 + parent.make().legs();
  for (const maker of makers) answer = answer * 10 + maker.make().legs();
  return answer + n;
}

interface SmallValue { readValue(x: Count): unknown }
interface BroadValue { readValue(x: number): unknown }
class ValueReader { readValue(x: number | string): number { return typeof x === "number" ? x : x.length; } }
class FixedValue { readValue(): number { return 1; } }
export function sharedInputFacts(n: number): number {
  const small: SmallValue[] = [new ValueReader(), new FixedValue()];
  const broad: BroadValue[] = [new ValueReader(), new FixedValue()];
  let answer = 0;
  for (const reader of small) { const x = reader.readValue(3); answer += typeof x === "number" ? x : 0; }
  for (const reader of broad) { const x = reader.readValue(n / 2); answer += typeof x === "number" ? x : 0; }
  return answer;
}
