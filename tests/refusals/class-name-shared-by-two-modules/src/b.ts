// The other `Frame`, which genuinely does refuse -- a `RegExp` field. Its
// refusal is correct and is not what this fixture is about; it is here to make
// the name collide, and to show that the wrong class is the one that dies.
export class Frame {
  readonly re: RegExp;

  constructor(re: RegExp) {
    this.re = re;
  }
}

export function useB(): Frame {
  return new Frame(/x/);
}
