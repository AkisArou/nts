class Parent {
  toString(_n?: number): string { return "parent"; }
  read(_n?: number): string { return "parent"; }
}
class Child extends Parent {
  override toString(): string { return "child"; }
  override read(): string { return "child"; }
}
function virtual(value: Parent, n: number): string { return value.read(n); }
export function conversions(n: number): string {
  const child = new Child();
  const receiver: Parent = n < 0 ? new Parent() : child;
  return String(child) + ":" + `${child}` + ":" + virtual(receiver, n) + ":" + child.toString();
}
export function consolePath(n: number): number {
  const child = new Child();
  console.log(`${child}`);
  return n;
}
