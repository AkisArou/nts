// The base class, in a module of its own, as react-gtk's GroupNode is in children.ts.
export class Base {
  readonly type: string;
  constructor(type: string) {
    if (type === "") {
      throw new Error("no type");
    }
    this.type = type;
  }
}
