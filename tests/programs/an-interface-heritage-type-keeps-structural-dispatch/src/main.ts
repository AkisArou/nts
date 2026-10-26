// TS 7.1 represents an interface's extends target as a TypeReference rather
// than an ExpressionWithTypeArguments. Dispatch still follows the inherited
// method. Neither class explicitly implements either interface, and their
// different layouts require the selected class's own method.
interface Base { read(by: number): number }
interface Inherited extends Base {}
interface Direct { read(by: number): number }

class Add {
  constructor(private value: number) {}
  read(by: number): number { return this.value + by; }
}

class Multiply {
  private offset = 7;
  constructor(private value: number) {}
  read(by: number): number { return this.value * by + this.offset; }
}

function readInherited(value: Inherited, by: number): number {
  return value.read(by);
}

function readDirect(value: Direct, by: number): number {
  return value.read(by);
}

export function inherited(n: number): number {
  return readInherited(new Add(n), n + 2) + readInherited(new Multiply(n), n + 2);
}

// The only difference is the interface: its method is declared directly.
export function directlyDeclared(n: number): number {
  return readDirect(new Add(n), n + 2) + readDirect(new Multiply(n), n + 2);
}
