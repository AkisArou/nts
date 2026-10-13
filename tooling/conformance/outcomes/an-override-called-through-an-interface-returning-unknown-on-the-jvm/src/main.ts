// run: check
// backend: jvm
// **An override reached through an interface whose method returns `unknown`
// is called at a slot its class does not have.** `attach(source: Source)` is
// copied per argument class (`attach$0obj8` for `Emitter`), and because `Loud`
// overrides `on`, the copy calls `Emitter#on` virtually, typed: it returns
// `Emitter`. The dispatch table holds only the erased entry, `on$erased`, which
// returns an erased value -- the one `Source#on` asks for.
//
// - The JVM: `Emitter` declares no `on(String, Callable)Emitter`, so the first
//   call throws NoSuchMethodError (`...-on-the-jvm`).
// - C: slot 0 is `Emitter__on____erased`, called through a pointer typed to
//   return `NtsObj_Emitter *`. That is undefined behaviour, and it agrees only
//   because the result is discarded. Under counting the result is held so it
//   can be released, and the C does not compile: "assigning to 'NtsValue' from
//   incompatible type 'NtsObj_Emitter *'" (`...-under-counting`).
// - LLVM agrees, under both providers.
//
// The control is this program with `Loud`'s override removed, so no dispatch.
// It agrees on C, on C and LLVM under counting, and on the JVM. It is not an
// arm here because the subject aborts.
//
// In the runtime, stream's `prependListener` reaches the same call through
// `PipeEventSource.prependListener` (it returns `unknown`; EventEmitter's
// returns `this`). It keeps child_process, cluster, crypto, dgram, fs, http,
// net, process, stream and zlib from building under counting: on 2026-10-13,
// `emitted-diff --rc --axis` could not measure those ten. Found by the JVM
// lane while measuring an erased array's `cyclic` flag.

interface Source {
  on(event: string, listener: (...args: unknown[]) => unknown): unknown;
}

class Emitter {
  count = 0;
  on(event: string, listener: (...args: unknown[]) => unknown): this {
    this.count += event.length;
    return this;
  }
}

class Loud extends Emitter {
  override on(event: string, listener: (...args: unknown[]) => unknown): this {
    this.count += 2 * event.length;
    return this;
  }
}

function attach(source: Source, event: string): void {
  source.on(event, () => 0);
}

export function run(n: number): number {
  const quiet = new Emitter();
  const loud = new Loud();
  attach(quiet, "ab");
  attach(loud, "abc");
  return quiet.count + loud.count + (n & 3);
}
