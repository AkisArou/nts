export class Animal { value = 1; }
export class Dog extends Animal { extra = 2; }
export interface Sized { size(value: Animal): number; }
export class Box {
  width = 4;
  size(value: Animal): number { return this.width + value.value; }
}
export function result(n: number): number { return new Box().size(new Animal()) + n; }
