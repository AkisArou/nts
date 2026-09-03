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

  **This reason is retired: see 0059.** We do not allocate either — a substring
  that does not escape is written into frame storage, and that was already true
  when this was written. The copy is real and costs about 13%; the rest of the
  row is that the `memcpy` sits inside the scan loop and stops clang unrolling
  it, which it does four ways for the C++. Two other plausible causes, the
  allocation and `nts_unit`'s per-character width test, were measured and are
  worth nothing.

- **`awfy-bounce` 1.56x.** The reference stores its balls *by value*:

      std::array<Ball, ball_count> balls = {};      // C++
      const balls: Ball[] = new Array(ballCount);   // ours, references

  A `Ball[]` is an array of references, so the hot loop loads a pointer per ball
  before it can load a field — `mov (%rcx,%rsi,8),%rdi` is 1.5% of the row on
  its own and the field loads hang off it. IPC is 3.55 against the C++'s 5.22,
  which is the shape of a loop chasing pointers against one walking an array.

  **Not proven to be the whole gap.** The harness is time-budgeted, so the two
  binaries run different iteration counts and their instruction totals do not
  compare; IPC does, and the sources do, and that is what this rests on. Storing
  objects inline in an array is a real change — it needs the elements to be
  provably unaliased and their identity never observed — and it is the same
  class of thing as 0059's view, on the same axis as 0038.

- **`awfy-permute` 1.29x and `awfy-queens` 1.36x.** Both store `double[]` where
  the reference stores `int32_t*` — `permute` has four such arrays and `queens`
  two, beside six `bool[]` that already match. Twice the bytes moved per
  element, for values that are all small integers.

  `hir::elements` exists to narrow exactly this and does not fire. Its two
  documented refusals — an element type read into floating point, and one whose
  array reaches any runtime helper — are both plausible here, since
  `new Array(n).fill(0)` is a helper call and a `number` read is a double. But
  narrowing also declines on a local array with no `fill` and with every read
  coerced by `| 0`, so **which filter declines is not established** and the two
  obvious answers are not sufficient.

  Worth noting that `reaches_a_runtime_helper` carries the claim "nothing in the
  benchmark suite pays for the crudeness: an array used through helpers is one
  whose loop is inside the runtime". These two rows use `fill` at construction
  and then loop in TypeScript, so if that filter is the one declining, the claim
  is false and these are what pays.

  There is a second thing in that row, unmeasured. Object fields start at
  `sizeof(NtsHeader)`, which is 24, and 24 mod 16 is 8 — so a pair of adjacent
  `double` fields read together straddles a boundary exactly as an array's
  elements did before 0064. `awfy-bounce`'s profile puts 8.76% on
  `movupd 0x18(%rdi),%xmm6` and 2.05% on the matching store, which is ~11% of
  the row sitting on unaligned pair access.

  Starting fields at 32 was tried and the `_Static_assert`s caught it at once:
  the struct *declaration* is emitted from a different path than the offsets, so
  the two disagreed. Making them agree needs explicit padding in the declaration
  *and* `_Alignas(16)`, since C aligns a struct only to its widest member. Not
  built, because the expected win is much smaller than 0064's: `elementwise`
  streams 4096 doubles and is memory-bound, where `awfy-bounce` works on a
  hundred balls that fit in L1 and straddling inside L1 is cheap. A few percent
  on 1.60x, against eight bytes on every object in every program.

- **`awfy-towers` 1.31x.** Not inlined, where the C++ is. `Towers__moveTopDisk`
  is 35.7% of the row and `Towers__moveDisks` 20.8%, and inside the first one
  `pop %rax` and `ret` are about **40%** — a tiny function called constantly,
  paying its prologue and return every time. C++ runs 980 instructions to our
  1686.

  `hir::inline` is deliberately not an inliner: 0027 measured a general one and
  deleted it, because the facts here are whole-function and all-or-nothing, so
  copying small bodies made the analysis strictly worse. The C compiler is meant
  to do this instead, and it declines — because the method carries **external
  linkage**. The emitter already writes `static` for anything not exported; the
  method is exported because its *class* is, even though the whole program is
  compiled together and only `work` is an entry point.

  Narrowing linkage to the actual roots was tried and is a bigger change than it
  looks: it turns `Benchmark__benchmark` into an unused `static`, which is
  `-Wunused-function` and an error here. External linkage had been hiding dead
  code that `reachable::prune` keeps — it is reachable through a vtable slot
  nothing calls. So this is a pruning change with a linkage change on top, and
  `dispatch` and `objects` did not move under it.

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
