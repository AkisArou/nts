// expect: a function returning the type parameter `T`
//
// Crypto.getRandomValues returns the exact typed view it receives. Its class
// method's uninstantiated template is refused even beside a concrete caller.
// The control changes only the method signature to the concrete view type.
class GenericView {
  identity<T extends Uint8Array>(view: T): T { return view; }
}

class PlainView {
  identity(view: Uint8Array): Uint8Array { return view; }
}

export function subject(value: number): number {
  const view = new Uint8Array(1);
  view[0] = value;
  return new GenericView().identity(view)[0]!;
}

export function control(value: number): number {
  const view = new Uint8Array(1);
  view[0] = value;
  return new PlainView().identity(view)[0]!;
}
