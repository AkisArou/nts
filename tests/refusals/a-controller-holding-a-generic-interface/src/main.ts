// expect: a method `enqueue` with no declaration in the hierarchy
// TransformStreamDefaultController's generic interface state, reduced. The
// exported constructor is retained and unerases State<T>, while work and its
// Owner construction are refused through the generic interface methods.
// Control: a-controller-holding-its-concrete-state changes only the state alias.
const key: unique symbol = Symbol("controller");
type ControllerState<T> = State<T>;
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
