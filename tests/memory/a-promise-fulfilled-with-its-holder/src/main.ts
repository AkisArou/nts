// A promise fulfilled with the object that holds it.
//
// `holder.promise` -> the promise -> its payload -> `holder`: a cycle through
// the runtime's own promise object, which nothing outside holds once its
// iteration ends. Counting cannot free it; the collector can, by walking the
// edges a promise traces -- the payload here -- which have to be exactly the
// edges its destruction gives up (`nts_promise_trace_fields` and
// `nts_promise_release_fields` in `runtime/c`). A trace that missed the
// payload would leave the cycle's counts unexplained and both objects leaked,
// which is what the leak check beside every count says.

class Holder {
  value: number;
  promise: Promise<Holder> | null;
  constructor(value: number) {
    this.value = value;
    this.promise = null;
  }
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 8 + n; i++) {
    const holder = new Holder(i);
    const promise = new Promise<Holder>((resolve) => {
      resolve(holder);
    });
    holder.promise = promise;
    total = total + holder.value;
  }
  return total;
}
