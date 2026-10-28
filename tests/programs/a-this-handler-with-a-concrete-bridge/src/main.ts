// The pair changes only the call target: a stored bridge or a concrete function.
let invokeHandler!: (receiver: Receiver, n: number) => number;
class Receiver {
  value = 3;
  static { invokeHandler = (receiver, n) => receiver.value + n; }
}
function concreteHandler(receiver: Receiver, n: number): number { return receiver.value + n; }
type Handler = (this: Receiver, n: number) => number;
function onEvent(this: Receiver, n: number): number { return concreteHandler(this, n); }
function dispatch(handler: Handler, receiver: Receiver, n: number): number {
  return handler.call(receiver, n);
}
export function work(n: number): number { return dispatch(onEvent, new Receiver(), n); }
