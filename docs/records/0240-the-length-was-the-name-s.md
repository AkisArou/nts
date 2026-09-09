# The length was the name's

Every function this profile's addons published reported `length` 0.

    napi_create_function(env, "hostname", NAPI_AUTO_LENGTH, nts_napi_hostname, …)

`NAPI_AUTO_LENGTH` there is the **name string's** length.
`napi_create_function` takes no arity at all, so a published function has no
`length` unless something defines the property afterwards, and nothing did.

Found by the Node lane, and the shape of the finding is the useful part: of 56
published names node also has, 26 "agreed" — because node's was 0 too. The only
three with a real `length` were JavaScript wrappers a `shape.mjs` builds. **A
constant answer agrees with everything that happens to share it.**

## What the fix is worth, and the two rows that say the rule

    path        11 of 11 agree, at all three levels
    path.posix  11 of 11
    path.win32  11 of 11
    four modules together   68 of 89

Before, three.

The rule is not the one I wrote first. `take_while(Ordinary)` gave `basename` a
`length` of 1 against node's 2, and it was the single disagreeing row out of
eleven — the one that made the difference between shipping and checking. The
specification counts parameters before the first with a **default value** or a
rest element, and a TypeScript `?` is neither: `suffix?: string` compiles to a
plain parameter. So `Optional` counts and only `Defaulted` and `Rest` stop it.

`writable: false, enumerable: false, configurable: true`, which is what a
function's own `length` is. A descriptor with `napi_writable` would produce a
`length` assignment can change, which no ordinary function has.

## The residue is not ours, and saying which is the point

Twenty-one still differ. Twenty of them are node reporting **0**:

    util.types.isDate isMap isSet isWeakMap isWeakSet isPromise isNativeError
    isArrayBuffer isSymbolObject isBigIntObject isGeneratorFunction …
    util._errnoException

Node's `util.types` predicates are C++ bindings with no declared arity, so
node's own `length` is 0 and ours is 1. Ours is arguably the more correct
number; it is not node's, and node is the oracle. Chasing it would mean
reproducing an implementation detail of V8's binding layer.

The twenty-first is `os.getPriority`, ours 0 against node's 1 — and that one is
neither the emitter's nor node's: our source declares `pid = 0` where node's
declares `pid`. A default value is exactly what `length` stops at, so the
emitter is right about a signature that differs.

**So the emitter is correct in all 89 cases**, which is a different claim from
"68 of 89 match" and the one worth writing down.

## Why three instruments missed it

The Node lane's own summary, which is better than anything I would have written:
`loads.sh` counts the name, `unusable-exports.mjs` calls it, `surface-diff.mjs`
compares its value — **and a function with the wrong `length` passes all three.**

Three instruments, three angles, one blind spot, because all three ask about
*values reachable by name*. It was found by asking a question none of them
encodes rather than by running any of them.

The same lane deepened its own number an hour later, 27 to 95, because the first
walk stopped at the top level and never saw `path.posix.*`, `path.win32.*` or
`util.types.*` — all one level in, all `length` 0. That is the second time in a
day a one-level walk understated a count here, and the answer changed by three
and a half times.

## What is left, named rather than fixed

A class **method**'s `length` is still 0. `napi_property_descriptor` carries no
arity either, so the same repair would need a post-hoc define on each prototype
property. No method in this profile's published surface takes an argument node
also declares, so it is written down rather than built.
