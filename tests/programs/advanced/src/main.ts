// Features that change emitted code but were not extracted before.

export interface Fish { swim(): void }
export interface Bird { fly(): void }

// A type predicate: inside the true branch the concrete type is known, so a
// dispatch can become a direct call.
export function isFish(pet: Fish | Bird): pet is Fish {
  return "swim" in pet;
}

export function assertFish(pet: Fish | Bird): asserts pet is Fish {}

// An accessor looks like a property and is a call.
export class Box {
  #value = 0;
  get value(): number { return this.#value; }
  set value(v: number) { this.#value = v; }
  plain = 1;
}

// A construct signature.
export class Widget { constructor(public id: number) {} }
export type WidgetCtor = new (id: number) => Widget;

// Generic signature: monomorphization needs the type parameters.
export function identity<T>(x: T): T { return x; }
export function bounded<T extends Fish>(x: T): T { return x; }

// Conditional, indexed access, template literal.
export type Elem<T> = T extends (infer U)[] ? U : never;
export type Id = Widget["id"];
export type Greeting = `hello ${string}`;
