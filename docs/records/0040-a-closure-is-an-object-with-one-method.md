# 0040 — A closure is an object with one method

The queue's eighth primitive. Like array and object before it, all three
ratchets were already standing, so this is the measurement that closes it rather
than the assumption.

## Representation

A closure shares the object arm of `representation_of`, and that is not a trick
to make it fit: a closure *is* captured state plus code, which is what an object
is. Saying so means it gets the object machinery — a base-first layout, escape
analysis that keeps it in the frame when it does not escape, reference counting,
and dispatch — rather than a second mechanism that would need all four again.

The layout for the function *type* has no fields. What varies between two
closures of one type is what they captured, and that belongs to the closure's
own class, which has the function type as its base.

A declared signature is not a synthetic closure id, and `typeof` had to be
taught the difference: a value of declared signature type keeps its TypeScript
function type and answered `"object"` for one commit.

## Operations

Rest parameters are the gap, and they are three gaps wearing one name:

    a rest parameter that is not an array                    48
    a rest parameter of unrepresentable type                 37
    a rest parameter whose element type has no representation 18

Measured shape by shape, rather than inferred from the counts:

    function f(...xs: number[])          works
    function f(...xs: string[])          works
    function f(...xs: [number, number])  works -- a homogeneous tuple *is* an array
    function f(...xs: [number, string])  refused: "not an array"
    f(tag, ...xs)                        refused: "a spread element"

`gather_rest` builds the trailing arguments into the array the callee declared,
which needs the parameter to *have* an array representation. A homogeneous tuple
has one — `[number, number]` is two doubles in a row, which is what `number[]`
is — and a heterogeneous one is a struct with positional fields, so there is no
element type to build with.

The call-site spread is the other half and belongs to the `✗ spread` row the
conformance table already carries: `[...a]` and `{...o}` are the same missing
thing seen from two places.

## The three ratchets

**correctness** — six examples, all agreeing with node: `closures`, `callbacks`,
`function-values`, `captured-by-reference`, `rest-parameters`, `signatures`.

**memory** — three cases at both floors, and the interesting one is the zero.
`closure-capture` is at **0 operations and 0 allocations**: a closure that does
not escape is a frame object, and a frame object has no count to change.
`param-returned` is 0/0 for the reason its name gives — returning a parameter
hands the caller something it already holds, which is not an escape, and saying
otherwise once sent all thirty-four of its allocations to the heap.
`borrowed-call` is 33/33, which is the shape that genuinely has to count.

**speed** — three rows, every one ahead of node, two at C++ parity:

    closures     1.13 us   C++ 1.11 us   node  2.93 us   1.02x C++   0.39x node
    dispatch    27.87 us   C++ 27.83 us  node 40.04 us   1.00x C++   0.70x node
    pipeline    27.90 us   C++ 28.67 us  node 117.01 us  0.97x C++   0.24x node

`pipeline` is *faster than the hand-written C++*, and `closures` is 2.6x node
against a `nts f64` column of 29.38us — the gap between those two is what
proving a `number` integral is worth on this shape, and it is 26x.
