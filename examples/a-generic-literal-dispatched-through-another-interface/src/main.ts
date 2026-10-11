// Disjoint primitive results exclude impossible shape candidates. Source's
// number and string instantiations therefore do not block each other's faces.
interface Source<T> { value?: T; read(): T }
interface NumberReader { read(): number }
interface StringReader { read(): string }
function numberValue(reader: NumberReader): number { return reader.read(); }
function stringLength(reader: StringReader): number { return reader.read().length; }
export function result(n: number): number {
  const base = n;
  const numberSource: Source<number> = { read(): number { return base; } };
  const stringSource: Source<string> = { read(): string { return "hi"; } };
  return numberValue(numberSource) + stringLength(stringSource);
}
