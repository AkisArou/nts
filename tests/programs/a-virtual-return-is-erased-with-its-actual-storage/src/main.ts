// One erased virtual slot, entered by overrides of every representation: a
// number, a boolean, a string, a nullable string either way, a closure, an
// array, and two classes. Each override's entry erases its own answer with
// its own tag, so a caller through `Producer` reads what was returned rather
// than sixteen bytes of `NtsValue` out of a function that returned something
// else, which on C and LLVM it did; the JVM refused the program (NTS4009).
interface Producer { read(n: number): unknown; }
class FallbackProducer implements Producer { read(n: number): unknown { return n; } }
class NumberProducer implements Producer { read(n: number): number { return n + 1; } }
class BooleanProducer implements Producer { read(n: number): boolean { return n > 0; } }
class TextProducer implements Producer { read(n: number): string { return "value:" + n; } }
class OptionalTextProducer implements Producer { read(n: number): string | undefined { return n > 0 ? "value" : undefined; } }
class NullableTextProducer implements Producer { read(n: number): string | null { return n > 0 ? "value" : null; } }
const callback = (n: number): number => n + 7;
const otherCallback = (n: number): number => n + 11;
class FunctionProducer implements Producer { read(_n: number): (n: number) => number { return callback; } }
class FurtherFunctionProducer extends FunctionProducer { override read(_n: number): (n: number) => number { return otherCallback; } }
const numbers = [3, 5];
const otherNumbers = [7, 9, 11];
class ArrayProducer implements Producer { read(_n: number): number[] { return numbers; } }
class FurtherArrayProducer extends ArrayProducer { override read(_n: number): number[] { return otherNumbers; } }
class Box { constructor(public value: number) {} }
class BoxProducer implements Producer { read(n: number): Box { return new Box(n + 3); } }
class Empty {}
class EmptyProducer implements Producer { read(_n: number): Empty { return new Empty(); } }
function read(producer: Producer, n: number): unknown { return producer.read(n); }
export function numberResult(n: number): number { const value = read(n === 0 ? new FallbackProducer() : new NumberProducer(), n); return typeof value === "number" ? value : -99; }
export function booleanResult(n: number): number { const value = read(n === 0 ? new FallbackProducer() : new BooleanProducer(), n); return typeof value === "boolean" ? value ? 1 : 0 : -99; }
export function textResult(n: number): number { const value = read(n === 0 ? new FallbackProducer() : new TextProducer(), n); return typeof value === "string" ? value.length : -99; }
export function optionalTextResult(n: number): number { const value = read(n === 0 ? new FallbackProducer() : new OptionalTextProducer(), n); return value === undefined ? 17 : typeof value === "string" ? value.length : -99; }
export function nullableTextResult(n: number): number { const value = read(n === 0 ? new FallbackProducer() : new NullableTextProducer(), n); return value === null ? 19 : typeof value === "string" ? value.length : -99; }
export function functionResult(n: number): number { const value = read(n === 0 ? new FallbackProducer() : n > 1 ? new FurtherFunctionProducer() : new FunctionProducer(), n); return typeof value === "function" ? value === callback ? n + 7 : value === otherCallback ? n + 11 : -99 : -99; }
export function arrayResult(n: number): number { const value = read(n === 0 ? new FallbackProducer() : n > 1 ? new FurtherArrayProducer() : new ArrayProducer(), n); return Array.isArray(value) ? value === numbers ? n + 2 : value === otherNumbers ? n + 3 : -99 : -99; }
export function nominalResult(n: number): number { const value = read(n === 0 ? new FallbackProducer() : new BoxProducer(), n); return value instanceof Box ? value.value : -99; }
export function classShapeResult(n: number): number { const value = read(n === 0 ? new FallbackProducer() : new EmptyProducer(), n); return typeof value === "object" && value instanceof Empty ? n + 17 : -99; }
export function normalFunction(n: number): (n: number) => number { return n > 0 ? callback : otherCallback; }
export function normalFunctionToUnknown(n: number): number { const value: unknown = normalFunction(n); return typeof value === "function" ? value === callback ? n + 7 : value === otherCallback ? n + 11 : -99 : -99; }
export function normalObject(n: number): Empty { return n > 0 ? new Empty() : new Empty(); }
export function normalObjectToUnknown(n: number): number { const value: unknown = normalObject(n); return typeof value === "object" && value instanceof Empty ? n + 17 : -99; }
