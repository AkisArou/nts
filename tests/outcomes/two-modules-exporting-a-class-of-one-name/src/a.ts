export abstract class Base {
  abstract value(): number;
}

export class Thing extends Base {
  value(): number {
    return 1;
  }
}
