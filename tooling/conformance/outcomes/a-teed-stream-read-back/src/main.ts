// **Ours, not upstream's.** `ReadableStream#tee` hands each branch a
// `TeeBranch<T>` whose `start` closure stores the controller the stream
// gives it, and enqueues every chunk through that stored controller later.
// The closure is compiled at the branch's instantiation while the stream
// calls `start` at its own, so the JVM declines it under NTS4009 (17
// closures across the runtime, one shape). On C the controller's layout is
// one pointer at either instantiation; what this measures is whether the
// enqueue and read-back, compiled per instantiation, still answer right.
//
// **Today C refuses before any closure runs**: `TeeBranch`'s constructor
// passes `{ highWaterMark: 1, size }` where a `QueuingStrategy` is wanted.
// a-controller-stored-by-a-generic-branch reduces the closure without that
// literal and agrees on C, so the shape is the JVM's alone; this record is
// the integration witness for the day the literal compiles.
//
// **Expected, confirmed under node:**
//
//     first branch    1,2,3
//     second branch   1,2,3
//     strings, first  a,b
import { ReadableStream } from "@nts/runtime/web-platform/src/streams/readable.ts";

async function drain<T>(stream: ReadableStream<T>): Promise<string> {
  const reader = stream.getReader();
  const out: string[] = [];
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    out.push(String(step.value));
  }
  return out.join(",");
}

async function main(): Promise<void> {
  const numbers = new ReadableStream<number>({
    start(controller) {
      controller.enqueue(1);
      controller.enqueue(2);
      controller.enqueue(3);
      controller.close();
    },
  });
  const [a, b] = numbers.tee();
  observe("first branch", await drain(a));
  observe("second branch", await drain(b));
  const strings = new ReadableStream<string>({
    start(controller) {
      controller.enqueue("a");
      controller.enqueue("b");
      controller.close();
    },
  });
  const [s] = strings.tee();
  observe("strings, first", await drain(s));
  done();
}
main();
