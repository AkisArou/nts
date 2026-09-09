# Two regressions the gate caught, and the test that could not

`ManagedType::Table` gained a variant of its own and broke two modules. Neither
was found by review, by clippy, by the workspace tests, or by the fixture that
exists for exactly one of them. Both were found by the gate's `addons` step,
which builds all twenty-two modules and takes seven minutes.

    process    REGRESSED -- addon.c:658: incompatible pointer types passing
                            'napi_env' to parameter of type 'const NtsMap *'
    readline   REGRESSED -- an `unknown` narrowed to Table(String, Erased),
                            which it cannot be read back as

## The first: a module's export named after the wrapper's own local

`process.env` is a global whose C name is `env`. `NAPI_MODULE_INIT()`'s
parameter is also `env`. The extern sat at file scope and the parameter shadowed
it, so the wrapper emitted

    extern NtsMap * env;
    NAPI_MODULE_INIT() {
        ... nts_to_napi_entries(env, env, &value) ...

where the second `env` was meant to be the module's global and resolved to the
napi environment. Well-formed text; uncompilable C.

It only appeared now because `process.env` had nothing to publish until tables
crossed. The bug is older than the change that revealed it, which is the usual
shape.

**Fixed by reading every value export through a file-scope function** defined
where the global is visible:

    extern NtsMap * env;
    static NtsMap * nts_export_env(void) { return env; }

Not by a reserved-name list. The wrapper introduces `env`, `exports`, `out`,
`value`, `status`, `argv` and gains more whenever a crossing does; a list is the
same fix without the guarantee, and stale the next time somebody adds a local.
The control below found `value` colliding as well, which no one had named.

`process.env` now crosses with **105 keys, all matching node**, `HOME`
included.

## The second: the seventh time one list learned a variant and the other did not

`erasable` in the lowering and `erased_tag` in the C backend are one decision
written twice. `Table` was taught to neither. `readline` narrows an `unknown` to
a `Record<string, unknown>` in `internal/errors.ts` and the readback refused.

The comment above `erasable` predicted this in writing, a day before it
happened: *"a variant taught to the backend that has to spell it and not to the
predicate that decides whether it may be asked about"*. It also says the seventh
time would be a test rather than a comment.

**The test was there. It passed.**

    let managed = [
        ManagedType::String,
        ...
        ManagedType::Set(...),
    ];

Twelve variants written out by hand, of thirteen. `Table` was not in the list,
so the loop never asked about it, so the test that exists to catch exactly this
drift was green through exactly this drift.

That is the finding, and it is more general than this file. **An instrument that
enumerates its own inputs by hand can only fail for an input it already knows
about -- which is the one case it never needs to catch.** The other list this
family keeps, `erased_tag`, ends in `_ => None`, so a new variant falls through
it silently too. Every other match this change touched was exhaustive and named
itself at compile time; these two are the ones that cannot, and that is why they
are the two that drift.

Rebuilt so that adding a `ManagedType` takes three edits, each of which fails
until all three are done. `position` is an exhaustive match with no catch-all,
so a new variant does not compile. `COUNT` sits beside it, so an arm without a
bump fails. And the samples must cover `0..COUNT` exactly, so a bump without a
sample fails -- because an arm no sample reaches never runs, and a match arm is
not evidence that anything was tested.

## Both controls, run

Neither guard is worth anything unheld against its own failure.

    erasable without Table    the_two_erasure_lists_agree  FAILED, naming Table
    a sample removed          the_two_erasure_lists_agree  FAILED, naming the gap
    the reader removed        addon-compiles               REGRESSED, with clang

The third is a new guard form. `compiles` builds `program.c`; every other form
reads emitted *text*; nothing could see an addon that was good text and bad C.
`addon-compiles` builds `addon.c`, and `value-export-named-like-a-wrapper-local`
is the fixture -- five exports named after five wrapper locals.

Its control printed the collision this record opens with **and a second one**:

    addon.c:694: passing 'napi_env' to 'const NtsMap *'
    addon.c:699: passing 'napi_value' to 'const NtsString *'

`value` shadows `napi_value value` in the publication block. Nobody had noticed
that one, and the fixture found it by being asked to fail.

## What this says about where the guards are

The gate found both regressions and the gate is a serialised twenty-minute
resource shared by three sessions. `addon-compiles` asks the same question of
one file in two seconds. The five test files behind `os.constants` and the two
modules behind this pair were all reachable from cheap instruments that did not
exist yet; what was expensive was not the checking, it was that the check ran
only in the most expensive place available.
