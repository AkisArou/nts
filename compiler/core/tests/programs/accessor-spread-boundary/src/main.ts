interface Face { value: number; }
class GetterFace {
  private state = 1;
  get value(): number { throw new Error("a prototype getter is not spread"); }
}
function spreadFace(value: Face): number { return ({...value}).value; }
function keysFace(value: Face): string { return Object.keys(value).join(","); }
export function incompleteOwnShape(n: number): number {
  const values: Face[] = [new GetterFace()];
  return spreadFace(values[n > 0 ? 0 : 0]!);
}
export function incompleteOwnKeys(n: number): string {
  const values: Face[] = [new GetterFace()];
  return keysFace(values[n > 0 ? 0 : 0]!);
}
interface Plain { value: number; tag: string; }
export function provenOwnShape(n: number): number {
  const value: Plain = {value: n, tag: "own"};
  return ({...value}).value;
}
interface KeyFace { readonly label: string; }
class StoredLabel { label = "stored"; }
class GetterLabel { private state = "getter"; get label(): string { return this.state; } }
function reflected(value: KeyFace): string {
  const label = value.label;
  return label + ":" + Object.keys(value).join(",");
}
export function unknownOwnProperties(n: number): string {
  const values: KeyFace[] = [new StoredLabel(), new GetterLabel()];
  return reflected(values[n > 0 ? 0 : 1]!);
}
