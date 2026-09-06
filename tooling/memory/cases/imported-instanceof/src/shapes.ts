// The classes, in the file that is *not* the one asking.
export class Base {
  tag(): number {
    return 1;
  }
}

export class Leaf extends Base {
  constructor(public n: number) {
    super();
  }
}
