// Control for a-controller-holding-a-generic-interface: only ControllerState's
// alias target changes from the generic interface to the concrete state class.
const key: unique symbol = Symbol("controller");
type ControllerState<T> = Owner<T>;
interface State<T> { enqueue(value: T): void; current(): T; }
class Owner<T> implements State<T> {
  #value: T;
  readonly controller: Controller<T>;
  constructor(value: T) { this.#value = value; this.controller = new Controller(key, this); }
  enqueue(value: T): void { this.#value = value; }
  current(): T { return this.#value; }
}
export class Controller<T> {
  readonly #state: ControllerState<T>;
  constructor(...args: [typeof key, ControllerState<T>]) {
    const token = args[0];
    const state = args[1];
    if (token !== key || state === undefined) throw new TypeError("Illegal constructor");
    this.#state = state;
  }
  enqueue(value: T): void { this.#state.enqueue(value); }
  current(): T { return this.#state.current(); }
}
export function work(n: number): number {
  const owner = new Owner(n);
  owner.controller.enqueue(n + 1);
  return owner.controller.current();
}
