# Neither the type nor the shape said what it was

    os.getPriority(null)    ours returned 0        node throws ERR_INVALID_ARG_TYPE
    setPriority(1, "y")     6.9231110677068e-310   node throws ERR_INVALID_ARG_TYPE

Two faces of one defect. An optional parameter whose body observes the absence
crosses as an **erased** value, and `nts_from_napi_value` accepts every
JavaScript value — so the wrapper let a string through and `unerase` read its
pointer as a double, and it let `null` through and the module's validator saw a
number nobody supplied.

`6.9e-310` is a pointer. That is worth saying because it was diagnosed twice as
an uninitialised local, once by each of us, and the emitted C settles it: the
slot is initialised to `nts_value_of_undefined()` and then overwritten with a
string.

## What was missing was the type, and nothing had it

`hir::Param` carries `ty` — which is `Erased`, correctly, because `undefined` is
a tag and not a zero — and `shape`, which says the parameter is optional. Neither
says what the optional half *was*.

`Program::optional_scalars` records it: function, index, and the one scalar the
declaration admits. A side table rather than a field on `Param`, for the reason
`opaque_signatures` is one — nothing but the wrapper reads it, and twenty
construction sites do not have to learn a field they will not use.

**Scalars only, and a union of two plus `undefined` is left alone.** The check
has one type to name in its message, and naming the wrong one would be worse
than the generic text it replaces.

## Measured against the test that found it

`test-os-process-priority.js` uses twelve inputs. Against node:

    null true false 'foo' {} [] /x/     all agreed after, none before
    NaN Infinity -Infinity 3.14 2**32   still differ

The five that remain are a different defect and the distinction is worth
keeping: the module's own `validateInt32` now runs and throws
`ERR_OUT_OF_RANGE`, and the error reaches the host **with no `code`**. That is
the class-field crossing on a provided error class, not this.

So the boundary stopped answering for the module on the type check, and the
module's answer is now the one that arrives — carrying everything except the
property that names it.

## The shape of the two diagnoses

The Node lane read it as an uninitialised local and I read it as an erased
mis-read; the truth was the erasure, and both of us had a story that predicted
the same garbage double. Neither was checkable from the outside — the emitted C
was, and it took two lines of it.

**A number that could have come from either of two mechanisms is not evidence
for the one you thought of first.**
