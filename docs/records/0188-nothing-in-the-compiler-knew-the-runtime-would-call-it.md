# Nothing in the compiler knew the runtime would call it

The first TypeScript program in this repository to hand a closure to a
networking intrinsic and then read what that closure stored found two defects in
the shared middle end. Both have one cause, and the second is a
miscompilation on all three backends.

    Exception in thread "main" java.lang.AbstractMethodError:
      Receiver class nts.gen.Closure0 does not define or inherit an
      implementation of the resolved method 'abstract void call(double)'

## One: the body was pruned

`reachable.rs` already had the rule. Its comment is worth quoting because it
predicted its own gap:

> An external callee is not in this program and the linker supplies it -- but a
> *closure* handed to one is called back through its method table, which is what
> `setTimeout` does with its callback. [...] Without this the body was pruned,
> and because the layout's entry went with it the table was emitted as a null
> pointer. Nothing failed: `examples/timers` cancels every timer before it can
> fire, so the call through the null was never made -- **which is what a rule
> with no case that executes it looks like from the outside.**

The rule takes the methods of the layout of whatever was passed. That works when
the closure literal is the immediate argument, which is how every `setTimeout`
in the corpus is written. It does not work when the closure reaches the
intrinsic through a function of its own:

    export function connect(..., onOpen: (h: number) => void) {
      return nts_jvm_web_connect(..., onOpen);   // onOpen is declared as the base
    }

The argument's type here is the abstract function-type base, whose own methods
are declarations with no bodies. Every implementation was pruned. The classes
were still emitted, so the JVM had a `Closure0` extending an abstract base and
implementing nothing -- and JVMS 4.10.1.2 means that verifies: interface
conformance is checked at the call, never at load. The `AbstractMethodError`
arrives at the first callback and not before.

Taking the layout *and everything that derives from it* fixes it.

## Two: the parameter was BOTTOM, and BOTTOM is the identity for join

This one is worse, and it survived the first fix.

    let handle = -1;
    socket.connect(..., (h) => { handle = h; state = 1; }, ...);

`handle` compiled to a constant.

    public static double currentHandle();
       0: ldc2_w  #50    // double -1.0d
       3: dreturn

and on C, from the same HIR:

    double currentHandle(void) { return -1.0; }

`globals::analyze` seeds each global with its initial value and joins what every
store puts there. It **did** see the store -- the probe says
`set global 2 from Closure0#call` -- and joined this:

    entry    = [-1, -1]
    incoming = [inf, -inf]        <- the empty interval, BOTTOM
    result   = [-1, -1]

`incoming` is the closure's parameter, and `interprocedural.rs` gives a
parameter the join over its call sites. This closure has none: the only thing
that calls it is the runtime. An empty join is BOTTOM, BOTTOM is the identity
for join, and so the global was proved constant at the value it was declared
with.

Note which one it hid behind. `state = 1` is a *constant* assignment, so
`[0,0] ⊔ [1,1] = [0,1]` and `status()` was never folded -- the callback
demonstrably ran. Only the assignment that carried the parameter was lost. A
test asserting "the callback fired" passes; a test asserting "and here is what
it was given" does not.

The module's own documentation had the answer already written down:

> An **exported** function's callers are outside the compiled set, so nothing
> observed inside the program bounds its parameters [...] Narrowing those from
> the calls that happen to be visible would be exactly the unsoundness this
> analysis exists to avoid: the next caller is a linker away.

A closure the runtime invokes is on the same side of that wall as an export. It
belongs in `outward`, and now is.

## What this says about the instrument

Neither defect is reachable from any test that existed. `examples/timers` passes
its closure directly and cancels before firing; nothing else in 124 examples
hands a closure across the boundary and then reads what it wrote. The corpus was
115 of 115 with both bugs present.

That is the argument for the intrinsics fixture in one line. Record 0186 said a
suite that drives the runtime from the runtime's own language is not evidence
about the lane. This is the same claim from the other end: **the boundary is
where the compiler's assumptions about who calls what stop being true**, and a
program that crosses it is the only thing that can find out.

The fix is one function, `reachable::callback_names`, used by both passes --
because both were asking the same question and only one of them had noticed.
