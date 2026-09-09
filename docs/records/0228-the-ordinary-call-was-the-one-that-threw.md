# The ordinary call was the one that threw

    path.basename("/a/b.txt")           THREW: the compiled function requires 2 arguments
    path.basename("/a/b.txt", ".txt")   "b"

`basename(path: string, suffix?: string)` published with its optional parameter
required. The two-argument form was correct and the one-argument form -- which
is how that function is almost always called -- threw `ERR_MISSING_ARGS`.

**316 exported functions in the node profile take an optional or defaulted
parameter**: fs 143, stream 59, zlib 39, util 16, timers 12, and single entries
that matter more than the counts. `net.createServer(options?, connectionListener?)`
is the most valuable export on the board by test files, and
`dgram.createSocket(type, listener?)` is third; node's own dgram tests call
`createSocket("udp4")` fourteen times and `createSocket()` three.

## What found it, and what could not have

The first differential ever run against a compiled addon. `differential-addon.mjs`
existed and nothing invoked it; the sweep printed "0 divergences" for eleven
modules from the *interpreted* lane, whose stand-ins call node's own
implementation. On its first real run it produced 20,168 divergences for `path`
against 0 for `punycode` and `os`, and this was one of the two causes.

Node's own test files could not have found it. `path` passes eleven of them and
none calls `basename` with one argument, because each test calls each function
the way its author wrote it. A corpus of real programs is not a corpus of
argument lists.

And the blocker had been *filed for hours*. `optional-parameter-at-the-wrapper`
existed, reproduced, and was ranked as one boundary blocker among several,
because a fixture proves a thing exists and says nothing about what it stops. It
took a number to move it.

## The fix, and the half of it that stays broken on purpose

The wrapper now reads up to every declared parameter and requires only the
leading run of non-optional ones. An omitted argument is `undefined`, spelled
the way the callee's parameter type spells it: the null pointer for a reference,
which is what `suffix === undefined` already compiles to inside `basename`, and
an erased value carrying the tag otherwise -- which is why the lowering types an
optional `number` parameter `erased` and an optional `string` parameter as an
ordinary pointer. That asymmetry looked like an inconsistency until it was the
thing that made this a five-line change.

**A defaulted parameter is still required.** `ParamShape::Defaulted`'s contract
is that "the initializer is evaluated by each caller that omits the argument":
the lowering inlines it at every call site, and the HIR does not carry the
expression. A wrapper is a caller with nowhere to get it from, so supplying a
zero would invent a value the source never wrote. Thirty-one exported functions
are in that position and they keep throwing, correctly, until the wrapper can
evaluate an initializer or a synthesised arity-shim can.

## Verified by calling it

`path.basename` over seven paths and three argument lists, against `node:path`:
**21 of 21 agree**, every one-argument call included, through the top-level
export and both namespaces.

## The guard I wrote for it could not have failed

The fixture's expectation was `emits-addon the compiled function requires 1
argument`. The old compiler emitted `requires 1 arguments` -- the plural was
unconditional -- and **"requires 1 arguments" contains "requires 1 argument"**.
The guard would have passed against the exact binary it was written to catch.

Caught by running it against that binary, which is the only thing that would
have: reading it, the expectation looks precise, and the singular is even the
detail the fix introduced. The expectation now carries the closing quote,
`requires 1 argument");`, and the old output scores zero against it.

That is the fourth fixture in two days whose control had to be found by
execution rather than by inspection, and the first where the flaw was in the
*guard* rather than in the subject. A substring match is a claim about text, and
text has prefixes.

Rewritten after a truncation: this file was cut at exactly 4096 bytes, losing
the last character, while `/tmp` was full. The Node lane lost a whole section
the same way in the same window and found it by the diff stat looking wrong. A
write that fails partway and reports success is the same shape as a check that
cannot go red, one level further out -- so the tell to keep is the **exact page
boundary**, which no prose ends on by accident.

## Amended: the general form is "unconditional", not "prefix"

A second fixture had the same flaw and it was not a prefix.
`rest-element-error-replaces-the-modules-own` expected

    emits-addon could not gather the rest arguments

which is the **fallback message of `nts_napi_check`** -- written into every
addon the emitter produces, whether or not anything reaches it. The defect it
named was fixed and the fixture would have reported `reproduces` for as long as
that helper exists.

So the rule is not about prefixes. **An expectation that names something the
emitter writes unconditionally cannot fail**, and the unconditional thing is
very often an error message: error text is written once, near the top, and
reached rarely. Both of these fixtures named a string that was in the output for
a reason unrelated to the thing under test.

The fix in both cases was to name something *conditional* -- the closing quote
that only the singular produces, and the gatherer's call site carrying the
fixture's own parameter name. Both control at zero against the binary they were
written to catch.
