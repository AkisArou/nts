# 0046 — A wrapper that called a name the program does not define

`runtime/node/path` reported something that could not be true:

    posix.ts:30:30: `Closure34#call` cannot be compiled because it calls
                    `isPosixPathSeparator`, which was refused above

Nothing had refused `isPosixPathSeparator`. It is four lines and returns
`code === CHAR_FORWARD_SLASH`, no diagnostic anywhere in the run named it, and
`isPathSeparator` — the same shape, in the same file — compiled. What was true
is that it did not reach the emitted C, and neither did the other one:
`posix.ts` declares it and so does `win32.ts`.

## What it actually was

Reduced to two modules, each declaring `shared` and passing it to a function
that takes it as a value, the compiled program does not merely refuse. It
**crashes**:

    static const NtsDescriptor nts_desc_NtsObj_Closure0 =
        { NTS_KIND_OBJECT, sizeof(NtsObj_Closure0), 0u, 0u, 0, 0, "Closure0", 0u, 0 };
                                                            ^ the method table

    v2 = ((bool (*)(NtsObj_Fn7 *, double))v0->header.descriptor->methods[0])(v0, v1);

A null method table, and a call through it. Seventeen segfaults where the
differential expected seventeen answers.

The chain is short and every link is reasonable on its own. Two functions
cannot share a name in the emitted C, so `Naming` qualifies them apart by the
file they came from — `shared@a` and `shared@b`. A function used as a *value*
gets a wrapper, `Closure0#call`, whose whole body is a forward to the function
it stands for. The wrapper read the name off the declaration's identifier
token:

    .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
    .and_then(|child| self.node(child).text.clone())

which is `shared`, and no function is emitted under that name. A call to a
function the program does not define is a refusal, the wrapper is refused for
it, and the wrapper *is* the closure's only method — so the vtable came out
null, and nothing along the way had to be wrong to get there.

## Why no diagnostic named it

Because none was owed. `shared` was never refused: it was never *reached*. The
wrapper is what makes a named function a value, the wrapper was refused, and
`shared` was then dead code and pruned. The cascade message names the callee it
could not find, which is exactly the name that does not exist — so the
diagnostic was telling the truth in a way that reads as a contradiction.

## The fix, in two lines and two places

A call site has known this since there were modules:

    self.qualified.get(&declaration).cloned().or_else(|| self.declared_name(declaration))

The wrapper now asks the same question. That alone changed nothing, which was
the second half of the bug: closures are lowered by a builder made with
`FuncBuilder::within`, and every *other* builder is made by `shared.builder`,
which clones the qualified names into it. The closure worklist did not, so the
map it consulted was empty.

## What it was worth

`path`'s posix side compiles entirely — `resolve`, `normalize`, `join`,
`relative`, `basename`, `dirname`, `extname`, `isAbsolute`, all eight. Before
this it had `isPosixPathSeparator` in the middle of `normalizeString`'s
argument list and lost `resolve` and everything downstream of it.

Two refusals are left in the module, both in `win32.ts`: `let device;` with no
annotation, which is TypeScript's evolving `any`, and an empty array literal
whose element type is itself an array.

## The example

`examples/shared-names` is two modules declaring `isSeparator`, each passing it
to a scanner and also calling it directly. It segfaults seventeen times without
the fix and agrees with node on fifty-eight cases with it — checked both ways
round rather than asserted, because a regression test that does not fail on the
bug it is named after is decoration.
