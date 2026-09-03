# 0049 — Where the remaining gaps are

One row loses to node. Four lose to bun. Nine are above 1.00x C++. This is what
each of those is, measured rather than assumed, so that the next person to look
at the board knows which numbers are work and which are statements.

## The one row that loses to node

`awfy-mandelbrot`, at 1.02x. `perf stat`, normalized per operation:

    nts   3,188,255,544 instructions   2,980,870,539 cycles   IPC 1.07
    C++   3,186,910,878 instructions   2,981,956,956 cycles   IPC 1.07

We match hand-written C++ to four significant figures. The inner loop is a
serial floating-point dependency chain — `zi` to `zizi` to `zr` to `zi` — and
at IPC 1.07 it is latency-bound with throughput to spare, which is why
specializing its counter to `int32` (a real improvement, and it landed) moved
the row not at all: two integer instructions replacing two floating-point ones
in a loop that is waiting 24 cycles for a multiply changes nothing.

Beating node here means shortening that chain. `(zrzr - zizi) + cr` reassociated
to `(zrzr + cr) - zizi` would take it from 24 cycles to 20, and floating-point
addition is not associative, so neither we nor clang may do it. node's 2.5% is
something V8 does that a correct static compiler does not.

## The four that lose to bun

`dispatch` 2.02x, `erasure-typed` and `erasure-unknown` 1.53x, `objects` 1.08x.

On every one of them **bun also beats C++** — `dispatch` by 2.0x, the `erasure`
pair by 1.5x, `objects` by 1.07x. These are not places where our code generation
is behind; they are places where JSC's JIT beats static compilation on a
specific shape, and the C++ column says so independently of us.

`dispatch` is the interesting one and has a diagnosis. Our C backend does it in
22.1us and our LLVM backend in 27.6us for the same HIR, with the same branch
misses and negligible cache misses, at IPC 2.70 against 2.13. The LLVM build's
`bench_run` is 248 instructions against 205, with 17 stores against 9 — worse
register allocation on our IR — and `idq_uops_not_delivered` is 45% higher per
instruction. It is a front-end problem caused by a bigger function.

`__attribute__((noinline))` on `nts_array_allocate` fixes it: 27.6us to 21.4us,
which is 0.77x C++ and 1.57x bun. It also takes `array-methods` from 0.49x C++
to 1.16x, which is more than twice as bad. Net negative, not shipped, and
recorded here because the next person to profile `dispatch` will find the same
thing and should know the other end of it.

## The nine above C++, and what they are

Three of the worst are the benchmark stating a representation cost, and each
reference says so in its own comment:

- **`substrings` 1.83x.** The reference is `std::string_view::substr`, which
  returns another view of the same characters and allocates nothing. Its header
  says "the C++ column here is not a target so much as a statement of what a
  representation that can alias its input costs — which is nothing — against
  one that must copy". We are 0.48x node and 0.14x bun on the same row.

- **`fib` 1.70x.** The reference is `std::int64_t`. Ours is a `double`, and it
  has to be: `fib`'s return cannot be narrowed because the fixpoint over a
  recursive exponential does not converge to a bound, and `n` is only known to
  be a whole number. C++ computes with a type that wraps; we compute with one
  that cannot. At n=27 they agree, which is why the checksum passes.

- **`awfy-bounce` 1.57x.** The reference is Are We Fast Yet's own C++ port, and
  its header records that it uses `std::array` on the stack where the JavaScript
  allocates. So its balls are contiguous and inline and ours are an array of
  pointers. We execute **19% fewer instructions** than it does and are slower
  anyway, at IPC 3.59 against 5.17 — which is what pointer-chasing costs.

## The lever that keeps working

Nine of tonight's wins were one attribute. `always_inline` on a runtime function
whose body is smaller than the call to it:

    nts_map_find      map-and-set   7.83 -> 6.85us
    nts_str_append    node-utf8    35.70 -> 30.19us
    nts_array_push    array-pred    3.73 -> 2.19us
    nts_number_to_string_into  number-format  961 -> 729ns
    nts_map_get/has/set/add    map-and-set   6.82 -> 5.35us

The pattern is that these are *runtime* functions called from *generated* code
across a translation unit, so nothing but LTO could have inlined them, and LTO's
heuristics do not know that a hash lookup is twenty instructions.

It is not a rule to apply everywhere. `nts_release` measured nothing, twice.
`nts_array_push_ref` has no benchmark that reaches it and is not marked.
`nts_array_reserve` marked `noinline` — to keep the inlined `push` small, which
is the textbook move — made its row *worse* than not inlining at all.
