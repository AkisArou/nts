// **A JVM witness whose C record is a guard.** A closure of fewer parameters
// passed as the callback of an interface method, the interface reached
// through an object's field. On the JVM the closure's class does not
// implement the callback's signature class at the `invokeinterface`, and the
// verifier rejects `Program` (jvm-verifies.ts --outcomes; readline's
// `Readline#commit` is the runtime site, cause C). Through a parameter
// instead of a field the call is devirtualised and verifies, and what the
// closure captures does not matter -- each measured.
//
// On C a closure called with more arguments than it declares ignores them,
// so this agrees, and must keep agreeing while the JVM is fixed.
//
// **Expected, confirmed under node:**
//
//     callbacks run   1
interface Writable {
  write(chunk: string, callback?: (err?: Error | null) => void): boolean;
}
class Sink implements Writable {
  write(chunk: string, callback?: (err?: Error | null) => void): boolean {
    if (callback) callback(null);
    return chunk.length > 0;
  }
}
class Committer {
  stream: Writable;
  constructor(stream: Writable) {
    this.stream = stream;
  }
  commit(): number {
    let n = 0;
    this.stream.write("x", () => {
      n++;
    });
    return n;
  }
}
observe("callbacks run", String(new Committer(new Sink()).commit()));
done();
