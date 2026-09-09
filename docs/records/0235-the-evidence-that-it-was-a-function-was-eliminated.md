# The evidence that it was a function was eliminated

An object field whose type is another object now crosses outward. `os.cpus()`
returns all 32 entries with `times` nested inside each, key order and values
matching node's; `path.parse` agrees with node on every case tried, key order
included, and that form was 26 of the 54 remaining divergences in `path`'s edge
table.

The change is four lines of recursion. Everything below is what it took to stop
it also shipping a wrong value.

## What one level was, and why the wall was in a strange place

`cross` admitted an object whose fields were all scalars, strings or tables, and
refused one holding another object. The comment said the missing piece was
"recursive object construction", which sounds like the *emitter* lacked
something. It did not: `emit_object_helper` already called itself, once per
element, for an array of objects. A field is the same call without the loop.

What was actually missing was the admission test, and then two things nobody had
had to think about because nothing nested:

**A cycle guard.** A layout that reaches itself has no finite object to build.
It is refused by the *chain* currently being walked and not by a visited set,
because a layout reached twice down two different fields is fine and has to keep
crossing. `self-referential-object-return` is the fixture; without it the guard
is a line nobody has seen do anything, and deleting it hangs the compiler on that
input rather than failing the suite.

**Emission order.** C reads forwards; this graph does not. A struct whose field
points at a layout declared later needs the typedef first, and a helper that
calls a later helper needs its prototype. Emitting each layout complete before
the next worked only while nothing nested. Three passes now: typedefs, bodies,
prototypes, definitions.

And the list of layouts to emit has to be closed over what those layouts *reach*.
It was not, at first, and the result is the most instructive artifact of the day:
`cpus` published, its helper called `nts_to_napi_obj_CpuTimes`, and the addon
declared neither that function nor its struct. **Text that names what it never
defines reads as success to every guard that greps.** `addon-compiles`, written
this morning for a different reason, is what caught it.

## The wrong value, which publishing looked exactly like

Two blockers reported FIXED by the recursion. One of them was not.

    export const ucs2 = { decode, encode };

`ucs2` began publishing, and `ucs2.decode` was `{}` -- an empty JavaScript object
where a function belongs. It is the wrong-value failure the boundary refuses
everywhere else, arriving disguised as a new export, and every instrument said
progress: the name published, the addon compiled, the fixture flipped from
reproducing to fixed.

The rule that should have caught it was already written. A declared function type
gets an ordinary layout with a `Fn2__2#call`, and `class_names` -- the boundary's
way of refusing a value that is more than its fields -- is built from the `#` in
exactly that name. It is precisely right about this case.

**Nothing calls `Fn2__2#call`, so it is dead-code eliminated before the wrapper
runs.** `class_names` over the prepared program has never heard of it. The only
evidence that the layout was callable is a function that no longer exists.

    nts hir            func Fn2__2#call(this: managed<obj#1>, ...)
    nts hir --prepared export func module#init() -> void

That is worth stating as its own fact, because it is not about functions:
**a predicate computed from the program can be right about a property and blind
to it, if the thing it reads is something an optimisation is entitled to
remove.** `class_names` is not wrong. It is downstream of elimination, and the
property it infers belongs to the *type*, which elimination does not touch.

Refused conservatively for now: **a layout with no fields cannot cross.** A
genuinely empty object would cross as `{}` correctly and is refused too, and that
is the trade taken deliberately -- losing `{}` is not a loss, and shipping a
callable as a plain object is. The precise rule wants a `Layout` that says
whether its type is callable, which survives elimination because it is a property
of the type rather than of a body. That is a `compiler/core` change every backend
reads, so it is coordinated rather than taken here.

## Two sites where a guard was passed an empty set

Chasing the above found a second thing, real and separate. `value_exports` and
`namespace_value` called `cross` with `&FxHashSet::default()` where every other
caller passes `class_names(program)`. With the set empty the class rule is simply
off. It had never mattered, because an object value export could not publish at
all until this morning; it started mattering the same hour.

That is the second time today a guard was disabled rather than wrong -- the first
was a test enumerating twelve of thirteen variants by hand. A guard that is not
*reached* fails silently in the direction of approval, and neither of these was
visible from its own result.

## What is still refused, and where

    path.format   takes an object          inbound; nothing object-shaped
                                           crosses inward at all
    timers.peek   returns an object        a cycle, and correctly refused

`format` is the whole inbound direction and not this wall. The Node lane
established that separately and it is worth quoting for anyone reading this
record and assuming symmetry: outward there are three conversions and a
descriptor and the question is which to read; inward there is no representation
being built at all.

`timers.peek` is the better of the two, because it is the cycle guard firing on
code somebody wrote for reasons that had nothing to do with this:

    export interface ListNode {
      _idleNext: ListNode | null;
      _idlePrev: ListNode | null;
    }

    struct NtsObj_ListNode {
        NtsHeader header;
        NtsObj_ListNode * _idleNext_;
        NtsObj_ListNode * _idlePrev_;
    };

and `init` does `list._idleNext = list` -- a real cycle at run time, not only in
the type. `peek` returns one, and there is no finite JavaScript object to hand
back. The guard was written against `self-referential-object-return`, a fixture
invented to exercise it; finding that it was already load-bearing on a module in
the tree is the part that makes it more than a line of defensive code.
