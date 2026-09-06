# Forty-seven statics were the premise `nts_retain` had been asserting

    /* Not atomic. A runtime owns its heap (RFC 17.1) and a managed reference does
     * not cross between runtimes, so the count is only ever touched by one thread.
     * Making it atomic would cost every retain a locked instruction to defend
     * against sharing the design does not permit. */

That comment was true and nothing enforced it. The heap it describes was
forty-seven file-scope mutable statics, which is not a heap a runtime *owns* —
it is one every runtime shares by having no alternative. The environment seam
makes the premise structural: two environments are two heaps, and there is no
longer a shared word for them to race over.

Thirty-two of the forty-seven were mutable and became fields of one
`NtsEnvironment`. The rest are `const` descriptor tables, which are the same on
every lane and stay where they are — the contract permits immutable
process-wide tables precisely because copying one per environment buys nothing.

## The field order is measured, and three of my measurements were wrong first

The hot question was whether reaching state through a pointer costs anything on
the reference-counting path. `nts_release` reads four of these on every call.

A microbenchmark answered it three times before it answered it correctly:

    v1  the scattered loop was file-local and unobserved, so clang deleted it
        and reported 0.000s against two surviving pointer versions
    v2  padded the statics 4096 bytes apart — three pages, where `nm` says the
        real ones sit at 0xb0, 0xe0, 0xf0 and 0x118: three cache lines
    v3  modelled that span as casts into a `char` array, which makes every read
        may-alias the counter store and forces reloads the typed statics never
        suffer

Each version produced a confident number and each number was about a handicap I
had built. The fourth used separately declared typed globals at the measured
offsets:

    real layout, typed globals   0.62s
    packed struct via global     0.212s
    packed struct via TLS        0.215s

500M iterations of the release predicate, noinline body. The gain is locality
plus the adjacent `draining`/`collecting` pair folding into one compare, and it
justifies **the field order and nothing else** — it is a microbenchmark of a
predicate, not of a program.

What it did settle is the mechanism: **`_Thread_local` costs nothing over a
plain global pointer**, 0.215s against 0.212s, inside run-to-run noise. So the
contract's "an owner thread cannot retain a closed environment" is free on this
lane. The JVM went the other way — a hidden trailing parameter on generated
methods — because `ThreadLocal.get()` there is a hash lookup where `%fs:` is
one instruction. The contract left the mechanism provider-owned expecting
exactly that asymmetry, and now there are numbers on one side of it.

## Aggregation on read is what kept the harness working

The counters answer a process-wide question and stopped being process-wide, so
every accessor became a sum over a registry:

    static size_t nts_total(size_t offset) {
      size_t total = 0;
      for (const NtsEnvironment *e = nts_environments; e; e = e->next) {
        total += *(const size_t *)((const unsigned char *)e + offset);
      }
      return total;
    }

The eight counter-reading suites, the 61 memory cases and the differential leak
check passed unchanged: *nothing leaked, no answer changed, every case at both
floors*. That is also the argument against making anything atomic — the cost
lands once, on whoever asks, rather than on every retain by everyone who does
not.

`nts_counting_reset` resets every environment for the same reason. A window
cleared in one environment while another keeps counting produces a total that
is wrong by however much the second had already done, and nothing would say so.

## A green compile is a claim about the configuration you compiled

The first build passed and the test suites did not. `NTS_CLASS_STEP` was
defined two hundred lines below the struct whose field needed it — invisible
under the NoGC provider, which is the one configuration my `cc` line happened
to select, and fatal under reference counting, which is what the suites use.
Three provider configurations exist in that file. The fix moved the recycling
decision above the environment; the lesson is that I had verified one third of
what I believed I had verified.

## What is not here

No example. The seam has no TypeScript-visible surface — compiled code never
names an environment, on either lane — so there is nothing for the differential
to compare and an example would be scaffolding. The coverage is
`runtime/c/tests/environments.c`, whose checks are deliberately taken from
*outside* the environment that allocated: a `nts_total` returning only the
current environment's counter passes every check written from the inside.
