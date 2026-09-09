# The boundary said what it could not do

    os.setPriority("z", 1)

    was    expected a number argument
    now    The "pid" argument must be of type number. Received type string
    node   The "pid" argument must be of type number. Received type string ('z')

The code was already `ERR_INVALID_ARG_TYPE` and the class already `TypeError`.
What the message named was the wrapper's own conversion rather than the argument
that failed it.

## Why the boundary is answering at all

`os.setPriority(pid: number, priority: number)` — so the wrapper reads a double,
and `napi_get_value_double` fails on a string before the compiled function is
entered. The module's `validateInt32` never runs, and it is the one that knows
the parameter's name.

That is not something to route around: there is no double to hand the compiled
function, so the boundary must reject. **The boundary is standing in for a guard
the declaration deleted**, and a stand-in has to say what the original would
have said.

`nts_napi_rest_type_error` already made exactly this repair for a *gathered*
parameter, with that sentence in its own comment. A scalar parameter is much the
commoner shape and had been left with the generic text.

## What is deliberately still missing

Node appends the value: `Received type string ('z')`. This does not, and the
rest form does not either. Rendering an arbitrary JavaScript value is
`util.inspect`'s job; a wrong rendering would be worse than an absent one, and
the two forms should not disagree about it.

## The half this did not fix, which is a different defect

    os.setPriority(1, "y")
    ours   The value of "priority" is out of range. It must be an integer.
           Received 6.9231110677068e-310
    node   The "priority" argument must be of type number. Received type string ('y')

That parameter is declared `unknown`, so it crosses erased and the module's own
validator runs — which is the arrangement working. The validator then reads a
string's pointer as a double, so its `typeof` test did not fire on an erased
value that is a string.

`6.9231110677068e-310` is a pointer. It is a wrong value rather than a wrong
message, and it belongs to the erased-narrowing family rather than to this
record — named here because the two arrive from one call and would otherwise
look like one bug.
