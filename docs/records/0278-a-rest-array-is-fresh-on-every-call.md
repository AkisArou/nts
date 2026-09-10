# A rest array is fresh on every call

    this.emit(EventEmitter.errorMonitor, ...args);

The single spread refusal in `events`, and `EventEmitter#emit` is under
`addListener`, `EventEmitter#on`, `net.Server`'s constructor, `http.Server`'s
and `createServer`. One to five spread refusals per module across the corpus,
and this is the one that matters — **rank by what clears, not by how often the
message appears.**

## A rest parameter is one array parameter

`function sum(...xs: number[])` lowers to `sum(xs: managed<[f64]>)`, and the
*call site* builds the array. So a spread is a length this compiler does not
know: `f(a, b)` allocates two slots, `f(a, ...rest)` allocates one plus however
many `rest` holds.

`nts_array_concat` already answers that and every backend already emits it, so
this is the fixed part plus a fold — not a loop the lowering has to build.

## The concatenation is what makes it correct, not only short

A rest array is **fresh on every call** in JavaScript. Passing the caller's
array straight through would alias it, and `function f(...xs) { xs.push(1) }`
would reach back into its caller's.

`concat` returns a new array, so `f(...rest)` with nothing leading still gets a
copy — and the empty leading array it concatenates with is what makes that fall
out of the general case rather than be a rule written twice. That sentence
turned out to be load-bearing on the other lane too: their first fix took the
component type from the first argument, which for `f(...rest)` is the empty one.

A spread before another argument is refused by name. The elements after it would
need placing at an offset this compiler does not know, and mis-placing them
silently is the failure this whole record is about avoiding.

## Three element widths, and the third had no helper

    nts_array_concat        doubles
    nts_array_concat_ref    pointers
    nts_array_concat_value  tagged, new

An `unknown[]` is sixteen bytes an element and a reference only when the tag says
so, so the double form reads half of one and the reference form would retain a
payload that may be a number. The new one retains exactly the elements whose tag
says they are references — the rule `nts_array_element` already follows for
reading one.

That is the width a variadic forwarder actually uses:
`emit(type, ...args: unknown[])`. A fixture with only `number[]` would have
passed with two of the three wrong, which is why the example has a control per
width.

## What one op turned into on the other lane

Adding it refused on `nts_array_concat_ref` as well. That lane's resolver
holding all three concat forms is consulted only when the *program grows* an
array, and this example grows none — so it took the bare-array path, which had
`arraySlice` and no concat at all. Both had been missing for as long as both
callers existed; the new op was simply the first thing to route down that side.

**A helper missing from a path nothing takes is indistinguishable from one that
is present**, which is the same shape as `nts_symbol_to_string` leaking for as
long as no example called it.

## Where the chain stops

`EventEmitter#emit` still does not lower. Its next blocker is
`callback.call(this, ...args)` — `Function.prototype.call` with an explicit
receiver, which our closures cannot express: they capture `this` as a field and
`call` rebinds it. That is a representation decision and it is filed rather than
started.

Eight links from `createServer` today, eight different constructs: a class used
as a value, a dotted read on an index signature, a `this`-typed generic, a
static field, `unique symbol`, `String` of a symbol in an erased slot, a spread
element, and `.call`. **Two of the eight named a refusal that was never
printed, and none would have been found by ranking a census.** A census reports
what is loud; a chain reports what is next.
