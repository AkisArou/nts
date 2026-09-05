# The caller had the value the whole time

    a parameter default that reads `a`, another parameter

**77 distinct sites in `runtime/node`**, and the refusal's own comment explained
why it could not be done:

> A default is supplied by the calls that omit it, which is where JavaScript
> evaluates it. What that cannot reach is the callee's own scope, so a default
> that reads another parameter is refused here rather than mis-lowered there.

Every sentence is true. The conclusion does not follow. **The call site does not
need to reach the callee's scope, because it has already computed the values in
it** — `f(a, b = a + 1)` called as `f(2)` needs `a` to mean two, and two is
sitting in `args[0]`.

So the fix is to bind the callee's names to the caller's values for exactly as
long as the default is being lowered, and put back whatever those names meant
before. About twenty lines, and it deletes a refusal and its helper.

TypeScript refuses a default that reads a *later* parameter itself (`TS2372`),
so the only direction that reaches here is the one that works.

## Restoring is not optional, and the first fixture could not tell

The saved-and-restored part looks like tidiness and is not. A **recursive** call
is the one case where the caller already has a binding for the symbol being
bound — they are the same function:

    function deep(n: number, seed = n * 2): number {
      if (!(n > 0)) return seed;
      const inner = deep(n - 1);   // binds the callee's `n` to `n - 1`
      return inner + n;            // and this must still be `n`
    }

Without the restore, `n` after the call is `n - 1` and every level is off by one.

**The mutation that removes the restore passed every test and every differential
case** until that function existed. `count(n, acc = n)` — the recursive fixture
already in the example — supplies *both* arguments at its recursive call, so no
default is lowered there and nothing is shadowed. A recursive call is not the
shape; a recursive call **that omits a default** is.

## And the off-by-one fixture could not tell either

The other mutation indexes the arguments from the wrong end. It survived every
test in the file, and only the differential caught it, on 26 cases.

The reason is in the fixture: `twoBack(n, n + 5)` writes its second argument as
an expression *in `n`*, so "the call wrote this" and "the default computed it
from the first argument" are the same shape in the HIR and no structural check
can separate them. With the written arguments as constants — `twoBack(n, 5)` —
the third argument's provenance is decidable, and the mutation fails a test as
well as 28 cases.

Both fixture repairs came from the mutations, which is the order the rule asks
for: **break each on purpose first.** Two of the four checks here could not fail
until the example was changed, and the example was changed because the checks
could not fail.

## The hazard the refusal named, and why it does not apply

The fixture in `examples/unsupported` carried the argument against doing this:

> filling it would evaluate `a` twice, and twice is a different program whenever
> it has an effect.

That is true of re-lowering the argument **expression** at each default, and
false of binding the **value** it produced. `readsItTwice(bump(n))` has two
defaults reading `a`; `bump` is lowered once and both defaults name its result.
`theArgumentIsEvaluatedOnce` counts the effects and the answer is one.

Worth separating carefully, because the refusal was not being paranoid — it was
describing a real way to implement this badly, and the description was accurate
enough that it reads as an argument against the feature rather than against one
implementation of it. **A refusal that names its hazard precisely is the most
persuasive kind, and the most likely to outlive its reason.**

## And the fixture found a difference between the lanes

The recursive fixtures take `n % 5`, which is bounded — except for a NaN, where
`NaN <= 0` is false and `NaN - 1` is NaN, so the recursion never stops. The pool
supplies one.

**The JVM lane reported it and the C lane did not.** `StackOverflowError`
against a native stack that outlasted the harness's per-case timeout, so on C
the case was counted as *not reached* and the run said it agreed. One unbounded
recursion, two lanes, one of them silent — which is the same shape as `growable`
in record 0115: a divergence in what the program *did* rather than in what it
computed, invisible to an instrument comparing answers.

Both fixtures test `!(n > 0)` now, which stops on a NaN, and the comment says
why rather than leaving the spelling looking like a stylistic choice.

## The count went up

    profile refusals, distinct sites   2176 -> 2201
    of which this one                    77 ->    0

Twenty-five more than before. A function that stops being refused for this
reason lowers further and meets a *different* refusal further in — the same
thing the `readonly` fix did, and the second time this stretch that closing a
gap has raised the count.

That is the count working. It measures what the compiler declines to do, and
seventy-seven false reasons becoming a hundred-and-two true ones is progress a
falling number would have hidden.

## Measured

    parameter-defaults (memory)   ideal 0   allocated 0   actual 0   alloc 0

Argued before measuring, and **rewritten once because the first version was not
about its own subject**: it defaulted a `string` parameter, and the
concatenation in its body allocated thirty-four times against an argued floor of
zero. True, and nothing to do with parameter defaults. A case whose floor is
dominated by something other than what it tests cannot fail for the right
reason.

**No benchmark row, and the reason is verified rather than asserted.** A default
is one expression evaluated where the call is, so a call that omits it and a
call that writes it out emit the *same C*:

    viaDefault:  vN = 1.0;  vN = vN + vN;  vN = f(vN, vN);  return vN;
    written:     vN = 1.0;  vN = vN + vN;  vN = f(vN, vN);  return vN;

Identical modulo SSA numbering. There is nothing new on a hot path to time.

## Ratchets

- `examples/parameter-defaults` — 313 cases against node: one default reading
  the parameter before it, a chain of four where each reads the last, every
  arity of the same signature, a default reading a module constant beside a
  parameter, a recursive call that omits its default and reads its own name
  afterwards, a method where the receiver is argument zero, a managed default,
  a default that is a call, and an argument with an **effect** read by two
  defaults, which counts the effects and finds one.
- `compiler/core/tests/parameter_defaults.rs` — seven tests, two mutations, each
  failing a test **and** the differential. Neither did before the fixtures were
  repaired, which is written above.
- `tooling/memory/cases/parameter-defaults` — 0 / 0, argued before measuring.
- No benchmark row, for the reason above.
