# Two modifiers, and the name came back as `readonly`

    class A { a = "1"; }                     store emitted
    class B { readonly a = "22"; }           store emitted
    class C { public readonly a = "333"; }   **no store, no diagnostic**

A property declaration with **two or more modifiers** lost its initialiser. The
field kept the zero a fresh allocation has, nothing was reported, and the
program compiled.

## The mechanism is one line of `child_slots`

A declaration's children are read by slot against a `present` bitmask. The
modifiers are **one slot and any number of children**, and the reader took one —
so every slot after them shifted by one, the *name* came back as `readonly`, the
lowering looked up a field of that name, found none, and continued.

`continue` on a name it could not find is right for a member that is not a field.
It is exactly wrong for a field whose name it has misread.

## Why it survived

**One modifier worked and none worked.** Every fixture in the tree used at most
one, and the corpus that uses two is `internal/errors.ts`, which writes

    override readonly code = "ERR_OUT_OF_RANGE";

on ninety-four classes. So **every compiled error reached the host with no
`code`** — and 792 of node's own tests assert one.

It was found from the far end: an error crossing the napi boundary had `code`
undefined and `name` `"ERR_OUT_OF_RANGE"`, node has them the other way round, and
following that back through the wrapper reached a store that was never emitted.

## The boundary half, which was real and was not the cause

`nts_thrown_class` answers with the class's **own** name, so the wrapper's two
comparisons against `RangeError` and `TypeError` missed for every one of node's
error classes; it built a generic error and set `name` to the class. The right
string under the wrong property, and `instanceof RangeError` false.

`nts_napi_error_classes` is now emitted per program: class, the error it descends
from, and the `code` its allocation site assigns.

**From the allocation site, not the constructor.** A class field initialiser is
emitted where the object is allocated — which is where JavaScript runs it — so
`ERR_OUT_OF_RANGE#constructor` has stores for `message` and `name` and none for
`code`. Looking in the constructor found nothing and looked like the bug it was
standing next to.

**And from the assignment, not the class name.** Six of those ninety-four
classes have a `code` that is not their name: `AbortError` is `ABORT_ERR`,
`ConnResetException` is `ECONNRESET`, `ERR_INVALID_ARG_VALUE_RANGE` is
`ERR_INVALID_ARG_VALUE`. The name would have been a wrong value for six classes,
which is what this boundary refuses everywhere else.

## Measured

`os.getPriority` against node, over the twelve inputs
`test-os-process-priority.js` uses plus three more:

    15 of 15 agree — code, name, and instanceof RangeError

None agreed before, on any of the three.

## Two fixtures that each reproduce half

`a-thrown-code-at-the-boundary` writes `code = "ERR_FIXTURE"` with **no
modifiers**, so it only ever reproduced the boundary half — it would have gone
green on that fix alone while every error in the tree still arrived without a
code. Its header says so now.

A fixture that reproduces one half of a defect is worth having and worth
labelling. The label is the part that was missing.
