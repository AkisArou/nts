// Fixture for declaration modifiers, class heritage, and enum constants.

export enum Color {
  Red = 1,
  Green = 2,
  Blue = 4,
}

export const enum Mode {
  Fast = "fast",
  Slow = "slow",
}

export interface Drawable {
  draw(): void;
}

export abstract class Shape {
  readonly id: number = 0;
  protected name: string = "";
  static instances: number = 0;
  abstract area(): number;
}

export class Circle extends Shape implements Drawable {
  private radius: number = 1;
  public override area(): number {
    return this.radius;
  }
  draw(): void {}
  static async load(): Promise<void> {}
}

export let mutable = 1;
export const immutable = 2;
declare function ambient(n: number): number;

export default class Widget {}
