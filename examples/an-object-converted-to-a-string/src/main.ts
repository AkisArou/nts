// `String(o)`, `${o}` and an array's text, for every kind of object, typed and
// through `unknown`.
//
// JavaScript asks the prototype chain for `toString`, so how an object prints
// is a fact about its type. Here it is decided once per layout
// (`hir::Program::printed`) and read by the runtime off the object's descriptor
// (`NtsDescriptor.to_string`), so a typed object and the same object erased
// print alike. Until this, `String(o)` refused for every object but a class
// with its own `toString`, and `String(v)` for every `unknown`.
//
// A function is not here on purpose: node prints its source, which a compiled
// program does not keep, and nts prints `function () { [native code] }`, as
// node does for a built-in (`docs/conformance/typescript.md`).

class Plain {
  v = 1;
}

class Labelled {
  constructor(private readonly label: string) {}
  toString(): string {
    return "<" + this.label + ">";
  }
}

class Loud extends Labelled {}

class Quiet extends Labelled {
  override toString(): string {
    return "quiet";
  }
}

class Tagged extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Tagged";
  }
}

function erased(value: unknown): string {
  return String(value);
}

/** A class with no `toString`, and an object literal. */
export function plainObjects(n: number): string {
  const p = new Plain();
  const literal = { a: n & 3 };
  return String(p) + "|" + erased(p) + "|" + `${literal}` + "|" + erased(literal);
}

/** A class's own `toString`, inherited and overridden. */
export function ownToString(n: number): string {
  const label = String(n & 7);
  return (
    String(new Labelled(label)) +
    "|" +
    erased(new Loud(label)) +
    "|" +
    `${new Quiet(label)}` +
    "|" +
    erased(new Quiet(label))
  );
}

/** The error rule: `name: message`, either dropped when empty. */
export function errors(n: number): string {
  const message = (n & 1) === 0 ? "" : "bad " + String(n & 7);
  return [
    String(new Error(message)),
    erased(new TypeError(message)),
    erased(new RangeError("range")),
    String(new Tagged(message)),
    erased(new Tagged("x")),
  ].join("|");
}

/** Arrays: joined by commas, `null` and `undefined` empty, nesting joined. */
export function arrays(n: number): string {
  const numbers = [n & 7, 2, 3.5];
  const nested: unknown[] = [[1, [2, 3]], "s", true, null, undefined, n & 3];
  const objects: unknown[] = [new Plain(), new Labelled("x"), new Error("e")];
  const empty: number[] = [];
  return [
    String(numbers),
    erased(numbers),
    erased(nested),
    erased(objects),
    erased(empty),
    `${["a", "b"]}`,
  ].join("|");
}

/** The runtime's own objects. */
export function builtIns(n: number): string {
  const map = new Map<number, number>([[n & 3, 1]]);
  const set = new Set<number>([n & 3]);
  const dictionary: Record<string, number> = { a: n & 3 };
  const bytes = new Uint8Array([n & 7, 2, 255]);
  return [
    String(map),
    erased(map),
    erased(set),
    erased(dictionary),
    String(dictionary),
    erased(Promise.resolve(n)),
    String(bytes),
    erased(bytes),
    erased(bytes.buffer),
    erased(new DataView(bytes.buffer)),
  ].join("|");
}

/** A dictionary shares a `Map`'s storage and is not one. */
export function aDictionaryIsNotAMap(n: number): string {
  const created: Record<string, number> = Object.create(null);
  const dictionary: unknown = created;
  const map: unknown = new Map<number, number>([[n & 3, 1]]);
  return String(dictionary instanceof Map) + "|" + String(map instanceof Map);
}

/** Primitives through `unknown`, which already printed, as controls. */
export function primitives(n: number): string {
  return [erased(n & 7), erased("s"), erased(true), erased(null), erased(undefined)].join("|");
}
