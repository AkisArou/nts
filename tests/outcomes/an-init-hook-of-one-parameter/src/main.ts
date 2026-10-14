// **Ours, not upstream's.** node's own async_hooks tests declare `init` at
// arities 0, 2 and 3 in 28 of their 53 hooks, and none of those passes on the
// compiled axis, so no upstream test reaches this. It is the module-level
// form of `a-callback-field-called-at-four-arguments`, which reduces the same
// call and agrees: here the module itself registers the hooks and
// `AsyncResource` calls `emitInit`, at four arguments, through the erased
// `HookCallbacks` slot.
//
// **Expected, from JavaScript's own rules and confirmed under node:**
//
//     init at arity 4 (control): type        Witness
//     init at arity 1: asyncId is a number   true
//     init at arity 0: called                true
//
// The keys name the arity. Under node the module's native half is its
// `bindings.node.mjs`, which the outcomes preload installs.
//
// **Blocked upstream of any hook, by a pinned defect.** `AsyncHook#enable`
// calls `addHook`, which reads `const [registry, fields] = mutableRegistry()`
// -- a `[Map, HookCounts]` tuple, represented as an array of its first
// element's type (`a-tuple-whose-elements-are-different-references` pins
// it). So the three `.enable()` statements are cut and every hook is silent,
// the control included. When that tuple builds, this record moves to the
// arity arms.
import { AsyncResource, createHook } from "@nts/runtime/node/async_hooks/src/main.ts";

let four = "";
let one = false;
let none = false;
createHook({
  init(asyncId: number, type: string, triggerAsyncId: number, resource: object) {
    if (type === "Witness") four = type;
  },
}).enable();
createHook({
  init(asyncId: number) {
    if (typeof asyncId === "number" && asyncId > 0) one = true;
  },
}).enable();
createHook({
  init() {
    none = true;
  },
}).enable();
new AsyncResource("Witness");
observe("init at arity 4 (control): type", four);
observe("init at arity 1: asyncId is a number", String(one));
observe("init at arity 0: called", String(none));
done();
