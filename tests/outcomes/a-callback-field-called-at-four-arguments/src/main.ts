// **Ours, not upstream's.** A reduction of async_hooks' `emitInit`: an
// interface with an optional four-parameter callback, hooks kept in a
// registry, each called at four arguments. JavaScript lets a hook declare
// fewer parameters, and node's own async_hooks tests do so in 28 of their 53
// `init` hooks (arities 0, 2 and 3) -- none of which passes on the compiled
// axis today, so no upstream test witnesses this shape. The compiled call
// goes through the erased `init` field at the call site's four-argument
// signature, whatever the closure was written as.
//
// **Expected, from JavaScript's own rules and confirmed under node:**
//
//     init at arity 4 (control): id+type   1:Witness
//     init at arity 1: id                  1
//     init at arity 0: called              true
//
// The keys name the arity, so a before state reads as which arity misread.
interface Callbacks {
  init?: ((asyncId: number, type: string, triggerAsyncId: number, resource: object) => void) | undefined;
}

const hooks = new Map<number, Callbacks>();
let next = 0;
function createHook(callbacks: Callbacks): void {
  hooks.set(next++, callbacks);
}
function emitInit(asyncId: number, type: string, trigger: number, resource: object): void {
  for (const hook of hooks.values()) {
    if (typeof hook.init !== "function") continue;
    hook.init(asyncId, type, trigger, resource);
  }
}

let four = "";
let one = "";
let none = false;
createHook({ init(asyncId: number, type: string, triggerAsyncId: number, resource: object) { four = `${asyncId}:${type}`; } });
createHook({ init(asyncId: number) { one = String(asyncId); } });
createHook({ init() { none = true; } });
emitInit(1, "Witness", 0, {});
observe("init at arity 4 (control): id+type", four);
observe("init at arity 1: id", one);
observe("init at arity 0: called", String(none));
done();
