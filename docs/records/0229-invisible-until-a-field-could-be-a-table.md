# Invisible until a field could be a table

`os.node` segfaulted node during `require`. No output, exit 139, every one of
that module's tests failing as a crashed child rather than an assertion.

    #0  nts_map_set ()
    #1  module.init ()
    #2  napi_register_module_v1 ()

`readConstants()` runs at module init to build `export const constants`, and it
contained **zero** `nts_map_new` calls. The write went through whatever
`out->dlopen` happened to hold.

## The cause was one missing match arm, and it predates the crash by months

`contextual_type` had no arm for `PROPERTY_ASSIGNMENT`. An object literal's
property value never saw the *field's* declared type, so

    const out: OsConstants = { signals: {}, errno: {}, priority: {}, dlopen: {} };

gave each inner `{}` its own type -- an anonymous object with no members -- and
each became an `NtsObj_Type9` stored into an `NtsMap *` slot.

**That gap had been harmless for every object-typed field there has ever been.**
An empty layout stored into a slot expecting a layout is the same pointer, and
the fields' offsets come from the *declared* type either way. A `Record` is the
first field type where the two representations differ, so the commit that made
tables representable is the commit that made a months-old omission reachable.

A latent defect that becomes reachable only in the change that needs it is not
something a fixture written before that change could have held.

## The example was thorough along the wrong axis

`examples/string-keyed-table` had nineteen functions and 551 cases at the time:
three spellings of an index signature, a literal with entries, an absent key, a
computed key, overwriting, sixty-four keys past any linear scan, string values,
`Object.keys`, spread in three forms, a table through a parameter, a table
through a return.

**Every single table was bound to a name.** Not one was a field of an object
literal, which is the shape `os.constants` has four of.

That is the most convincing form of a gap: exhaustive along the axis it was
written on, and silent about the one that mattered. It is the same shape as
`object-return-carries-scalar-fields-only` having no class in it, and as `0221`'s
fixture whose control suppressed its own subject -- but this one is worse,
because the coverage was real. Nineteen functions is not a thin corpus.

Four cases now: a table field written `{}`, one written with entries, one
reached through a function's return -- `readConstants`'s exact shape -- and an
object with *two* table fields, so a shared allocation would show up as one
answering for the other. 667 cases, all agreeing with node. Controlled on the
previous binary: **18 spurious object layouts before, 0 after.**

## The same arm closed a blocker nobody was aiming at

`null-in-a-union-of-references`: `return { held: flag !== 0 ? new Holder(f) : null }`
refused while the `const`-bound form lowered. Same cause -- a conditional's
`Holder | null` had nothing to be represented *as*, while the bound form got its
type from the `const`'s declaration, which `contextual_type` did handle.

That fixture's analysis was right and its diagnosis one step short. It said "it
is where the value is *formed*", which is true; what it could not see is that a
formed value had no type because nothing told it what the field wanted. Its
second control -- written expecting it to lower, and refusing -- is what located
the boundary at all.

It was `os`'s last own-source root.

## What neither lane was measuring

The gate ran: 667 differential cases, 99 fixtures, eighteen steps, green. The
Node lane read refusal counts and `napi_set_named_property` greps. The build
floor said "22 of 22 still build" throughout, and it was true.

**Nothing loaded the artifact.** The gate does not build addons; the sweep
builds them and was reading counts out of them. Two thorough instruments pointed
at emitted text, and a crash sat in the gap between them for an hour.

`tooling/conformance/loads.sh` is one `require()` per built addon, reporting a
crash with its signal because exit 139 and a failed assertion are different
findings. It is validated in both directions on `os` -- the pre-fix build
reports `CRASHED on require, signal 11`, the fixed one reports `loads, 17
name(s) published` -- so it has a demonstrated failure rather than a claim.

It belongs in the gate after the build floor, which is where it is going.
