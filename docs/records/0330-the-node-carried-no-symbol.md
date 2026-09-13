# The node carried no symbol

A nested `function` declaration reading a local of the function that declares it
was refused. It is a **desugaring**, not a feature: the same body written either
of the other two ways lowered all along.

```ts
function outer(columns) {
  function visit(i) { return i * columns }            REFUSED
  const visit = function (i) { return i * columns }   lowers
  const visit = (i) => i * columns                    lowers
}
```

So a nested declaration is a hoisted `const` holding a function expression, and
every piece of capture machinery it needs already existed.

## Four of five were right, and the fifth pointed at the cause

The five places: the collector takes it, the declaration loop stops emitting a
top-level function for it, the statement allocates and binds, the call site
routes through the binding, and `reached_by_name` keeps answering for module
scope.

The first attempt failed at the call site, and the shape of the failure is the
record. **Each step's failure looked exactly like the previous step not having
worked** — the closure body was missing, so the collector looked wrong; the call
resolved directly, so the binding looked wrong. Instrumenting each step in turn
was the only thing that separated them:

```text
collect_closures      takes it        within=true this=false -> true
bind_nested_function  fires           in-closures=true
lower_arrow           never ran       ← the binder returned before it
```

A `FUNCTION_DECLARATION` node **carries no symbol**. Its name child does, and
that is the symbol every call site resolves to. Binding under
`self.node(id).symbol` bound under `None`, returned early, and so the allocation
never happened either — one wrong accessor, three symptoms, none of them at the
line.

## Restricted to declarations that capture

Taking *every* nested declaration as a closure left **210 `a declaration outside
every walk` in `util` alone** — a body nothing emitted and nothing refused. One
that reads nothing from around it is an ordinary function and always was.

Both sides of that decision ask one function now, because the declaration loop
decides not to emit and the statement decides to allocate, and a disagreement
between them is a name with nothing behind it.

## The arm the row's own case needed

The allocating side binds the name in the *enclosing* function. A recursive
`down(k - 1)` is inside the body, where that binding does not reach — so inside
its own body the name is bound to the **receiver**, which is the closure itself.

The row's motivating site is "a recursive matcher closing over `columns` and
`memo`". An example without a recursive arm would have missed the case the work
was for, and the first probe did.

## What it moved

```text
util   5 -> 1     net   21 -> 1     assert 4 -> 0
stream 21 -> 0    http  24 -> 1
```

Module totals fell 4 to 30 as the cascades behind them cleared. Nothing went up.

## What is left, and why the second one is not about this at all

A nested function that **binds its own `this`** stays a plain function. A
closure inherits the enclosing receiver — that is what an arrow does and what a
`function` deliberately does not — and the test is the one the `function`
*expression* arm has always used. Not a new restriction; an existing line
reached by a second form.

And **use before the declaration**. A declaration is usable above its textual
position and a `const` is not. Hoisting the allocation would not fix it: this
captures **by value**, so an allocation at the top of the block reads locals
that do not have their values yet. The limit is capture-by-value, and the honest
fix is a cell — the same machinery the `for`-loop capture row still wants for
the case *it* refuses.

Two rows, one missing mechanism, and neither row says so on its own.
