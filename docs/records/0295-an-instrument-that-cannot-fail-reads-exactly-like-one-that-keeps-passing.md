# 0295 — An instrument that cannot fail reads exactly like one that keeps passing

Four times in five days, in two lanes, a check reported success for a reason
that had nothing to do with what it was checking. None of them failed. None of
them was noticed by reading the output, because the output was the output of a
check that passes.

## The ratchet that dexed a skeleton two hundred times

`tooling/android/dexes.sh` exists to catch a class file that the JVM loads and
`d8` refuses. It compiles every example and every bench case through
`emit-jvm`, dexes the result, and fails if `d8` refuses one. It printed
`0 refused` on every run for a fortnight.

It was dexing almost nothing. `emit_options` decided between a library and an
executable with `!entry.is_empty()`, and `named_entry()` returns
`vec![MODULE_INIT]` when nothing is named — module evaluation is a root in the
same sense a named entry is — so the test **was never false**. Every
`emit-jvm` without `--main` compiled as an executable rooted at module
evaluation, and an exported function nothing calls internally was pruned before
the backend saw it:

    case              as shipped    under the bug
    fib                        6                4     members of nts.gen.Program
    node-utf8                 11                4

`nts.gen.Program` came out with the same four members for every case in the
corpus. The ratchet was measuring a skeleton and reporting that the skeleton
dexes, which it does.

What makes this the characteristic failure rather than an ordinary bug: **the
step could not have failed.** There was no input in the corpus that would have
made it red, so its greenness carried no information, and greenness is the only
thing anybody reads.

## The guard that was being carried by a caller's answer

`laid_out_as_a_prefix` opens by answering `true` for closures and signatures
*before* calling `layout_of`, and the comment says why: `layout_of` is not a
query, it **creates** a layout for a type that has none. For a signature that is
a fieldless `Fn__174`, and materialising one changed the emitted program —
assignments that had been writing a closure into a slot of its own type started
writing it into a distinct struct, and clang said

    incompatible pointer types assigning to 'NtsObj_Fn__174 *'
    from 'NtsObj_Closure356 *'

in **six modules**.

That opening test is a guard, and for a while it was also, incidentally, the
only place a different pass got the same fact. The specialisation pass called
`laid_out_as_a_prefix` for its own reasons and inherited "a closure or a
signature is not a field-layout question" as a side effect of the answer. The
moment it stopped calling it, `blockers/callback-binding` regressed and a
`declare function`'s prototype stopped being
`void nts_take_callback(NtsHeader *)`.

It happened a second time three hours later. Specialising prefixes removed the
accidental carrying again, and the same blocker went the same way.

**A guard inherited from a call whose answer happened to include it is not a
guard.** It is a coincidence with the same shape, and it holds until somebody
does the obviously correct thing of not making a call they do not need.

## Why these are one defect

In all four the failing branch was unreachable. A ratchet with no input that
refuses, a guard with no caller that skips it — both are checks whose negative
outcome cannot occur, and a check whose negative outcome cannot occur is
indistinguishable, from the outside, from one that keeps being satisfied. Both
also *degrade quietly*: the ratchet went hollow when an unrelated CLI flag
changed meaning, and the guard went hollow when a second pass was written
correctly.

The two cases were found by opposite routes and neither was found by looking at
the check. The ratchet was found by asking what the artefact contained rather
than whether the step passed. The guard was found by a blocker fixture
regressing three hours after the change that hollowed it.

## What to do instead

- **A ratchet needs an input it must reject, run in the same step.** This
  repository already has the pattern: `runtime_sabotage.rs` breaks the C runtime
  on purpose and asserts the suites go red, and its own comment says "without it
  a suite can be green because it is not looking". Every new ratchet owes the
  same thing. `dexes.sh`'s two motivating defects were both found by asking the
  *rule* — `dex_can_spell` over every mangled ASCII name, and the duplicate-field
  refusal — from four-line programs no corpus contains, which is the same
  observation from the other end: a sweep tells you about the sweep.
- **A precondition gets its own copy of the test at every site that needs it.**
  Not a reference to where it is written down, and never a call made for another
  purpose whose answer happens to include it. The specialisation pass now carries
  its own copy, which is duplication and is correct: the two sites need the fact
  for different reasons and will stop agreeing about who calls whom.
- **Ask what would make this red**, before trusting a green. If the answer is
  "nothing in the corpus", the step is documentation.

## The sibling: a check that failed and was ignored

The two above are checks whose negative outcome could not occur. The compiler
lane found the mirror of that the same night, and it belongs here because the
remedy is the same sentence read from the other end.

`coerce_to_slot` ended in

    self.coerce(value, &want, id).unwrap_or(value)

and `coerce` answers `Err` for a structural cast whose layout is not a prefix.
Swallowing that wrote the **uncoerced** value into the slot, and the emitted C
died with signal 11. The identical cast into a *parameter* had been refused by
name for as long as both paths existed, because `coerce_to_parameter` propagates
what this one dropped -- so the compiler knew, said so on one path, and was
silent on the other. Eight call sites made fallible; nothing regressed.

**`unwrap_or` on a `Result` whose `Err` is a refusal reads as a default and is a
decision to emit something the compiler has just said it cannot represent.** The
check ran, answered correctly, and had its answer thrown away -- which is the same
outcome as a check that cannot fail, reached by the opposite route.

So the pair is worth holding together: one check could not go red, the other went
red into a `unwrap_or`. Neither was visible in the output of the thing it
guarded, and both were found by something downstream breaking rather than by
reading the guard.

## The adjacent failure that is not this one

Worth separating, because it was tempting to file together. A probe timing two
closure shapes in one JVM reported a trampoline as **three times faster than the
code it wraps**. That check could fail and did not — it measured the wrong
variable, because the shared driver had gone megamorphic between the two shapes
and it was comparing inline-cache states. Its tell is an impossible *result*; the
tell for the two above is no result at all, ever. The remedies differ: one wants
a sabotage input, the other wants one process per shape.
