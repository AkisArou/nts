// web-platform's `TeeBranch<T>`, without the queuing strategy that refuses
// the real one today: a generic branch hands a generic stream a `start`
// closure that stores the controller, and enqueues through it later. The
// JVM declines the closure under NTS4009 -- `call(Controller<A>)` over
// `call(Controller<B>)`, two instantiations -- 17 times across the runtime,
// every one this closure (readable.ts:2898). All are unreachable on C today,
// because TeeBranch's constructor is refused on its `QueuingStrategy`; this
// measures whether the shape is live once reachable.
//
// **Expected, confirmed under node:**
//
//     numbers   1,2
//     strings   a,b
class Controller<T> {
  queue: T[] = [];
  enqueue(value: T): void {
    this.queue.push(value);
  }
}
class Stream<T> {
  controller = new Controller<T>();
  constructor(source: { start: (controller: Controller<T>) => void }) {
    source.start(this.controller);
  }
}
class Branch<T> {
  controller: Controller<T> | undefined;
  readonly stream: Stream<T>;
  constructor() {
    this.stream = new Stream<T>({
      start: (controller) => {
        this.controller = controller;
      },
    });
  }
  push(value: T): void {
    this.controller?.enqueue(value);
  }
}
const numbers = new Branch<number>();
numbers.push(1);
numbers.push(2);
observe("numbers", numbers.stream.controller.queue.join(","));
const strings = new Branch<string>();
strings.push("a");
strings.push("b");
observe("strings", strings.stream.controller.queue.join(","));
done();
