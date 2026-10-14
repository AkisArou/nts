export abstract class Shape {
  abstract area(): number;
}

/** A name only this module uses. Its emitted name must stay unqualified. */
export class Circle extends Shape {
  readonly radius: number;

  constructor(radius: number) {
    super();
    this.radius = radius;
  }

  area(): number {
    return this.radius * this.radius * 3;
  }
}
