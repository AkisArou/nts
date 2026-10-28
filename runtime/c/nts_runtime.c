/* The Native TypeScript C runtime: the half that allocates or is too large to
 * inline. See nts_runtime.h for why this is a translation unit rather than text
 * pasted into every generated file.
 *
 * The system headers a runtime needs -- <stdio.h>, <stdlib.h>, <string.h> --
 * are confined here. That is the point: a generated file no longer picks up the
 * hundreds of names they declare, so a TypeScript `function div()` no longer
 * collides with C's.
 */

/* Before any system header, which is what a feature-test macro requires: the
 * stack-overflow handler's `sigaction` and `getrlimit` are POSIX, which strict
 * ISO C does not declare, and the differential compiles with `-std=c11`. */
#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif
/* XSI on top: the stack-overflow handler's `sigaltstack` and `SA_ONSTACK`
 * are not in the POSIX base. */
#ifndef _XOPEN_SOURCE
#define _XOPEN_SOURCE 700
#endif

#include "nts_runtime.h"

#if !defined(_WIN32)
#include <signal.h>
#include <sys/resource.h>
#include <unistd.h>
#endif

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
/* The JSON escape kernel's vectors (`nts_json_scan_narrow`). */
#if defined(__AVX2__) || defined(__SSE2__)
#include <immintrin.h>
#endif

void nts_hresult_clear(int32_t status, void *slot, size_t size) {
  if (status < 0) {
    memset(slot, 0, size);
  }
}

/* Vendored code is held to upstream's warning standard, not ours, and the
 * pragmas are pushed and popped around it so that everything below is still
 * compiled with all of them on. `runtime_checkpoint` builds with `-Werror
 * -Wunused-parameter`, which upstream code need not pass. */
#if defined(__clang__) || defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-parameter"
#pragma GCC diagnostic ignored "-Wsign-compare"
#pragma GCC diagnostic ignored "-Wunused-function"
#pragma GCC diagnostic ignored "-Wunused-but-set-variable"
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"
#pragma GCC diagnostic ignored "-Wimplicit-fallthrough"
#pragma GCC diagnostic ignored "-Wconversion"
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wcast-qual"
#pragma GCC diagnostic ignored "-Wunused-macros"
#pragma GCC diagnostic ignored "-Wfloat-equal"
#endif
/* **A program built for a CPU it is not running on says so, first.**
 *
 * Native x86-64 code is built for x86-64-v3 by default -- AVX2, BMI2 and FMA:
 * Intel from Haswell (2013), AMD from Zen (2017) -- the user's decision of
 * 2026-10-22, worth 1.15-3x on six benchmark rows. On an older CPU the first
 * AVX2 instruction would be a SIGILL somewhere arbitrary. This runs before
 * anything else the program does (the earliest constructor priority), is
 * itself compiled for the baseline (`target("arch=x86-64")`), and turns that
 * crash into a sentence naming the fix. A target built with
 * `cpu: "baseline"` defines no `__AVX2__`, and carries none of this. */
#if defined(__x86_64__) && defined(__AVX2__)
__attribute__((constructor(101), target("arch=x86-64"))) static void
nts_require_the_cpu_it_was_built_for(void) {
  __builtin_cpu_init();
  if (__builtin_cpu_supports("avx2") && __builtin_cpu_supports("bmi2") &&
      __builtin_cpu_supports("fma")) {
    return;
  }
  fputs("nts: this program was built for x86-64-v3 (AVX2, BMI2 and FMA: Intel "
        "Haswell and AMD Zen onwards), and this CPU lacks it.\n"
        "nts: rebuild it with `cpu: \"baseline\"` on its target in "
        "nts.config.ts to run here.\n",
        stderr);
  _Exit(1);
}
#endif

/* The shortest round-trip digits of a double (`nts_number_digits`): zmij,
 * vendored unedited (`zmij/README.md`). GNU's `asm`, which `-std=c11` does not
 * have, is mapped for its include rather than that tree edited.
 *
 * Included rather than compiled beside, and that is deliberate: several places
 * build a program and each names its `.c` files explicitly. A second
 * translation unit would need all of them to agree; a header-style include
 * needs none of them to change, and the file is emitted into a `zmij/`
 * subdirectory of the output so this path resolves the same whether the
 * runtime is compiled from `runtime/c` or from an emitted directory.
 *
 * clang-tidy flags including a `.c`, and it is right to: it usually means
 * somebody meant the header. Here it is the point, so the check is suppressed
 * at the line with the reason above it rather than turned off. */
#define asm __asm__
/* NOLINTNEXTLINE(bugprone-suspicious-include) */
#include "zmij/zmij.c"
#undef asm
/* Decimal text to the nearest double (`nts_decimal_value`): ffc.h, a C99 port
 * of fast_float, vendored unedited (`ffc/README.md`). Exact -- Eisel-Lemire,
 * with fast_float's own slow path for what that cannot decide -- and blind to
 * the C library's locale, which `strtod` was not. The runtime never changes
 * the rounding mode, so `FFC_ROUNDS_TO_NEAREST` drops the check for it. */
#define FFC_IMPL
#define FFC_ROUNDS_TO_NEAREST
#include "ffc/ffc.h"
#if defined(__clang__) || defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

/* One environment: everything a runtime owns that a second runtime must not
 * see.
 *
 * Until now these were forty-seven file-scope statics, and that was not merely
 * untidy -- it was the reason `nts_retain` could be non-atomic. "A runtime owns
 * its heap and a managed reference does not cross between runtimes" was a
 * premise the code asserted and nothing enforced. Gathering the mutable state
 * into one object a lane points at makes it structural: two environments are
 * two heaps, and there is no longer a shared word for them to race over.
 *
 * The immutable tables stay where they are. A descriptor is the same on every
 * lane and copying it per environment would buy nothing.
 *
 * FIELD ORDER IS MEASURED, NOT COSMETIC. The first nine fields are what
 * `nts_release` and `nts_alloc` touch on every call, and they are placed to
 * share one cache line. As separate statics they sat at 0xb0, 0xe0, 0xf0 and
 * 0x118 -- 104 bytes across three lines. Reproducing both layouts with typed
 * globals and a noinline body, the release predicate ran 0.62s scattered
 * against 0.21s packed over 500M iterations, which is the locality plus the
 * adjacent `draining`/`collecting` pair folding into one compare. That is a
 * microbenchmark of the predicate and not of any program: what it justifies is
 * the field order, not a claim about `nts-bench`, which is measured separately.
 *
 * Reached through a `_Thread_local` pointer. Measured against a plain global
 * pointer at 0.215s against 0.212s -- inside run-to-run noise -- so the thread
 * safety is free and the contract's "an owner thread cannot retain a closed
 * environment" costs nothing to honour. */
/* Whether this build recycles memory itself. Decided here rather than beside
 * the allocator because `NtsEnvironment` has a field that depends on it, and a
 * struct cannot be laid out by a macro defined two hundred lines later.
 *
 * Not under AddressSanitizer. A recycling allocator hands the same address back
 * after a free, which is precisely the pattern the sanitizer exists to catch --
 * so a build made to find use-after-free must get its memory from `malloc` and
 * give it back. The cycle collector's use-after-free was found that way and
 * would have been invisible behind a free list.
 *
 * `NTS_NO_RECYCLE` forces the same, for anyone measuring what the recycling is
 * worth. */
#ifdef NTS_PROVIDER_RC
#if defined(__SANITIZE_ADDRESS__) || defined(NTS_NO_RECYCLE)
#define NTS_RECYCLES 0
#elif defined(__has_feature)
#if __has_feature(address_sanitizer)
#define NTS_RECYCLES 0
#else
#define NTS_RECYCLES 1
#endif
#else
#define NTS_RECYCLES 1
#endif
#else
/* The bump allocator never frees, so there is nothing to recycle. */
#define NTS_RECYCLES 0
#endif

typedef struct NtsQueue {
  NtsTask *items;
  uint32_t head;
  uint32_t len;
  uint32_t capacity;
} NtsQueue;

#if NTS_RECYCLES
#define NTS_CLASS_STEP 16u
#define NTS_CLASSES 65u /* up to 1024 bytes */
#endif

struct NtsEnvironment {
  /* Where an uncaught `throw` lands, innermost first, or null for a program
     whose outer edge is the end of the process. Not on the hot path and first
     only because it is the one field a `throw` reads. See `NtsLanding`. */
  NtsLanding *landing;
  /* A raise recorded by `nts_raise` and not yet taken. See it for why one slot
     is enough and why this is not a `jmp_buf`. */
  int raising;
  NtsValue raised;
  /* How many callback bridges are on the stack below here.
     A `throw` inside a callback has C frames between it and any landing --
     frames belonging to a library that called us and knows nothing about a
     non-local jump. `longjmp` past them skips whatever they hold: a lock, an
     allocation, an iterator half-advanced. So while this is non-zero the throw
     is not delivered outward at all. See `nts_uncaught`. */
  size_t in_callback;
  /* Whether a callback returning to a foreign loop is a checkpoint. Set once,
     before module evaluation; see `nts_checkpoint_after_callbacks`. */
  bool checkpoint_after_callbacks;
  /* Whether one returning returns to that loop, where the host can say, and
     whether a checkpoint is already posted for one that did not; see
     `nts_callbacks_return_to_loop_when`. */
  bool (*returns_to_loop)(void);
  bool checkpoint_posted;
  /* -- one cache line: the reference-counting and allocation hot path -- */
  size_t retains;
  size_t releases;
  size_t roots_len;
  /* Candidates at which the next collection runs: what the last one left
   * alive, or `NTS_COLLECT_THRESHOLD` while that is less. Zero until the
   * first collection, which reads as the constant. */
  size_t collect_at;
  size_t roots_cap;
  NtsHeader **roots;
  size_t candidates;
  /* Which collection is next: advanced as each one ends, so a node rooted at
   * a checkpoint and the trace that follows read the same number (see
   * `nts_collection_epoch`). */
  uint64_t epoch;
  size_t bytes_held;
  bool draining;
  bool collecting;
  /* The call region allocations come from, or null for the heap. Read by
   * every `nts_alloc`, so it sits with what that reads. See `NtsRegion`. */
  NtsRegion *region;

  /* -- allocation -- */
#ifndef NTS_PROVIDER_RC
  unsigned char *bump;
  size_t bump_left;
#endif
#if NTS_RECYCLES
  void *recycled[NTS_CLASSES];
#endif
  /* Region blocks given back and kept for the next open, newest first. */
  struct NtsRegionBlock *region_kept;
  size_t region_kept_len;

  /* -- diagnostics, aggregated on read at a safe point -- */
  size_t allocated;
  size_t reclaimed;
  size_t permanent;
  size_t allocations;

  /* -- destruction and cycle collection -- */
  NtsHeader *dying;
  NtsHeader **work;
  size_t work_len;
  size_t work_cap;
  NtsHeader **dead;
  size_t dead_len;
  size_t dead_cap;
  NtsHeader **zeroed;
  size_t zeroed_len;
  size_t zeroed_cap;

  /* -- host, scheduling and interning -- */
  NtsHost host;
  bool host_installed;
  /* Operations the program awaits that are outstanding (`nts_pending_*`). */
  uint32_t pending;
  uint32_t depth;
  bool checkpoint_active;
  bool join_active;
  NtsQueue microtask_queue;
  NtsQueue tick_queue;
  /* Promises that rejected with nothing listening, this turn. Usually empty:
     an `await` subscribes before the operation can settle, so only a rejection
     nobody is waiting for lands here. Checked and cleared by the checkpoint. */
  NtsPromise **rejected;
  uint32_t rejected_len;
  uint32_t rejected_cap;
  NtsMap *symbol_registry;
  /* The Web-platform runtime, as one managed reference. Not traced by the
     cycle collector: an environment is not an `NtsHeader` and cannot be part
     of a cycle, so this is a root rather than an edge. */
  NtsHeader *platform;

  /* Every live environment, so a process-wide diagnostic can sum them. Read
   * only at a safe point by a lane that has coordinated with the owners; it is
   * not a synchronization mechanism and nothing on the hot path touches it. */
  NtsEnvironment *next;
};

/* The environment this lane is running in.
 *
 * One default is created for the standalone case, because a program that never
 * asks for an environment still has exactly one. */
static NtsEnvironment nts_default_environment;
static NtsEnvironment *nts_environments = &nts_default_environment;
/* `static` is load-bearing rather than tidiness: with external linkage the
 * compiler must assume any call it cannot see reassigns this, and reload it
 * after every one. File-local, nothing outside can name it, so repeated
 * `nts_env->` reads in one function collapse to a single fetch. */
static _Thread_local NtsEnvironment *nts_env = &nts_default_environment;

NtsEnvironmentScope nts_environment_enter(NtsEnvironment *environment) {
  NtsEnvironmentScope scope;
  scope.previous = nts_env;
  nts_env = environment;
  return scope;
}

/* Restored rather than cleared to null: entering is a save/restore around a
 * call, and a null in between would make an ordinary nested entry look like a
 * closed environment. The contract's requirement is that leaving cannot leave
 * an owner thread pointing at something closed, which restoring satisfies. */
void nts_environment_leave(NtsEnvironmentScope *scope) {
  nts_env = scope->previous;
  scope->previous = 0;
}

NtsEnvironment *nts_environment_current(void) { return nts_env; }

void nts_environment_install_platform(NtsHeader *runtime) {
  /* Retain first, so installing a value over itself is not a release followed
     by a use of what it just freed. */
  nts_retain(runtime);
  NtsHeader *previous = nts_env->platform;
  nts_env->platform = runtime;
  nts_release(previous);
}

bool nts_environment_has_platform(void) { return nts_env->platform != NULL; }

NtsHeader *nts_environment_platform(void) {
  if (!nts_env->platform) {
    fprintf(stderr,
            "nts: the Web-platform runtime was read before it was installed\n");
    abort();
  }
  return nts_env->platform;
}

/* A second environment, for a host that runs more than one.
 *
 * Heap-allocated because how many there are is a runtime question, while the
 * default one is static because a program that never asks for an environment
 * still has exactly one and it must exist before `main` does -- top-level code
 * allocates, and only four entry points in this file require a host. */
NtsEnvironment *nts_environment_create(void) {
  NtsEnvironment *environment =
      (NtsEnvironment *)calloc(1u, sizeof(NtsEnvironment));
  if (!environment) {
    fprintf(stderr, "nts: out of memory creating an environment\n");
    abort();
  }
  environment->next = nts_environments;
  nts_environments = environment;
  return environment;
}

/* Close an environment and stop counting it.
 *
 * Refuses one that still holds objects. The alternative is to unlink it and
 * free the struct, which silently subtracts its allocations from every
 * process-wide total -- so a leak inside a closed environment would read as
 * less memory rather than more, which is the wrong direction for the one
 * question these counters exist to answer.
 *
 * Refuses the current one for the same reason `leave` restores rather than
 * clears: an owner lane must not be left pointing at something closed. */
void nts_environment_destroy(NtsEnvironment *environment) {
  if (environment == nts_env) {
    fprintf(stderr,
            "nts: an environment cannot destroy itself while current\n");
    abort();
  }
  if (environment == &nts_default_environment) {
    fprintf(stderr, "nts: the default environment is not destroyable\n");
    abort();
  }
  /* Give up what the environment owns, then collect, and only then ask
     whether anything is left.

     The collection is not tidiness. A release that takes a count to zero does
     *not* free an object the candidate buffer is holding -- it paints it black
     and leaves it, because freeing memory the buffer still points at is how
     the collector's own use-after-free happened. So an environment whose last
     references were dropped normally still has objects the buffer has not been
     through, and the liveness check below would call that a leak and abort on
     a program that did everything right. */
  {
    NtsEnvironmentScope scope = nts_environment_enter(environment);
    if (environment->platform) {
      nts_release(environment->platform);
      environment->platform = 0;
    }
    nts_collect_cycles();
    nts_environment_leave(&scope);
  }
  if (environment->allocated != environment->reclaimed) {
    fprintf(stderr,
            "nts: %zu object(s) still live in an environment being closed\n",
            environment->allocated - environment->reclaimed);
    abort();
  }
  NtsEnvironment **link = &nts_environments;
  while (*link && *link != environment) {
    link = &(*link)->next;
  }
  if (*link) {
    *link = environment->next;
  }
  free(environment);
}

/* Sum one counter across every live environment.
 *
 * This is the whole of what keeps the memory harness, the eight counter-reading
 * C runtime tests and the differential leak check working after the counters
 * stopped being process-global: they ask a process-wide question, and the
 * answer is now a sum rather than a load. Aggregation on read is also why none
 * of this needed to become atomic -- the cost is paid once, here, by whoever
 * asks, instead of on every retain by everyone who does not.
 *
 * Read at a safe point. A lane that walks this list while another owner is
 * mutating its own counters gets a torn total; that is a coordination
 * requirement on the caller, not something a lock here could fix, because the
 * counters are plain by design. */
static size_t nts_total(size_t offset) {
  size_t total = 0;
  for (const NtsEnvironment *e = nts_environments; e; e = e->next) {
    total += *(const size_t *)((const unsigned char *)e + offset);
  }
  return total;
}
#define NTS_TOTAL(field) nts_total(offsetof(NtsEnvironment, field))

/* Allocated and reclaimed, so that a test can see reference counting balance
 * from inside the program rather than infer it from memory use. */

size_t nts_live_count(void) {
  return NTS_TOTAL(allocated) - NTS_TOTAL(reclaimed);
}

/* Allocations the runtime holds for the life of the process **by design**.
 *
 * One thing is in here and it is the `Symbol.for` registry: the specification
 * says a registered symbol is never collected, which is the entire difference
 * between `Symbol.for("a")` and `Symbol("a")`. It is not a leak and it is not
 * reclaimable, and a leak check that cannot tell the two apart reports the
 * feature working as the feature failing.
 *
 * Separate from `nts_live_count` rather than subtracted inside it, because that
 * count is answering "what is still held" and the honest answer includes these.
 * What a *leak* check wants is the growth that is not this. */
size_t nts_permanent_count(void) { return NTS_TOTAL(permanent); }

/* The same allocations again, in a window a measurement can zero.
 *
 * `nts_env->allocated` cannot be zeroed: `nts_live_count` is the difference
 * between it and `nts_env->reclaimed`, so resetting one half would read the
 * whole heap as freed and the leak check would go quiet. */

size_t nts_counted_allocations(void) { return NTS_TOTAL(allocations); }

/* One place, so a fifth allocator cannot arrive and be counted by one of these
 * and not the other. Objects, arrays, strings and maps all come through it. */
static void nts_note_allocation(void) {
  nts_env->allocated++;
  nts_env->allocations++;
}

/* Every call to `nts_retain` and `nts_release`, counted where it arrives rather
 * than where it has an effect.
 *
 * That distinction is the whole measurement. A retain of a null pointer returns
 * on its first line and changes nothing -- and sixty-five percent of the
 * reference-counting operations in `awfy-list` were exactly that, emitted for a
 * constant the compiler had written two lines above. Counting effects would
 * have called that free. It was not free: it was a call.
 *
 * So this measures what the *compiler asked for*, which is the thing an elision
 * pass is trying to make smaller. */

size_t nts_counted_retains(void) { return NTS_TOTAL(retains); }
size_t nts_counted_releases(void) { return NTS_TOTAL(releases); }

/* Zeroed between phases, so a measurement can exclude set-up it did not mean to
 * charge the program for. */
void nts_counting_reset(void) {
  for (NtsEnvironment *e = nts_environments; e; e = e->next) {
    e->retains = 0;
    e->releases = 0;
    e->allocations = 0;
  }
}

/* Cyclic: an array of references whose elements the compiler could not prove
   unable to lead back to it. The descriptor says nothing about what the
   elements point at, so unknown has to mean yes. */
/* How the runtime's own objects print (`NtsDescriptor.to_string`): what
 * `Object.prototype.toString` answers for each, `"[object " + tag + "]"`, and
 * for a typed array its elements joined, as `Array.prototype.toString` does. A
 * `Map` and a `Set` share a descriptor and differ in `holds_values`. */
#define NTS_TEXT(literal) nts_string_from_utf8(literal, sizeof(literal) - 1u)
static NtsString *nts_map_to_string(const NtsHeader *object) {
  return ((const NtsMap *)object)->holds_values ? NTS_TEXT("[object Map]")
                                                : NTS_TEXT("[object Set]");
}
static NtsString *nts_promise_to_string(const NtsHeader *object) {
  (void)object;
  return NTS_TEXT("[object Promise]");
}
static NtsString *nts_buffer_to_string(const NtsHeader *object) {
  (void)object;
  return NTS_TEXT("[object ArrayBuffer]");
}
static NtsString *nts_dataview_to_string(const NtsHeader *object) {
  (void)object;
  return NTS_TEXT("[object DataView]");
}
static NtsString *nts_view_to_string(const NtsHeader *object) {
  NtsString *comma = NTS_TEXT(",");
  NtsString *text = nts_view_join((const NtsView *)object, comma);
  nts_release(comma);
  return text;
}

/* An object whose prototype chain adds nothing: a class with no `toString` of
 * its own, an object literal. Not a fallback -- that *is* its text. */
NtsString *nts_object_to_string(const NtsHeader *object) {
  (void)object;
  return NTS_TEXT("[object Object]");
}

/* A bound function: a built-in node has no name for, although its `name` is
 * `"bound f"`. */
NtsString *nts_bound_function_to_string(const NtsHeader *object) {
  (void)object;
  return NTS_TEXT("function () { [native code] }");
}

static const NtsDescriptor nts_desc_undefined = {.kind = NTS_KIND_OBJECT,
                                                 .size = sizeof(NtsHeader),
                                                 .name = "undefined-reference"};

/* Not allocated, counted or a collector candidate. In particular, its black
 * color is fixed so a trace restoring a live graph never writes this object. */
const NtsHeader nts_undefined_reference = {&nts_desc_undefined, NTS_IMMORTAL,
                                           NTS_BLACK, 0u};

const NtsDescriptor nts_desc_ref = {NTS_KIND_ARRAY,
                                    sizeof(void *),
                                    1,
                                    1,
                                    0,
                                    0,
                                    "reference",
                                    0u,
                                    0,
                                    NTS_ARRAY_REFERENCE,
                                    0u,
                                    NULL,
                                    nts_array_to_string,
                                    NULL,
                                    NULL,
                                    NULL};
/* The same array of references, for one whose elements the compiler proved
   can never lead back to it (`Cycles::array`): never buffered as a cycle
   candidate. Trial deletion still walks through one when a cycle reaches it
   from a candidate. */
const NtsDescriptor nts_desc_ref_acyclic = {NTS_KIND_ARRAY,
                                            sizeof(void *),
                                            1,
                                            0,
                                            0,
                                            0,
                                            "reference",
                                            0u,
                                            0,
                                            NTS_ARRAY_REFERENCE,
                                            0u,
                                            NULL,
                                            nts_array_to_string,
                                            NULL,
                                            NULL,
                                            NULL};
const NtsDescriptor nts_desc_string1 = {
    NTS_KIND_STRING,   1,  0,    0,    0,    0,    "string", 0u, 0,
    NTS_ARRAY_UNKNOWN, 0u, NULL, NULL, NULL, NULL, NULL};
const NtsDescriptor nts_desc_string2 = {
    NTS_KIND_STRING,   2,  0,    0,    0,    0,    "string", 0u, 0,
    NTS_ARRAY_UNKNOWN, 0u, NULL, NULL, NULL, NULL, NULL};

static const NtsDescriptor nts_desc_bigint = {NTS_KIND_BIGINT,
                                              (uint32_t)sizeof(NtsBigIntBox),
                                              0u,
                                              0u,
                                              0,
                                              0,
                                              "bigint",
                                              0u,
                                              0,
                                              NTS_ARRAY_UNKNOWN,
                                              0u,
                                              NULL,
                                              NULL,
                                              NULL,
                                              NULL,
                                              NULL};

NtsBigIntBox *nts_bigint_box(__int128 value) {
  NtsBigIntBox *box = (NtsBigIntBox *)nts_object_new(&nts_desc_bigint);
  box->value = value;
  return box;
}

__int128 nts_bigint_unbox(const NtsBigIntBox *box) { return box->value; }

/* The NoGC provider: a bump allocator that never frees. For compiler bring-up,
 * allocation testing and bounded-lifetime tools, and what `nts` builds unless
 * it is passed `--rc`. */
size_t nts_live_bytes(void) { return NTS_TOTAL(bytes_held); }

#ifdef NTS_PROVIDER_RC
/* Whether an uninitialized allocation is filled with a pattern that is not
 * zero, so that reading a slot nobody wrote is visible rather than lucky.
 * Off by default; the differential suite turns it on. */
#ifndef NTS_POISON
#define NTS_POISON 0
#endif

/* Blocks that have been given back, by size.
 *
 * Reference counting knows the moment an object dies, which is what makes this
 * worth having: the memory is free *now*, and the next allocation of that size
 * is almost always about to happen. A parser that slices a string per token
 * allocates and frees the same few sizes forever, and `malloc` is asked to
 * solve a general problem it does not have.
 *
 * Segregated by size so a free is a push and an allocation is a pop, with no
 * search and no coalescing. Sizes above the largest class fall through to
 * `malloc`, which is the right tool once the allocation is large enough that
 * one call does not matter.
 *
 * This is what a nursery buys a tracing collector, arrived at from the other
 * direction: counting already knows what a tracing collector would have to
 * discover. */
/* Declared only where it is used. Every use is behind `NTS_RECYCLES`, and a
 * declaration that is not makes an AddressSanitizer build -- the one case that
 * turns recycling off -- fail on `-Wunused-variable`, which the tests build
 * with `-Werror`. */
#endif

/* # Call regions (see the header for what they are for)
 *
 * A region is a chain of blocks bumped through, newest first. Its `NtsRegion`
 * lives at the start of the first block it took, so an open costs a block from
 * the kept list and no `malloc`. A block is 1 MiB; an allocation larger than a
 * quarter of one gets a block of its own, chained behind the one being bumped
 * through so the space left in that one is not abandoned.
 *
 * **Membership is never asked.** The compiler's facts say a region's objects
 * are written only while it is the active region (nothing outside stores into
 * them, and the caller only reads the result), and that nothing else grows
 * while one is. So a growth that frees its old block frees region memory
 * exactly when a region is active, and `nts_env->region` answers what an
 * address-range check would. Blocks can then come from `malloc` like anything
 * else: no address space reserved up front, nothing per platform. Under
 * `NTS_POISON` the claim is checked against the chain instead of trusted.
 *
 * **Accounting by window.** While a region is active, every change to the
 * allocated and reclaimed counts and to `bytes_held` is that region's -- the
 * same facts again: its call makes nothing on the heap, and no heap object dies
 * in it (a collection due then waits, see `nts_collect_cycles`). So each
 * activation records the counters at its start and adds what moved at its end,
 * and a reset gives back the difference. No allocation path learned anything,
 * and a fifth one cannot be added and forgotten.
 *
 * An object made in a region is immortal (`nts_fresh_count`), so a reset is the
 * only thing that frees one and a stray release from outside does nothing. A
 * reset under `NTS_POISON` fills the blocks it keeps, so a read through a
 * pointer that outlived its region is a pattern rather than a stale value;
 * AddressSanitizer keeps no blocks at all and sees the read itself. */
#ifdef NTS_PROVIDER_RC
#define NTS_REGION_BLOCK ((size_t)1 << 20)
#define NTS_REGION_OWN_BLOCK (NTS_REGION_BLOCK / 4u)
/* Enough for the next open of a region the size of most results, and no more:
 * 8 MiB of reused, already-touched memory per environment. A reset beyond it
 * gives the block back to `malloc`, so a program that once parsed a large
 * document does not hold its high-water mark forever. */
#define NTS_REGION_KEEP 8u

typedef struct NtsRegionBlock {
  struct NtsRegionBlock *next;
  /* The whole block, this header included. */
  size_t size;
} NtsRegionBlock;

struct NtsRegion {
  NtsRegionBlock *blocks;
  unsigned char *top;
  unsigned char *end;
  /* The activation this one interrupted: an outer region whose call opened
   * this one, or null for the heap. Activations nest like calls. */
  NtsRegion *outer;
  bool active;
  /* What the counters moved by over every window so far, and where the open
   * window started. */
  size_t allocated;
  size_t reclaimed;
  size_t bytes;
  size_t at_allocated;
  size_t at_reclaimed;
  size_t at_bytes;
  /* Arguments a region object may point at, held until the reset
   * (`nts_region_keep`): `malloc`'d, because the region's own blocks are what
   * the reset gives back first. */
  NtsHeader **kept;
  uint32_t kept_len;
  uint32_t kept_cap;
};

static void nts_region_window_open(NtsRegion *region) {
  region->at_allocated = nts_env->allocated;
  region->at_reclaimed = nts_env->reclaimed;
  region->at_bytes = nts_env->bytes_held;
}

static void nts_region_window_close(NtsRegion *region) {
  region->allocated += nts_env->allocated - region->at_allocated;
  region->reclaimed += nts_env->reclaimed - region->at_reclaimed;
  region->bytes += nts_env->bytes_held - region->at_bytes;
}

static NtsRegionBlock *nts_region_block_take(size_t size) {
  if (size == NTS_REGION_BLOCK && nts_env->region_kept) {
    NtsRegionBlock *kept = nts_env->region_kept;
    nts_env->region_kept = kept->next;
    nts_env->region_kept_len--;
    return kept;
  }
  NtsRegionBlock *block = (NtsRegionBlock *)malloc(size);
  if (!block) {
    fprintf(stderr, "nts: out of memory for a region\n");
    abort();
  }
  block->size = size;
  return block;
}

static void nts_region_block_give(NtsRegionBlock *block) {
#if NTS_RECYCLES
  if (block->size == NTS_REGION_BLOCK &&
      nts_env->region_kept_len < NTS_REGION_KEEP) {
#if NTS_POISON
    memset(block + 1, 0xA5, block->size - sizeof *block);
#endif
    block->next = nts_env->region_kept;
    nts_env->region_kept = block;
    nts_env->region_kept_len++;
    return;
  }
#endif
  free(block);
}

/* The slow half of a bump: a block of its own for a large allocation, or a
 * fresh block to bump through. */
static NTS_NOINLINE void *nts_region_refill(NtsRegion *region, size_t bytes,
                                            size_t align) {
  size_t head = (sizeof(NtsRegionBlock) + align - 1u) & ~(align - 1u);
  if (bytes > NTS_REGION_OWN_BLOCK) {
    NtsRegionBlock *own = nts_region_block_take(head + align + bytes);
    /* Behind the block being bumped through, which keeps its space. */
    own->next = region->blocks->next;
    region->blocks->next = own;
    uintptr_t at =
        ((uintptr_t)own + head + align - 1u) & ~(uintptr_t)(align - 1u);
    return (void *)at;
  }
  NtsRegionBlock *block = nts_region_block_take(NTS_REGION_BLOCK);
  block->next = region->blocks;
  region->blocks = block;
  region->top = (unsigned char *)(block + 1);
  region->end = (unsigned char *)block + block->size;
  uintptr_t at =
      ((uintptr_t)region->top + align - 1u) & ~(uintptr_t)(align - 1u);
  region->top = (unsigned char *)(at + bytes);
  return (void *)at;
}

/* `align` is a power of two no larger than `NTS_ELEMENT_ALIGN`. */
static inline void *nts_region_take(NtsRegion *region, size_t bytes,
                                    size_t align) {
  uintptr_t at =
      ((uintptr_t)region->top + align - 1u) & ~(uintptr_t)(align - 1u);
  if (at + bytes <= (uintptr_t)region->end) {
    region->top = (unsigned char *)(at + bytes);
    return (void *)at;
  }
  return nts_region_refill(region, bytes, align);
}

NtsRegion *nts_region_open(void) {
  NtsRegionBlock *block = nts_region_block_take(NTS_REGION_BLOCK);
  block->next = NULL;
  NtsRegion *region = (NtsRegion *)(block + 1);
  region->blocks = block;
  region->top = (unsigned char *)(region + 1);
  region->end = (unsigned char *)block + block->size;
  region->outer = nts_env->region;
  region->allocated = 0;
  region->reclaimed = 0;
  region->bytes = 0;
  region->kept = NULL;
  region->kept_len = 0;
  region->kept_cap = 0;
  if (region->outer) {
    nts_region_window_close(region->outer);
  }
  nts_region_window_open(region);
  region->active = true;
  nts_env->region = region;
  return region;
}

void nts_region_suspend(NtsRegion *region) {
  if (nts_env->region != region) {
    fprintf(stderr, "nts: a region was suspended that is not the active one\n");
    abort();
  }
  nts_region_window_close(region);
  region->active = false;
  nts_env->region = region->outer;
  if (region->outer) {
    nts_region_window_open(region->outer);
  }
  region->outer = NULL;
}

void nts_region_reset(NtsRegion *region) {
  /* A throw out of the region's call reaches its reset with it still active:
   * the suspend after the call never ran. */
  if (region->active) {
    if (nts_env->region != region) {
      fprintf(stderr, "nts: a region was reset while one opened inside it is "
                      "still active\n");
      abort();
    }
    nts_region_suspend(region);
  }
  nts_env->reclaimed += region->allocated - region->reclaimed;
  nts_env->bytes_held -= region->bytes;
  /* Read before the blocks go: `region` lives in the last one, given back
   * last. */
  NtsHeader **kept = region->kept;
  uint32_t kept_len = region->kept_len;
  NtsRegionBlock *block = region->blocks;
  while (block) {
    NtsRegionBlock *next = block->next;
    nts_region_block_give(block);
    block = next;
  }
  /* What the region's objects pointed at, given up once nothing does. */
  for (uint32_t at = 0; at < kept_len; at++) {
    nts_release(kept[at]);
  }
  free((void *)kept);
}

bool nts_region_owns(const NtsRegion *region, const void *pointer) {
  uintptr_t at = (uintptr_t)pointer;
  for (const NtsRegionBlock *block = region->blocks; block;
       block = block->next) {
    if (at >= (uintptr_t)block && at < (uintptr_t)block + block->size) {
      return true;
    }
  }
  return false;
}

/* Under `NTS_POISON`: refuse, by name, memory the facts say cannot be here. */
#if NTS_POISON
static void nts_region_expect_own(const void *pointer, const char *what) {
  if (nts_env->region && !nts_region_owns(nts_env->region, pointer)) {
    fprintf(stderr,
            "nts: %s that is not the active region's was given back inside "
            "it\n",
            what);
    abort();
  }
}
#endif

/* Whether a block an object owns beside itself -- an array's elements, a
 * table, a buffer's bytes -- is being given back inside a region, which keeps
 * it until its reset. Exactly when one is active: see the note on membership
 * above. */
static inline bool nts_region_keeps(const void *block, const char *what) {
  if (nts_env->region == NULL) {
    return false;
  }
#if NTS_POISON
  nts_region_expect_own(block, what);
#else
  (void)block;
  (void)what;
#endif
  return true;
}
#else
/* NoGC never frees, so a region would buy nothing; and a host-GC backend never
 * calls these. */
NtsRegion *nts_region_open(void) { return NULL; }
void nts_region_suspend(NtsRegion *region) { (void)region; }
void nts_region_reset(NtsRegion *region) { (void)region; }
bool nts_region_owns(const NtsRegion *region, const void *pointer) {
  (void)region;
  (void)pointer;
  return false;
}
#endif

/* The count a new object starts with: one reference, the caller's -- or, made
 * in a region, none to count, because the region's reset is what frees it. */
static inline uintptr_t nts_fresh_count(void) {
#ifdef NTS_PROVIDER_RC
  return nts_env->region ? (uintptr_t)NTS_IMMORTAL : 1u;
#else
  return 1u;
#endif
}

#define NTS_ROOT_NONE SIZE_MAX
#ifdef NTS_PROVIDER_RC
/* The heap prefix's second word is a candidate index while buffered, invalid
 * otherwise, and a free-list link only after the block is dead. memcpy keeps
 * those differently typed uses alias-safe; both optimize to one word access.
 * Regions and foreign holders have no heap prefix and never use this slot. */
static inline void nts_root_index_store(void *object, size_t index) {
  memcpy((unsigned char *)object - 8u, &index, sizeof index);
}

static inline size_t nts_root_index(const void *object) {
  size_t index;
  memcpy(&index, (const unsigned char *)object - 8u, sizeof index);
  return index;
}
#endif

void *nts_alloc(size_t bytes) {
  bytes = (bytes + 15u) & ~(size_t)15u;
  nts_env->bytes_held += bytes;

#ifdef NTS_PROVIDER_RC
  /* No size in front: only `nts_free_block` reads it, and nothing made in a
   * region reaches it. */
  if (__builtin_expect(nts_env->region != NULL, 0)) {
    return nts_region_take(nts_env->region, bytes, 16u);
  }
  /* Its own allocation, because it will be given back. The size is kept in
   * front of the object so that `nts_free` knows what it is returning without
   * consulting the descriptor -- which a freed object may no longer have. */
#if NTS_RECYCLES
  size_t klass = bytes / NTS_CLASS_STEP;
  if (klass < NTS_CLASSES && nts_env->recycled[klass]) {
    void *block = nts_env->recycled[klass];
    /* The list is threaded through the free blocks themselves, in the word
     * after the size -- which is dead while the block is dead. */
    nts_env->recycled[klass] = *(void **)((unsigned char *)block + 8u);
    nts_root_index_store((unsigned char *)block + 16u, NTS_ROOT_NONE);
    return (unsigned char *)block + 16u;
  }
#endif
  size_t *block = (size_t *)malloc(bytes + 16u);
  if (!block) {
    fprintf(stderr, "nts: out of memory\n");
    abort();
  }
  *block = bytes;
  nts_root_index_store((unsigned char *)block + 16u, NTS_ROOT_NONE);
  return (unsigned char *)block + 16u;
#else
  if (bytes > nts_env->bump_left) {
    size_t chunk = bytes > (size_t)1048576 ? bytes : (size_t)1048576;
    nts_env->bump = (unsigned char *)malloc(chunk);
    if (!nts_env->bump) {
      fprintf(stderr, "nts: out of memory\n");
      abort();
    }
    nts_env->bump_left = chunk;
  }
  void *result = nts_env->bump;
  nts_env->bump += bytes;
  nts_env->bump_left -= bytes;
  return result;
#endif
}

/* Give an object's memory back. Only the reference-counting provider has
 * anything to give: under NoGC there is no per-object allocation to return, and
 * the last release is where a tracing collector would do nothing at all. */
/* Give back a block `nts_alloc` handed out.
 *
 * Paired with `nts_free` below, which is the one every death path calls: this
 * is the block alone, and that one is the block *and* whatever hangs off it.
 */
static void nts_free_block(void *object) {
#ifdef NTS_PROVIDER_RC
#if NTS_POISON
  /* Nothing on the heap dies while a region is active: its call makes nothing
   * there, and what it reads its caller keeps alive (the second of the three
   * facts). A death here is an analysis that admitted a call it should not
   * have, and its counts would land in the region's window. */
  if (nts_env->region) {
    fprintf(stderr, "nts: a heap object died inside a region's call\n");
    abort();
  }
  if (nts_root_index(object) != NTS_ROOT_NONE) {
    fprintf(stderr, "nts: a buffered allocation was freed\n");
    abort();
  }
#endif
  size_t *block = (size_t *)((unsigned char *)object - 16u);
  size_t bytes = *block;
  nts_env->bytes_held -= bytes;
#if NTS_RECYCLES
  size_t klass = bytes / NTS_CLASS_STEP;
  if (klass < NTS_CLASSES) {
    *(void **)((unsigned char *)block + 8u) = nts_env->recycled[klass];
    nts_env->recycled[klass] = block;
    return;
  }
#endif
  free(block);
#else
  (void)object;
#endif
}

/* A string's death: its block, and the count that says it was reclaimed.
 *
 * A string holds nothing -- no references, no erased or foreign slots, its
 * units in its own block -- so nothing else the general death path does
 * applies to one, and the two places strings die both come here: a release
 * that reaches zero, and an append that outgrew the block it was given. */
static void nts_free_string(NtsHeader *string) {
  nts_env->reclaimed++;
  nts_free_block(string);
}

/* Where an array's elements start while they sit in its own block: the first
 * `NTS_ELEMENT_ALIGN` boundary after the header.
 *
 * 32 bytes, an AVX2 register. Native code is built for x86-64-v3 by default
 * (the user's decision, 2026-10-22), and a vector loop over elements that
 * start 16 bytes off a 32-byte boundary splits half its loads and stores
 * across cache lines: `elementwise` under AVX2 ran 157 us with 16-byte
 * elements against 74 with 32-byte ones, and C++ 75 -- 792M split loads where
 * C++ took 120 (the numbers study's perf counts). Sixteen bytes of slack per
 * array, once, for every vector load its elements will take. */
static unsigned char *nts_array_inline_elements(const NtsArray *array) {
  uintptr_t after = (uintptr_t)array + sizeof(NtsArray);
  return (unsigned char *)((after + (NTS_ELEMENT_ALIGN - 1u)) &
                           ~(uintptr_t)(NTS_ELEMENT_ALIGN - 1u));
}

/* An element block on an `NTS_ELEMENT_ALIGN` boundary, and its release, which
 * must be the matching one. C11's `aligned_alloc` where the C library has it;
 * the Windows CRT has none and spells the pair `_aligned_malloc` and
 * `_aligned_free`. `bytes` is a multiple of the alignment, as `aligned_alloc`
 * requires. */
#if defined(_WIN32)
#include <malloc.h>
static void *nts_elements_alloc_heap(size_t bytes) {
  return _aligned_malloc(bytes, NTS_ELEMENT_ALIGN);
}
static void nts_elements_free_heap(void *block) { _aligned_free(block); }
#else
static void *nts_elements_alloc_heap(size_t bytes) {
  return aligned_alloc(NTS_ELEMENT_ALIGN, bytes);
}
static void nts_elements_free_heap(void *block) { free(block); }
#endif

static void *nts_elements_alloc(size_t bytes) {
#ifdef NTS_PROVIDER_RC
  if (nts_env->region) {
    return nts_region_take(nts_env->region, bytes, NTS_ELEMENT_ALIGN);
  }
#endif
  return nts_elements_alloc_heap(bytes);
}

static void nts_elements_free(void *block) {
#ifdef NTS_PROVIDER_RC
  if (nts_region_keeps(block, "an element block")) {
    return;
  }
#endif
  nts_elements_free_heap(block);
}

/* The same for a map's table and a buffer's bytes, which `malloc` holds and
 * `free` gives back -- or the active region does both. */
static void *nts_side_alloc(size_t bytes) {
#ifdef NTS_PROVIDER_RC
  if (nts_env->region) {
    return nts_region_take(nts_env->region, bytes, 16u);
  }
#endif
  return malloc(bytes);
}

/* Zeroed: a region's block may be one a reset kept, and a fresh `ArrayBuffer`
 * reads as zeroes. */
static void *nts_side_zeroed(size_t bytes) {
#ifdef NTS_PROVIDER_RC
  if (nts_env->region) {
    void *block = nts_region_take(nts_env->region, bytes, 16u);
    memset(block, 0, bytes);
    return block;
  }
#endif
  return calloc(bytes, 1u);
}

static void nts_side_free(void *block, const char *what) {
#ifdef NTS_PROVIDER_RC
  if (nts_region_keeps(block, what)) {
    return;
  }
#else
  (void)what;
#endif
  free(block);
}

/* Whether an array's elements still sit in the block the array itself lives in.
 *
 * The one growth that moves them out is the only thing that makes this false,
 * and two places need to know: the grow path, which must not free the inline
 * block, and reclamation, which must free every other one. */
static bool nts_array_is_inline(const NtsArray *array) {
  return array->elements == nts_array_inline_elements(array);
}

/* Storage an object owns that does not live in its own block.
 *
 * There is exactly one kind today: an array that outgrew the elements sitting
 * inline after its header allocated a bigger block, and until this existed
 * nothing ever gave that block back. `nts_free` returned the *header*, whose
 * size is the header's alone, so the elements were not merely unfreed -- they
 * were unaccounted, and `nts_live_bytes` reported a program that had leaked
 * them as holding nothing. 200,000 arrays grown to 128 doubles and released
 * held 200MB resident afterwards, which is the whole of what they ever
 * allocated.
 *
 * Called from `nts_free` rather than from the two death paths, so that a third
 * one cannot be added without it. */
/* A table's block size, for its accounting: beside the table's code below. */
static size_t nts_map_block_bytes(uint32_t capacity, uint32_t slots,
                                  bool holds_values);

static void nts_free_storage(NtsHeader *object) {
  /* A map owns three of them, and a Set two -- the same question the array
   * above answers, asked of the type that made the question worth asking. */
  if (object->descriptor->kind == NTS_KIND_MAP) {
    NtsMap *map = (NtsMap *)object;
    if (map->keys) {
      nts_env->bytes_held -=
          nts_map_block_bytes(map->capacity, map->slots, map->holds_values);
    }
    /* Paired with the `nts_note_allocation` in `nts_map_rehash`, the same way
     * the rehash pairs the one it replaces. A table that was never grown has no
     * block and none to give back. */
    if (map->keys) {
      nts_env->reclaimed++;
    }
    /* `keys` is the block: the other columns point into it. */
    nts_side_free(map->keys, "a table");
    map->keys = 0;
    map->values = 0;
    map->index = 0;
    map->hashes = 0;
    return;
  }
  /* The bytes an `ArrayBuffer` owns. A transferred buffer already gave them
   * back and says so by having none. */
  if (object->descriptor->kind == NTS_KIND_BUFFER) {
    NtsBuffer *buffer = (NtsBuffer *)object;
    if (buffer->bytes) {
      nts_env->bytes_held -= buffer->reserved_bytes;
      nts_env->reclaimed++;
      nts_side_free(buffer->bytes, "a buffer's bytes");
      buffer->bytes = 0;
    }
    return;
  }
  /* A boxed record, given back through its box's own function -- never NULL,
   * which `nts_boxed_new` refuses, and refused here too for a box made some
   * other way. */
  if (object->descriptor->kind == NTS_KIND_BOXED) {
    NtsBoxed *box = (NtsBoxed *)object;
    if (box->free == NULL) {
      fprintf(stderr, "nts: a boxed record with no function to free it\n");
      abort();
    }
    if (box->boxed) {
      box->free(box->boxed, box->data);
      box->boxed = 0;
    }
    return;
  }
  if (object->descriptor->kind != NTS_KIND_ARRAY) {
    return;
  }
  NtsArray *array = (NtsArray *)object;
  if (!nts_array_is_inline(array)) {
    nts_env->bytes_held -= (size_t)array->capacity * object->descriptor->size;
    /* The element block this array grew into, given back. Counted where it was
     * taken -- see `nts_array_reserve`. */
    nts_env->reclaimed++;
    nts_elements_free(array->elements);
    array->elements = 0;
  }
}

/* Every erased slot an object holds -- a map's keys and values, an erased
 * array's elements, an erased field (`erased_offsets`) -- handed to `each`
 * with `visit` passed through. The one enumeration of where an object keeps
 * `NtsValue`s: `nts_each_reference` visits the managed references in them and
 * `nts_release_foreign` gives back the handles, and a new kind of erased
 * storage added here reaches both. Inlined with each constant `each`, so the
 * collector's walks pay no call per slot. */
static inline __attribute__((always_inline)) void
nts_each_erased_slot(NtsHeader *object,
                     void (*each)(NtsValue *slot, void (*visit)(NtsHeader *)),
                     void (*visit)(NtsHeader *)) {
  const NtsDescriptor *descriptor = object->descriptor;
  /* A map's are in two heap arrays rather than at fixed offsets. Holes carry a
   * tag that is neither a reference nor a handle, so skipping them needs no
   * test of its own. */
  if (descriptor->kind == NTS_KIND_MAP) {
    NtsMap *map = (NtsMap *)object;
    /* A column that never held a pointer has nothing to visit: a table of
     * numbers dies without a walk. map-and-set spent 11% here, in this walk
     * and `nts_release_foreign`'s, over 256 numbers each. */
    if (map->holds & NTS_MAP_HOLDS_KEYS) {
      for (uint32_t at = 0; at < map->used; at++) {
        each(&map->keys[at], visit);
      }
    }
    if (map->values && (map->holds & NTS_MAP_HOLDS_VALUES)) {
      for (uint32_t at = 0; at < map->used; at++) {
        each(&map->values[at], visit);
      }
    }
    return;
  }
  if (descriptor->kind == NTS_KIND_ARRAY) {
    if (descriptor->erased) {
      NtsValue *slots = NTS_ITEMS((NtsArray *)object, NtsValue);
      for (uint32_t index = 0; index < object->length; index++) {
        each(&slots[index], visit);
      }
    }
    return;
  }
  for (uint32_t index = 0; index < descriptor->erased; index++) {
    each((NtsValue *)((unsigned char *)object +
                      descriptor->erased_offsets[index]),
         visit);
  }
}

/* An erased slot holding a C library's object -- a tag in the handle block --
 * given back through its family, the slot cleared first. */
static inline __attribute__((always_inline)) void
nts_release_handle_slot(NtsValue *slot, void (*unused)(NtsHeader *)) {
  (void)unused;
  NtsValue held = *slot;
  if (NTS_TAG_IS_HANDLE(held.tag) && held.as.native) {
    slot->tag = NTS_TAG_UNDEFINED;
    nts_value_release(held);
  }
}

/* A managed reference an erased slot holds, handed to `visit`. */
static inline __attribute__((always_inline)) void
nts_visit_managed(NtsValue *slot, void (*visit)(NtsHeader *)) {
  if (NTS_TAG_IS_MANAGED(nts_value_tag(*slot)) && nts_value_reference(*slot)) {
    visit(nts_value_reference(*slot));
  }
}

/* A foreign release can enter program code. Its calls and catches belong to
 * that entry, not to the throw whose cleanup may have started this release.
 * Keep the outer payload's existing ownership here until normal return.
 *
 * This is also a native callback boundary: an escaping throw must not jump
 * past a release's C frames to a waiting outer landing. Count that frame
 * directly, rather than calling nts_callback_leave: a release does not end a
 * host-loop turn and must not introduce a microtask checkpoint. */
static void nts_call_foreign_release(void (*release)(void *), void *object) {
  NtsEnvironment *environment = nts_env;
  int raising = environment->raising;
  NtsValue raised = environment->raised;
  environment->raising = 0;
  environment->raised = nts_value_of_undefined();
  environment->in_callback++;
  release(object);
  if (environment->raising) {
    nts_uncaught(nts_raise_take(), NULL);
  }
  environment->in_callback--;
  environment->raised = raised;
  environment->raising = raising;
}

/* Give up the foreign objects an object's fields hold. Each slot is cleared
 * before its release runs, so a release that reaches back into this runtime
 * finds nothing to give up twice. */
static void nts_release_foreign(NtsHeader *object) {
  const NtsDescriptor *descriptor = object->descriptor;
  /* The handles its erased slots hold. `nts_each_reference` visits managed
   * references only, and a handle is not one: a container's own death gives
   * them back here, where the typed foreign slots are. A box used to be
   * managed, and its finalizer did this. */
  nts_each_erased_slot(object, nts_release_handle_slot, 0);
  /* An array of them: every element, through the one slot's family. */
  if (descriptor->kind == NTS_KIND_ARRAY &&
      descriptor->element == NTS_ARRAY_FOREIGN) {
    NtsArray *array = (NtsArray *)object;
    void **items = NTS_ITEMS(array, void *);
    const NtsFamilyOps *ops = descriptor->foreign_slots[0].ops;
    for (uint32_t at = 0; at < array->header.length; at++) {
      void *held = items[at];
      if (held) {
        items[at] = 0;
        nts_call_foreign_release(ops->release, held);
      }
    }
    return;
  }
  for (uint32_t index = 0; index < descriptor->foreign; index++) {
    const NtsForeignSlot *slot = &descriptor->foreign_slots[index];
    void **field = (void **)((unsigned char *)object + slot->offset);
    void *held = *field;
    if (held) {
      *field = 0;
      nts_call_foreign_release(slot->ops->release, held);
    }
  }
}

/* A fixed object with no erased/foreign fields cannot hold a foreign handle.
 * Maps hold tags in implicit columns; foreign arrays have an implicit family
 * slot. Keep those on the existing protocol even without erased fields. */
static bool nts_has_foreign_contents(const NtsDescriptor *descriptor) {
  return descriptor->erased || descriptor->foreign ||
         descriptor->kind == NTS_KIND_MAP ||
         (descriptor->kind == NTS_KIND_ARRAY &&
          descriptor->element == NTS_ARRAY_FOREIGN);
}

/* Reclaim an object: what hangs off it, then the block itself. */
static void nts_free(NtsHeader *object) {
  const NtsDescriptor *descriptor = object->descriptor;
  if (nts_has_foreign_contents(descriptor)) {
    nts_release_foreign(object);
  }
  /* These layouts keep all storage in their own block. Other kinds retain
   * their existing backing-store/finalizer dispatch. */
  if (descriptor->kind != NTS_KIND_OBJECT &&
      descriptor->kind != NTS_KIND_TUPLE) {
    nts_free_storage(object);
  }
  nts_free_block(object);
}

/* A fixed-layout object: the descriptor knows its whole size, and `length` is
 * not a count of anything. Zeroed, so a field is never read before it is
 * written -- the compiler emits a store for every field of a literal, but a
 * partially-built object is observable through a call made in the middle of
 * one. */
NtsHeader *nts_object_new(const NtsDescriptor *descriptor) {
  NtsHeader *object = (NtsHeader *)nts_alloc(descriptor->size);
  memset(object, 0, descriptor->size);
  object->descriptor = descriptor;
  /* One reference: the caller's. */
  object->reserved = nts_fresh_count();
  nts_note_allocation();
  return object;
}

/* Reference counting. The count lives in the header's
 * provider-reserved word, which is unused under NoGC and is this under RC.
 *
 * Not atomic. A runtime owns its heap and a managed reference does
 * not cross between runtimes, so the count is only ever touched by one thread.
 * Making it atomic would cost every retain a locked instruction to defend
 * against sharing the design does not permit.
 *
 * **Small enough to inline, and the operation counters only where they are
 * read.** A program links the runtime with LTO (`compile_flags::LTO`), which
 * inlines a function this size into every call site, C and LLVM alike, and
 * not one carrying the whole release. So `nts_retain` and `nts_release` decide
 * the common case themselves and hand the rest to `nts_release_counted`. The
 * counts of retains and releases are what `tooling/memory` measures, and
 * nothing else reads them: they build under `NTS_COUNT_OPERATIONS`, which that
 * harness sets, and a shipped program does not pay a store per operation for
 * them. The memory study measured the two together at -27% on
 * `map-entries-top-k`, -10% on `awfy-bounce` and -8% on `json-parse`. */
void nts_retain(NtsHeader *object) {
#ifdef NTS_COUNT_OPERATIONS
  nts_env->retains++;
#endif
  if (!object || object->reserved == NTS_IMMORTAL ||
      (object->flags & NTS_DYING) != 0) {
    return;
  }
  object->reserved++;
  /* A reference was added, so this is reachable from somewhere and is not a
   * candidate for anything. */
  object->flags = (object->flags & ~NTS_COLOR_MASK) | NTS_BLACK;
}

/* The families whose objects hold closures the program lent them, by
 * `NTS_FAMILY_*` (see `NtsHolders`). Set once, before the program runs. */
static const NtsHolders *nts_holders[NTS_FAMILIES];

void nts_register_holders(uint32_t family, const NtsHolders *holders) {
  if (family < NTS_FAMILIES) {
    nts_holders[family] = holders;
  }
}

/* A node: the collector's stand-in for a foreign object while it holds a lent
 * closure. Nothing allocates one of these as an object; the family does, with
 * this descriptor in its header, and the collector recognises it by address.
 * Cyclic, since holding is what puts it in a cycle. */
const NtsDescriptor nts_holder_descriptor = {
    NTS_KIND_OBJECT,   0,  0,    1,    0,    0,    "holder", 0u, 0,
    NTS_ARRAY_UNKNOWN, 0u, NULL, NULL, NULL, NULL, NULL};

static bool nts_is_holder(const NtsHeader *object) {
  return object->descriptor == &nts_holder_descriptor;
}

/* Which references a walk wants. Two questions with two answers, asked
 * explicitly at every call rather than read off the collector's state:
 *
 * - `NTS_EDGES_OWNED`: the references an object gives up when it dies --
 *   its reference and erased slots. What destruction releases.
 * - `NTS_EDGES_TRACED`: those, and the edges through a foreign object that
 *   holds a lent closure -- a foreign slot to the object's node, and a node to
 *   each closure it holds. What the collector's four walks follow. A node is
 *   traced and never released by this runtime, and a foreign slot is released
 *   by `nts_release_foreign`, not here; so destruction must not see these
 *   edges, and the collector must. */
typedef enum { NTS_EDGES_OWNED, NTS_EDGES_TRACED } NtsEdges;

/* A traced object's edges through the foreign objects it holds: each slot
 * whose family holds closures, to that object's node, where it has one. */
static void nts_each_holder(NtsHeader *object, void (*visit)(NtsHeader *)) {
  const NtsDescriptor *descriptor = object->descriptor;
  /* An array of them: each element, when its family holds closures. */
  if (descriptor->kind == NTS_KIND_ARRAY &&
      descriptor->element == NTS_ARRAY_FOREIGN) {
    uint32_t family = descriptor->foreign_slots[0].family;
    const NtsHolders *holders =
        family < NTS_FAMILIES ? nts_holders[family] : NULL;
    if (holders == NULL) {
      return;
    }
    const NtsArray *array = (const NtsArray *)object;
    void **items = NTS_ITEMS(array, void *);
    for (uint32_t at = 0; at < array->header.length; at++) {
      NtsHeader *node = items[at] ? holders->node(items[at]) : NULL;
      if (node != NULL) {
        visit(node);
      }
    }
    return;
  }
  for (uint32_t index = 0; index < descriptor->foreign; index++) {
    const NtsForeignSlot *slot = &descriptor->foreign_slots[index];
    const NtsHolders *holders =
        slot->family < NTS_FAMILIES ? nts_holders[slot->family] : NULL;
    void *held = *(void **)((unsigned char *)object + slot->offset);
    if (holders == NULL || held == NULL) {
      continue;
    }
    NtsHeader *node = holders->node(held);
    if (node != NULL) {
      visit(node);
    }
  }
}

/* Every reference an object holds, handed one at a time to `visit`.
 *
 * The four walks the collector does and the one destruction does differ only
 * in what they do with each child, so the walking is written once; which
 * references count as its children is `edges`. */
static void nts_each_reference(NtsHeader *object, void (*visit)(NtsHeader *),
                               NtsEdges edges) {
  const NtsDescriptor *descriptor = object->descriptor;
  /* An emptied shell (`nts_destroy`) has given its contents back, so its
   * slots name objects that may be gone. Nothing reaches one -- its count is
   * zero and only the candidate buffer names it, which the collector empties
   * without walking it -- so a collector's walk arriving here is a defect, and
   * walking on would read freed memory. Stopped by name instead. The owned
   * walk that released its contents is the one walk it gets. */
  if (edges == NTS_EDGES_TRACED &&
      (object->flags & (NTS_DYING | NTS_BUFFERED)) ==
          (NTS_DYING | NTS_BUFFERED)) {
    fprintf(stderr, "nts: the cycle collector walked into an emptied object "
                    "it has yet to free\n");
    abort();
  }
  if (edges == NTS_EDGES_TRACED) {
    if (nts_is_holder(object)) {
      nts_holders[object->length]->each_held(object, visit);
      return;
    }
    nts_each_holder(object, visit);
  }
  if (descriptor->references == 0 && descriptor->erased == 0) {
    return;
  }
  if (edges == NTS_EDGES_TRACED && descriptor->trace_fields) {
    descriptor->trace_fields(object, visit);
    return;
  }
  /* The references in its erased slots -- a map's, an erased array's, an
   * erased field's -- through the one enumeration of them. A handle in one is
   * not visited: it is not an object of this heap. Where a handle's family
   * holds a managed object of ours (a GObject subclass's fields), that edge is
   * the holder mechanism's (`nts_is_holder`), not this walk's; a family that
   * held one some other way would be a cycle this walk cannot see. */
  if (descriptor->kind == NTS_KIND_MAP ||
      (descriptor->kind == NTS_KIND_ARRAY && descriptor->erased)) {
    nts_each_erased_slot(object, nts_visit_managed, visit);
    return;
  }
  if (descriptor->kind == NTS_KIND_ARRAY) {
    NtsHeader **slots = NTS_ITEMS((const NtsArray *)object, NtsHeader *);
    for (uint32_t index = 0; index < object->length; index++) {
      if (slots[index]) {
        visit(slots[index]);
      }
    }
    return;
  }
  for (uint32_t index = 0; index < descriptor->references; index++) {
    unsigned char *slot = (unsigned char *)object + descriptor->offsets[index];
    NtsHeader *child = *(NtsHeader **)slot;
    if (child) {
      visit(child);
    }
  }
  /* And the slots whose contents decide whether they are references at all.
   *
   * The generic destruction fallback and all four passes of the cycle
   * collector share this traversal. Generated contents callbacks use the same
   * managed-tag and non-null test. That is the reason an erased value is
   * stored whole rather than decomposed into a tag beside a typed slot at every
   * kind of storage -- one concept here, against a parallel tag slot in object
   * layout, array layout, globals and closure captures. */
  nts_each_erased_slot(object, nts_visit_managed, visit);
}

/* The out-of-line half of erased strict equality. Declared beside the inline
 * scalar forms in the header; here because they call through pointers. */
bool nts_value_eq_string(NtsValue value, const NtsString *text) {
  return value.tag == NTS_TAG_STRING &&
         nts_string_eq((const NtsString *)value.as.reference, text);
}

bool nts_value_eq_reference(NtsValue value, const NtsHeader *reference) {
  return value.tag != NTS_TAG_BIGINT && NTS_TAG_IS_POINTER(value.tag) &&
         value.as.reference == reference;
}

/* Both sides erased. Different tags are unequal without further question --
 * `1 === "1"` is false -- and the same tag defers to the rule for that kind.
 *
 * `NaN === NaN` is false here and true in `nts_key_eq`, which is the whole
 * difference between strict equality and SameValueZero and the reason these
 * are two functions. */
bool nts_value_strict_eq(NtsValue a, NtsValue b) {
  if (a.tag != b.tag) {
    return false;
  }
  switch (a.tag) {
  case NTS_TAG_UNDEFINED:
    return true;
  case NTS_TAG_BOOLEAN:
    return a.as.boolean == b.as.boolean;
  case NTS_TAG_NUMBER:
    return a.as.number == b.as.number;
  case NTS_TAG_BIGINT:
    return nts_bigint_unbox((const NtsBigIntBox *)a.as.reference) ==
           nts_bigint_unbox((const NtsBigIntBox *)b.as.reference);
  case NTS_TAG_STRING:
    return nts_string_eq((const NtsString *)a.as.reference,
                         (const NtsString *)b.as.reference);
  /* One C object is itself: the same tag, so the same family, and the same
   * address. */
  case NTS_TAG_HANDLE_GOBJECT:
  case NTS_TAG_HANDLE_OBJC:
  case NTS_TAG_HANDLE_COM:
    return a.as.native == b.as.native;
  default:
    return a.as.reference == b.as.reference;
  }
}

/* The low `bits` of a value, as two's complement.
 *
 * Split from the two entry points below because the masking is the same and
 * only the last step differs -- an unsigned answer stops at the mask and a
 * signed one carries the top bit outwards. */
static __int128 nts_bigint_low_bits(double bits, __int128 value, bool sign) {
  if (!(bits > 0.0)) {
    return 0;
  }
  if (bits >= 128.0) {
    if (!sign && value < 0) {
      nts_bigint_overflow();
    }
    return value;
  }
  unsigned width = (unsigned)bits;
  /* `ToIndex` truncates, so a width in (0, 1) is a width of zero -- and the
   * signed path below shifts by `width - 1`, which underflows to a shift count
   * no C shift has. The test above admits `0.5` because it asks about the
   * *double*; this asks about what the conversion produced. Zero bits of a
   * value is zero. Lowering's ToIndex guard already checked the range. */
  if (width == 0u) {
    return 0;
  }
  unsigned __int128 mask = ((unsigned __int128)1 << width) - 1;
  unsigned __int128 low = (unsigned __int128)value & mask;
  if (!sign) {
    return (__int128)low;
  }
  /* Sign-extend: if the top bit of the field is set the value is negative, and
   * the bits above the field are all ones. */
  unsigned __int128 top = (unsigned __int128)1 << (width - 1);
  if (low & top) {
    return (__int128)(low | ~mask);
  }
  return (__int128)low;
}

__int128 nts_bigint_as_intn(double bits, __int128 value) {
  return nts_bigint_low_bits(bits, value, true);
}

__int128 nts_bigint_as_uintn(double bits, __int128 value) {
  return nts_bigint_low_bits(bits, value, false);
}

/* Shifting a `bigint`, which C's own operators do not spell.
 *
 * Three of JavaScript's rules here are undefined behaviour in C, and node was
 * asked for each of them rather than assumed:
 *
 *     1n << -1n     is 0n     -- a negative count shifts the other way
 *     4n >> -1n     is 8n
 *     5n >> 300n    is 0n     -- a count past the width saturates
 *     -1n >> 300n   is -1n       arithmetically, so a negative value stays -1
 *
 * C leaves a shift by a negative count undefined, leaves a shift by more than
 * the operand's width undefined, and leaves `<<` on a negative left operand
 * undefined as well. Emitting `a << b` would therefore be wrong for three
 * separate reasons on inputs a program can easily reach, which is why these
 * exist rather than the operator.
 *
 * There is no `>>>` here on purpose: it is a TypeError on a bigint in
 * JavaScript, and the typechecker rejects it before this is reached.
 *
 * The signed domain is 128 bits. An upward shift that leaves it stops by name
 * rather than wrapping; a downward shift still saturates arithmetically. */

_Noreturn void nts_bigint_overflow(void) {
  static const char text[] =
      "a bigint past 128 bits, which this runtime does not hold";
  nts_refused(nts_string_from_utf8(text, sizeof(text) - 1));
}

/* Left, on the unsigned twin so a negative value's shift is defined. */
static __int128 nts_bigint_up(__int128 value, unsigned count) {
  if (value == 0) {
    return 0;
  }
  if (count >= 128u) {
    nts_bigint_overflow();
  }
  __int128 shifted = (__int128)((unsigned __int128)value << count);
  /* Reversing the shift must recover the operand, including its sign. This
   * accepts -1 << 127 (the minimum) and rejects 1 << 127 (past the maximum). */
  if ((shifted >> count) != value) {
    nts_bigint_overflow();
  }
  return shifted;
}

/* Right, arithmetically: the sign bit is replicated, so a negative value
 * saturates at -1 and a non-negative one at 0. */
static __int128 nts_bigint_down(__int128 value, unsigned count) {
  if (count >= 128u) {
    return value < 0 ? (__int128)-1 : (__int128)0;
  }
  return value >> count;
}

/* A count is itself a bigint, so it can be negative and it can be enormous.
 * The out-of-range test comes before negating it, because the one count whose
 * negation overflows is INT128_MIN, and that is past the width either way. */
__int128 nts_bigint_shl(__int128 value, __int128 count) {
  if (count < 0) {
    return count <= -128 ? (value < 0 ? (__int128)-1 : (__int128)0)
                         : nts_bigint_down(value, (unsigned)-count);
  }
  return nts_bigint_up(value, count >= 128 ? 128u : (unsigned)count);
}

__int128 nts_bigint_shr(__int128 value, __int128 count) {
  if (count < 0) {
    return nts_bigint_up(value, count <= -128 ? 128u : (unsigned)-count);
  }
  return count >= 128 ? (value < 0 ? (__int128)-1 : (__int128)0)
                      : nts_bigint_down(value, (unsigned)count);
}

__int128 nts_bigint_pow(__int128 base, __int128 exponent) {
  /* The caller lowers the JavaScript throw. An unchecked foreign call must
   * not quietly answer 1 for a negative exponent. */
  if (exponent < 0) {
    static const char text[] = "a negative bigint exponent reached the runtime";
    nts_refused(nts_string_from_utf8(text, sizeof(text) - 1));
  }
  __int128 result = 1;
  while (exponent != 0) {
    if ((exponent & 1) != 0 && __builtin_mul_overflow(result, base, &result)) {
      nts_bigint_overflow();
    }
    exponent >>= 1;
    /* The last square is unused. In particular min ** 1 fits even though
     * min squared does not. */
    if (exponent != 0 && __builtin_mul_overflow(base, base, &base)) {
      nts_bigint_overflow();
    }
  }
  return result;
}

/* How each family of the handle block counts its handles, indexed by
 * `NTS_HANDLE_FAMILY`: filled by the family's support file, empty until then.
 */
typedef struct NtsHandleCounting {
  void (*retain)(void *);
  void (*release)(void *);
  const char *name;
} NtsHandleCounting;

static NtsHandleCounting nts_handle_families[NTS_HANDLE_FAMILIES];

/* Whether a handle has been counted yet. A family registered after that is
 * *too late* -- a registration that runs in the wrong place, where a family
 * never registered is a support file not linked -- and the two aborts say
 * different things. Set on the handle path only, so a value that is not a
 * handle pays nothing for it. */
static bool nts_handles_counted;

void nts_handle_family_register(uint32_t tag, void (*retain)(void *),
                                void (*release)(void *), const char *name) {
  if (!NTS_TAG_IS_HANDLE(tag) || !retain || !release) {
    fprintf(stderr,
            "nts: handle family %s registered at tag %u, which is not "
            "one of the handle block's\n",
            name, tag);
    abort();
  }
  NtsHandleCounting *slot = &nts_handle_families[NTS_HANDLE_FAMILY(tag)];
  if (slot->retain) {
    fprintf(stderr, "nts: handle family %s registered twice\n", name);
    abort();
  }
  if (nts_handles_counted) {
    fprintf(stderr,
            "nts: handle family %s registered too late, after values were "
            "already counted; register it from a load-time constructor\n",
            name);
    abort();
  }
  *slot = (NtsHandleCounting){retain, release, name};
}

#ifdef NTS_PROVIDER_RC
/* How a handle value is counted, or an abort naming the tag nothing
 * registered. Never a no-op: a release that did nothing would leak, and a
 * retain that did nothing would let the handle be freed under its holder. */
static const NtsHandleCounting *nts_handle_counting(uint32_t tag) {
  nts_handles_counted = true;
  const NtsHandleCounting *counting =
      &nts_handle_families[NTS_HANDLE_FAMILY(tag)];
  if (!counting->retain) {
    fprintf(stderr,
            "nts: a handle value with tag %u, and no family registered how to "
            "count it -- its support file registers it from a load-time "
            "constructor, so this one is not linked\n",
            tag);
    abort();
  }
  return counting;
}
#endif

void nts_template_reflection(NtsValue value) {
  const NtsHeader *object = NTS_TAG_IS_MANAGED(nts_value_tag(value))
                                ? nts_value_reference(value)
                                : NULL;
  if (object && object->descriptor->kind == NTS_KIND_ARRAY &&
      (object->flags & NTS_ARRAY_IMMUTABLE)) {
    fflush(stdout);
    fputs("nts: refused at run time: reflecting on a cooked-only template "
          "object\n",
          stderr);
    abort();
  }
}

NtsArray *nts_array_writable(NtsArray *array) {
  if (array && (array->header.flags & NTS_ARRAY_IMMUTABLE)) {
    fflush(stdout);
    fputs("nts: refused at run time: converting an immutable template object "
          "to writable array storage\n",
          stderr);
    abort();
  }
  return array;
}

void nts_handle_check(uint32_t found, uint32_t wanted) {
  if (found == wanted || found == NTS_TAG_UNDEFINED || found == NTS_TAG_NULL) {
    return;
  }
  if (found == NTS_TAG_OBJECT) {
    fprintf(stderr,
            "nts: a handle of tag %u arrived boxed, where a value holds it "
            "tagged; only a promise still boxes a handle, and moving it to "
            "the tag is the migration that was deferred\n",
            wanted);
  } else {
    fprintf(stderr,
            "nts: a handle of tag %u was read back from a value with tag %u\n",
            wanted, found);
  }
  abort();
}

/* Claim and give up what an erased value holds. */
void nts_value_retain(NtsValue value) {
  uint32_t tag = nts_value_tag(value);
  if (NTS_TAG_IS_MANAGED(tag) && nts_value_reference(value)) {
    nts_retain(nts_value_reference(value));
  }
#ifdef NTS_PROVIDER_RC
  /* Only where references are counted: without it nothing counted a handle
   * in, so nothing may count one out. */
  else if (NTS_TAG_IS_HANDLE(tag) && value.as.native) {
    nts_handle_counting(tag)->retain(value.as.native);
  }
#endif
}

#ifdef NTS_PROVIDER_RC
/* A handle's release, out of line for the reason `nts_release_counted` is: kept
 * inline it made `nts_value_release` too large for LTO to inline into the
 * program, so every release of an erased value -- nearly always a managed
 * reference -- paid a call for the rare foreign one. */
static NTS_NOINLINE void nts_value_release_handle(uint32_t tag, void *native) {
  nts_call_foreign_release(nts_handle_counting(tag)->release, native);
}
#endif

void nts_value_release(NtsValue value) {
  uint32_t tag = nts_value_tag(value);
  if (NTS_TAG_IS_MANAGED(tag) && nts_value_reference(value)) {
    nts_release(nts_value_reference(value));
  }
#ifdef NTS_PROVIDER_RC
  /* Only where references are counted: without it nothing counted a handle
   * in, so nothing may count one out. */
  else if (NTS_TAG_IS_HANDLE(tag) && value.as.native) {
    nts_value_release_handle(tag, value.as.native);
  }
#endif
}

/* Give up what a dying object was holding.
 *
 * A field is a slot with an owner, so an object that is about to stop existing
 * has to release everything its slots hold -- otherwise a tree of objects leaks
 * everything below its root, which is the shape of leak that looks like it
 * works right up until it doesn't. */
static void nts_release_contents(NtsHeader *object) {
  const NtsDescriptor *descriptor = object->descriptor;
  if (descriptor->release_fields) {
    descriptor->release_fields(object);
  } else if (descriptor->references || descriptor->erased) {
    nts_each_reference(object, nts_release, NTS_EDGES_OWNED);
  }
}

static void nts_maybe_collect(void);

/* Clear a candidate only while its entry still names it. The collector calls
 * this before discarding an entry; ordinary death removes it immediately.
 * A holder's header belongs to its foreign family, with no prefix to read. */
static void nts_root_clear(NtsHeader *object) {
#ifdef NTS_PROVIDER_RC
  if (!nts_is_holder(object)) {
#if NTS_POISON
    size_t slot = nts_root_index(object);
    if ((object->flags & NTS_BUFFERED) == 0 || slot >= nts_env->roots_len ||
        nts_env->roots[slot] != object) {
      fprintf(stderr, "nts: a candidate has a stale roots index\n");
      abort();
    }
#endif
    nts_root_index_store(object, NTS_ROOT_NONE);
  }
#endif
  object->flags &= ~NTS_BUFFERED;
}

#ifdef NTS_PROVIDER_RC
static void nts_unbuffer_root(NtsHeader *object) {
  size_t slot = nts_root_index(object);
  if (slot >= nts_env->roots_len || nts_env->roots[slot] != object) {
    fprintf(stderr, "nts: removing a candidate with a stale roots index\n");
    abort();
  }
  nts_root_clear(object);
  size_t last = --nts_env->roots_len;
  if (slot != last) {
    NtsHeader *moved = nts_env->roots[last];
    nts_env->roots[slot] = moved;
    if (!nts_is_holder(moved)) {
      nts_root_index_store(moved, slot);
    }
  }
}
#endif

/* Objects whose count has reached zero and whose contents have not been given
 * up yet, linked through the count word -- which is free, because the count is
 * zero and the object is going away.
 *
 * Threading the list through the objects is what makes destruction iterative
 * rather than recursive, and that is not a micro-optimization: releasing the
 * head of a million-node list recursively is a million C stack frames. It also
 * means destruction allocates nothing and so cannot fail. */

/* Destroy an object whose count has reached zero: give up what it holds, then
 * give the memory back. */
static void nts_destroy(NtsHeader *object) {
  /* Marked before the count word stops being one. Everything that reads a
   * count has to know not to, and the flags word is the only part of the
   * header still saying what this is. */
  object->flags |= NTS_DYING;
  object->reserved = (uintptr_t)nts_env->dying;
  nts_env->dying = object;
  if (nts_env->draining) {
    /* An outer call owns the list and will get to it. */
    return;
  }

  nts_env->draining = true;
  while (nts_env->dying) {
    NtsHeader *dead = nts_env->dying;
    nts_env->dying = (NtsHeader *)dead->reserved;
#ifdef NTS_PROVIDER_RC
    /* Bacon/Rajan, ECOOP 2001, Fig. 2 (Release/MarkRoots): Free is deferred
     * while Roots still names the node. Remove that entry first, and ordinary
     * synchronous destruction can free its storage now. Never mutate a roots
     * vector the collector is currently walking; its existing deferred path
     * handles those deaths. https://doi.org/10.1007/3-540-45337-7_12 */
    if ((dead->flags & NTS_BUFFERED) && !nts_env->collecting &&
        !nts_is_holder(dead)) {
      nts_unbuffer_root(dead);
    }
#endif
    /* This may link more objects into the list, which the loop picks up. */
    nts_release_contents(dead);
    if (dead->flags & NTS_BUFFERED) {
      /* An emptied shell (see `nts_release`): the candidate buffer still
       * names it, so only its contents go now, and the collector frees its
       * memory when it empties the buffer (`nts_collect_pass`). Its contents
       * are the foreign ones too -- the handles in its erased slots, a GTK
       * button among them, and its foreign fields -- which `nts_free` would
       * otherwise give back only when the collector frees the shell; each
       * slot is cleared as it goes, so that free finds nothing left to give
       * back twice. The count word is a count again, zero; `NTS_DYING` stays,
       * and with `NTS_BUFFERED` beside it that pair is the shell's mark --
       * nothing else ever carries both. */
      if (nts_has_foreign_contents(dead->descriptor)) {
        nts_release_foreign(dead);
      }
      dead->reserved = 0;
      continue;
    }
    nts_env->reclaimed++;
    nts_free(dead);
  }
  nts_env->draining = false;
  /* Candidate additions during the drain could not collect: their count
   * words were links. Revisit admission once every death is settled. */
  nts_maybe_collect();
}

/* --- The cycle collector ---------------------------------------------------
 *
 * Reference counting reclaims everything the moment it becomes garbage, except
 * a cycle: every object in one is held by another object in the same one, so no
 * count reaches zero and the last release never happens. It takes one line of
 * TypeScript to build (`this.next = this`), so this is not a hypothetical.
 *
 * Trial deletion, after Bacon and Rajan. A release that does *not* reach zero
 * might have removed the last reference from outside a cycle, so the object
 * becomes a candidate. Collection then asks, of the subgraph reachable from the
 * candidates: if every reference that comes from inside this subgraph were
 * removed, would anything still be referenced? Whatever would not is garbage,
 * and the counts are put back for whatever would.
 *
 * Two things keep this off programs that do not need it. A type that cannot
 * lead back to itself can never be in a cycle, and the compiler works out which
 * those are, so most releases never buffer anything at all. And an object whose
 * count reaches zero is reclaimed by counting as before -- the collector only
 * ever sees what counting could not.
 *
 * The traversals are iterative. The recursive form is what the paper gives and
 * what is easiest to read, but its depth is the depth of the object graph, and
 * a long list reachable from one candidate would be a C stack frame per link.
 */

/* Candidate roots, and the shared worklist the traversals run on. */

/* Collection runs when this many candidates have accumulated. Any threshold is
 * a guess; what it trades is promptness against how often the walk happens, and
 * a program that wants to decide for itself calls `nts_collect_cycles`. */
/* PHP's `GC_ROOT_BUFFER_MAX_ENTRIES`, which implements the same paper. It is a
 * bound for a program that makes cycles faster than it reaches a checkpoint;
 * the checkpoint pass is what actually keeps a normal program flat.
 *
 * A generational scheme -- a small nursery, mature roots aged separately -- is
 * the usual next step, and the measurement does not support building one here.
 * 20,000 checkpoint collections cost 2ms with no live cycles kept and 3ms with
 * five thousand, so the pass is already flat in the size of the live set: a
 * candidate found live is taken out of the buffer and is not looked at again
 * unless something decrements it. Generations pay for themselves where mature
 * candidates *accumulate*, and here they do not. */
#define NTS_COLLECT_THRESHOLD 10000u

/* Fixed between collections: at least 10,000 candidates, or the allocations
 * still live after the last pass. Survivors make tracing a large live graph
 * amortised rather than repeated at every small batch (json-stringify-doc).
 *
 * Do not derive this bound from the live count while garbage accumulates.
 * That count includes a dead buffered array AND its backing allocation, but
 * Roots has only its header. live_count/2 can grow just ahead of every newly
 * added candidate forever; 317 parses reached 1,268,638 roots with epoch 0.
 * A bound fixed by the last pass cannot be raised by the garbage it must find.
 * Recheck after destruction too: a drain can defer admission while count words
 * hold dying-list links. The public release fast path remains unchanged. */
static size_t nts_collect_threshold(void) {
  size_t at = nts_env->collect_at;
  return at > NTS_COLLECT_THRESHOLD ? at : NTS_COLLECT_THRESHOLD;
}

static void nts_maybe_collect(void) {
  if (!nts_env->draining && !nts_env->collecting &&
      nts_env->roots_len >= nts_collect_threshold()) {
    nts_collect_cycles();
  }
}

static void nts_push(NtsHeader ***buffer, size_t *len, size_t *cap,
                     NtsHeader *object) {
  if (*len == *cap) {
    size_t grown = *cap ? *cap * 2u : 64u;
    NtsHeader **moved =
        (NtsHeader **)realloc((void *)*buffer, grown * sizeof(NtsHeader *));
    if (!moved) {
      fprintf(stderr, "nts: out of memory collecting cycles\n");
      abort();
    }
    *buffer = moved;
    *cap = grown;
  }
  (*buffer)[(*len)++] = object;
}

static void nts_work_push(NtsHeader *object) {
  nts_push(&nts_env->work, &nts_env->work_len, &nts_env->work_cap, object);
}

static uint32_t nts_color(const NtsHeader *object) {
  return object->flags & NTS_COLOR_MASK;
}

static void nts_paint(NtsHeader *object, uint32_t color) {
  object->flags = (object->flags & ~NTS_COLOR_MASK) | color;
}

/* The two producers -- decrements and fallen foreign holders -- share the
 * metadata contract. A holder has no heap prefix; its family keeps its header
 * valid until collector processing and its old deferred lifetime is retained.
 */
static void nts_buffer_root(NtsHeader *object) {
  if (object->flags & NTS_BUFFERED) {
    return;
  }
  object->flags |= NTS_BUFFERED;
#ifdef NTS_PROVIDER_RC
#if NTS_POISON
  if (!nts_is_holder(object) && nts_root_index(object) != NTS_ROOT_NONE) {
    fprintf(stderr, "nts: buffering an allocation with a stale roots index\n");
    abort();
  }
#endif
  if (!nts_is_holder(object)) {
    nts_root_index_store(object, nts_env->roots_len);
  }
#endif
  nts_push(&nts_env->roots, &nts_env->roots_len, &nts_env->roots_cap, object);
  nts_env->candidates++;
}

/* A non-zero decrement may have cut the last reference from outside a cycle.
 * Conservative cyclic descriptors stay conservative. */
static void nts_possible_root(NtsHeader *object) {
  if (!object->descriptor->cyclic || nts_color(object) == NTS_PURPLE) {
    return;
  }
  nts_paint(object, NTS_PURPLE);
  nts_buffer_root(object);
}

/* The whole release of a counted object -- not null, not immortal -- out of
 * line. `nts_release` calls it for everything it does not decide inline: a
 * count reaching zero, an object already dying, and a release of a type that
 * can lead back to itself whose object is not yet a cycle candidate, which may
 * buffer it and start a collection. A rare release inside a function that is
 * itself inlined everywhere calls it directly, so the fast path is not copied
 * there for nothing (`nts_str_append`'s growth). */
static NTS_NOINLINE void nts_release_counted(NtsHeader *object);

void nts_release(NtsHeader *object) {
#ifdef NTS_COUNT_OPERATIONS
  nts_env->releases++;
#endif
  if (!object) {
    return;
  }
  const uintptr_t count = object->reserved;
  if (count == NTS_IMMORTAL) {
    return;
  }
  /* The common release: a reference given back while others remain. A dying
   * object is the rest's -- its count word is the dying list's link. */
  if (count > 1 && (object->flags & NTS_DYING) == 0) {
    /* Of a type no cycle can pass through: no candidate to buffer and no
     * collection to start. */
    if (!object->descriptor->cyclic) {
      object->reserved = count - 1;
      return;
    }
    /* Of one a cycle can, already a candidate. All `nts_possible_root` does
     * for it is mark it purple again, and the buffer does not grow, so this
     * cannot be the release that reaches the collection threshold; one that
     * came due while a collection could not run waits for the next new
     * candidate or the next checkpoint. A linked list or a tree moved and
     * walked is released this way over and over -- each move retains (black)
     * and releases (purple) the same few objects -- and the call around it was
     * a quarter of `awfy-towers`: 49.2 -> 35.2 us, `awfy-list` 18.3 -> 12.1. */
    if ((object->flags & NTS_BUFFERED) != 0) {
      object->reserved = count - 1;
      object->flags = (object->flags & ~NTS_COLOR_MASK) | NTS_PURPLE;
      return;
    }
  }
  nts_release_counted(object);
}

static NTS_NOINLINE void nts_release_counted(NtsHeader *object) {
  /* Already dying, so its count word is the dying list's next pointer and
   * decrementing it would corrupt the list -- which is what freed
   * `Promise.all`'s values array out from under a live reader.
   *
   * This arrives constantly and is not an error. `nts_release_contents` on one
   * dying object walks a field pointing at another, and the collector puts
   * every zero-count black root through this same drain in one pass, so two
   * objects that die together will each release the other. Ignoring it is
   * *right* rather than merely safe: the object is being freed either way, and
   * the reference being given up is one the destroy already accounts for. */
  if ((object->flags & NTS_DYING) != 0) {
    return;
  }
  if (object->reserved > 1) {
    object->reserved--;
    nts_possible_root(object);
    /* Not while destroying: the dying list keeps its next pointer in the
     * count word, so an object on it has no count for the collector to
     * read. */
    nts_maybe_collect();
    return;
  }

  object->reserved = 0;
  /* A string holds nothing -- no references, no erased or foreign slots, its
   * units in its own block -- so its death is the block and the count, and
   * nothing else the general path does applies to it. It ran anyway: the
   * dying list, a walk of no references, of no erased slots and of no foreign
   * ones, for every temporary a serializer builds and appends: 9% of
   * `json-stringify-typed`, 7% of `-inline`. It is never a candidate either (a
   * string cannot lead back to itself), so the buffered case below is not one
   * it can be in. */
  if (object->descriptor->kind == NTS_KIND_STRING) {
    nts_free_string(object);
    return;
  }
  nts_paint(object, NTS_BLACK);
  if (object->flags & NTS_BUFFERED) {
    /* Ordinary managed death removes the candidate entry before returning
     * storage (`nts_destroy`). During collector walks, removal must wait: an
     * emptied shell keeps the entry valid until the next pass. In either case
     * its contents go now -- a button in an `unknown[]` must be given back
     * when the array goes (`examples/interop/gtk-values` under counting).
     *
     * A holder has no heap prefix for an index, so keeps the old timing.
     * What it holds is its family's to give back, and the collector does that
     * when it reclaims the holder. */
    if (!nts_is_holder(object)) {
      nts_destroy(object);
    } else {
      nts_maybe_collect();
    }
    return;
  }
  nts_destroy(object);
}

/* Remove, from the subgraph reachable from the candidates, every reference that
 * comes from inside it. What is left counted is referenced from outside. */
static void nts_mark_gray_child(NtsHeader *child) {
  if (child->reserved != NTS_IMMORTAL) {
    child->reserved--;
  }
  nts_work_push(child);
}

static void nts_mark_gray(NtsHeader *root) {
  nts_env->work_len = 0;
  nts_work_push(root);
  while (nts_env->work_len) {
    NtsHeader *object = nts_env->work[--nts_env->work_len];
    if (nts_color(object) == NTS_GRAY || object->reserved == NTS_IMMORTAL) {
      continue;
    }
    nts_paint(object, NTS_GRAY);
    nts_each_reference(object, nts_mark_gray_child, NTS_EDGES_TRACED);
  }
}

/* Put the counts back for everything that turned out to be referenced from
 * outside, and for everything reachable from it. */
static void nts_scan_black_child(NtsHeader *child) {
  if (child->reserved != NTS_IMMORTAL) {
    child->reserved++;
  }
  if (nts_color(child) != NTS_BLACK) {
    nts_paint(child, NTS_BLACK);
    nts_work_push(child);
  }
}

static void nts_scan_black(NtsHeader *root) {
  /* Runs inside `nts_scan`'s loop, so it uses the tail of the same worklist
   * rather than clearing it. */
  size_t floor = nts_env->work_len;
  nts_paint(root, NTS_BLACK);
  nts_work_push(root);
  while (nts_env->work_len > floor) {
    NtsHeader *object = nts_env->work[--nts_env->work_len];
    nts_each_reference(object, nts_scan_black_child, NTS_EDGES_TRACED);
  }
}

static void nts_scan_child(NtsHeader *child) { nts_work_push(child); }

static void nts_scan(NtsHeader *root) {
  nts_env->work_len = 0;
  nts_work_push(root);
  while (nts_env->work_len) {
    NtsHeader *object = nts_env->work[--nts_env->work_len];
    if (nts_color(object) != NTS_GRAY) {
      continue;
    }
    if (object->reserved > 0 && object->reserved != NTS_IMMORTAL) {
      /* Still referenced from outside the subgraph: alive, and so is
       * everything it can reach. */
      nts_scan_black(object);
      continue;
    }
    nts_paint(object, NTS_WHITE);
    nts_each_reference(object, nts_scan_child, NTS_EDGES_TRACED);
  }
}

/* Gather what is left white: referenced only from within the subgraph, which is
 * the definition of a garbage cycle.
 *
 * Gather, not free. Freeing during the walk is the obvious thing and it is
 * wrong: two objects in a cycle point at each other, so after the first is
 * freed the second still names it, and the walk reads a color out of memory
 * that is gone. The recursive form the paper gives frees *after* recursing,
 * which has the same effect; a worklist has to say so. */

/* Candidates that reached zero while the buffer held them. They are reclaimed
 * at the very end of a collection and never during one -- see the reclaim pass
 * in `nts_collect_cycles` for why the timing is the whole point. */

static void nts_collect_white_child(NtsHeader *child) { nts_work_push(child); }

static void nts_gather_white(NtsHeader *root) {
  nts_env->work_len = 0;
  nts_work_push(root);
  while (nts_env->work_len) {
    NtsHeader *object = nts_env->work[--nts_env->work_len];
    if (nts_color(object) != NTS_WHITE || (object->flags & NTS_BUFFERED)) {
      continue;
    }
    nts_paint(object, NTS_BLACK);
    nts_each_reference(object, nts_collect_white_child, NTS_EDGES_TRACED);
    nts_push(&nts_env->dead, &nts_env->dead_len, &nts_env->dead_cap, object);
  }
}

/* One collection pass: mark, scan, gather, free, then reclaim the candidates
 * that reached zero while buffered. Answers whether it freed anything. */
static bool nts_collect_pass(void) {
  nts_env->collecting = true;

  /* Mark. A candidate that is no longer purple was retained since it was
   * buffered, so it is reachable and not a root; one whose count reached zero
   * while buffered was left for exactly this moment. */
  size_t kept = 0;
  for (size_t index = 0; index < nts_env->roots_len; index++) {
    NtsHeader *root = nts_env->roots[index];
    if (nts_color(root) == NTS_PURPLE && root->reserved > 0 &&
        root->reserved != NTS_IMMORTAL) {
      nts_mark_gray(root);
      nts_env->roots[kept] = root;
#ifdef NTS_PROVIDER_RC
      if (kept != index && !nts_is_holder(root)) {
        nts_root_index_store(root, kept);
      }
#endif
      kept++;
      continue;
    }
    nts_root_clear(root);
    if (nts_color(root) == NTS_BLACK && root->reserved == 0 &&
        !nts_is_holder(root)) {
      /* Set aside, not destroyed. Destroying here runs real releases in the
       * middle of trial deletion, and a release that takes an already-gray
       * root to zero repaints it black -- after which `nts_scan` skips it for
       * not being gray, `nts_gather_white` skips it for not being white, and
       * emptying the buffer below drops the last pointer to it. One object per
       * collection, leaked in a way no count disagrees about: a linked list
       * built head-first leaked exactly one link at every length above two. */
      nts_push(&nts_env->zeroed, &nts_env->zeroed_len, &nts_env->zeroed_cap,
               root);
    }
  }
  nts_env->roots_len = kept;

  for (size_t index = 0; index < nts_env->roots_len; index++) {
    nts_scan(nts_env->roots[index]);
  }

  /* Collect. The buffered flag is cleared first for every root, because
   * `nts_collect_white` refuses to free anything still buffered -- which is
   * how a root that is white but still in the buffer stays reachable until
   * its own turn. */
  for (size_t index = 0; index < nts_env->roots_len; index++) {
    nts_root_clear(nts_env->roots[index]);
  }
  nts_env->dead_len = 0;
  for (size_t index = 0; index < nts_env->roots_len; index++) {
    nts_gather_white(nts_env->roots[index]);
  }
  nts_env->roots_len = 0;

  /* Every one of these is garbage and every reference between them has
   * already been accounted for, so this frees the memory and nothing else --
   * releasing contents here would decrement counts a second time.
   *
   * In three passes, because freeing is not silent. Giving up a foreign slot
   * can finalize a foreign object, and a finalizing GObject runs its
   * handlers' notifies, each of which releases a lent closure -- one of these,
   * possibly, not yet reached. So every one is marked dying first, which a
   * release ignores (see `nts_release`); then each garbage node is severed, its
   * object disconnecting the closures it held, whose notifies meet the same
   * mark; and only then is anything freed. */
  /* **Nothing foreign runs while `roots` is live.** A notify can release an
   * object to a non-zero count, which buffers it -- `nts_push` onto `roots`,
   * which may move the array under a walk still indexing it. The candidate
   * walks are all above, and `roots_len` is zero from here; a reorder that
   * moved severing up would corrupt quietly, so it is refused loudly. */
  if (nts_env->roots_len != 0) {
    fprintf(stderr, "nts: the collector reached foreign code with candidates "
                    "still being walked\n");
    abort();
  }
  bool freed = nts_env->dead_len > 0 || nts_env->zeroed_len > 0;
  for (size_t index = 0; index < nts_env->dead_len; index++) {
    if (!nts_is_holder(nts_env->dead[index])) {
      nts_env->dead[index]->flags |= NTS_DYING;
    }
  }
  for (size_t index = 0; index < nts_env->dead_len; index++) {
    NtsHeader *dead = nts_env->dead[index];
    if (nts_is_holder(dead)) {
      /* Out of the list before the family runs: severing may free the node,
       * and the pass below must not read it to learn that it was one. */
      nts_env->dead[index] = NULL;
      nts_holders[dead->length]->sever(dead);
    }
  }
  for (size_t index = 0; index < nts_env->dead_len; index++) {
    NtsHeader *dead = nts_env->dead[index];
    if (dead != NULL) {
      nts_env->reclaimed++;
      nts_free(dead);
    }
  }
  nts_env->dead_len = 0;

  /* Now, with every count settled and the buffer already empty, reclaim what
   * was found dead at the start. Nearly all of it is emptied shells: a
   * candidate gives its contents back the moment its count reaches zero
   * (`nts_release`), so only its memory was left, and that is freed here
   * without walking it -- releasing what it held a second time would take
   * counts below the truth. Anything else zeroed is destroyed as usual, and
   * nothing here can free memory the walks above still name: a zeroed root's
   * references were never trial-deleted, so every child of one keeps a count
   * it did not get from inside the subgraph and cannot have been painted
   * white.
   *
   * These cannot reach each other -- a zeroed object is one nothing points at
   * -- so no entry in this list is freed twice. */
  for (size_t index = 0; index < nts_env->zeroed_len; index++) {
    NtsHeader *zeroed = nts_env->zeroed[index];
    if (zeroed->flags & NTS_DYING) {
      nts_env->reclaimed++;
      nts_free(zeroed);
    } else {
      nts_destroy(zeroed);
    }
  }
  nts_env->zeroed_len = 0;
  nts_env->collecting = false;
  return freed;
}

/* **A collection leaves nothing it could collect.** A pass releases objects
 * after its walks -- severing a holder runs its family's releases, and the
 * reclaim destroys what was zeroed -- and one taken to zero while it is itself
 * buffered, a cycle candidate the program let go of earlier, becomes an emptied
 * shell that the buffer still names, left for the next pass by the design the
 * reclaim pass explains. So one pass could return with garbage still in the
 * buffer, and every caller that asks this question means "now":
 * the leak check after a run (a rejection reason with an `unknown` field,
 * passed through `.finally` then `.catch`, was counted held: it was the
 * reason, freed by the next collection), and a host's end-of-document check.
 *
 * Passes repeat while one freed something and left candidates behind. Each
 * repeat follows a pass that freed at least one object, so it ends. */
void nts_collect_cycles(void) {
  if (nts_env->collecting) {
    return;
  }
  /* Not inside a region's call: what a collection frees would be counted in
   * the region's window, and nothing the call made is a candidate anyway. One
   * that came due waits for the next candidate or the next checkpoint, as one
   * due during a collection does. */
  if (nts_env->region) {
    return;
  }
  while (nts_collect_pass() && nts_env->roots_len > 0) {
  }
  nts_env->collect_at = nts_env->allocated - nts_env->reclaimed;
  nts_env->epoch++;
}

size_t nts_cycle_candidates(void) { return nts_env->candidates; }

uint64_t nts_collection_epoch(void) { return nts_env->epoch; }

/* Rendered the way a person reading a crash needs it, which is not the way
 * `String(e)` would: this is the end of the program, so a thrown object prints
 * whatever the compiler could tell us about it and otherwise says plainly that
 * it was an object. */
/* The innermost landing, per environment: a throw is a lane-local event and an
 * environment is what a lane owns. */
void nts_landing_push(NtsLanding *landing) {
  if (!landing) {
    return;
  }
  landing->previous = nts_env->landing;
  landing->thrown = nts_value_of_undefined();
  landing->detail = NULL;
  nts_env->landing = landing;
}

void nts_landing_pop(NtsLanding *landing) {
  if (landing && nts_env->landing == landing) {
    nts_env->landing = landing->previous;
  }
}

NtsValue nts_landing_thrown(const NtsLanding *landing) {
  return landing ? landing->thrown : nts_value_of_undefined();
}

const NtsString *nts_landing_detail(const NtsLanding *landing) {
  return landing ? landing->detail : NULL;
}

/* A raise in flight, which is the *other* way a throw leaves a function.
 *
 * `nts_uncaught` ends the program and `NtsLanding` jumps past frames. This
 * does neither: `nts_raise` records the value and returns, the compiled
 * function returns normally straight afterwards, and its caller tests
 * `nts_raising` and branches. Every frame between the throw and the handler is
 * left by an ordinary `return`, so the releases reference counting put on those
 * edges all run -- which is the whole reason this exists beside a `jmp_buf`
 * that would be shorter.
 *
 * **One slot, not a stack.** A raise is in flight between the `nts_raise` that
 * records it and the check that takes it, and there is exactly one compiled
 * frame returning in between. It cannot nest: a second raise would have to come
 * from code running while the first is in flight, and nothing runs there.
 *
 * Per environment for the reason a landing is: a throw is a lane-local event.
 * In the cold half of the struct beside `landing`, because a program with no
 * `try` around a call never touches it. */
void nts_raise(NtsValue value) {
  nts_env->raised = value;
  nts_env->raising = 1;
}

int nts_raising(void) { return nts_env->raising; }

/* Take it, which is what a handler does on entry: the value is the handler's
 * now and leaving the flag set would make the next check fire on a raise that
 * has already been handled. */
NtsValue nts_raise_take(void) {
  NtsValue value = nts_env->raised;
  nts_env->raised = nts_value_of_undefined();
  nts_env->raising = 0;
  return value;
}

const char *nts_thrown_class(NtsValue value) {
  if (!NTS_TAG_IS_MANAGED(nts_value_tag(value))) {
    return NULL;
  }
  const NtsHeader *object = nts_value_reference(value);
  return object && object->descriptor ? object->descriptor->name : NULL;
}

/* A callback bridge is entering compiled code. Paired with `nts_callback_leave`
   around the call and nothing else, so the count is the number of foreign
   frames between here and the outermost landing. */
/* A C library calling back into compiled code, on the thread that owns this
 * environment.
 *
 * The check is the same one `nts_promise_join` makes, for the same reason:
 * everything below here -- `in_callback`, the reference counts, the heap -- is
 * plain memory reached through a `_Thread_local` pointer that *defaults to one
 * shared environment*. A second thread entering here increments `in_callback`
 * without synchronisation and allocates against another thread's heap.
 *
 * **What it catches and what it does not.** `nts_is_owner_thread` delegates to
 * a host, so an embedder that installed one gets a stop here instead of a
 * race. A standalone program has installed no host and the answer is
 * unconditionally true, so a foreign thread reaches this undetected -- the
 * runtime has no way of its own to know which thread owns it, and inventing
 * one here would be a second answer to a question the host already owns.
 * Stated rather than papered over. */
void nts_callback_enter(void) {
  if (!nts_is_owner_thread()) {
    fprintf(stderr, "nts: a callback entered compiled code from a thread this "
                    "environment does not own\n");
    abort();
  }
  nts_environment_current()->in_callback++;
}
/* The task `nts_callback_leave` posts for a callback that returned to
 * compiled code: empty, since `nts_task_run`'s checkpoint around it is the
 * point. */
static void nts_posted_checkpoint(void *state) {
  (void)state;
  nts_environment_current()->checkpoint_posted = false;
}

void nts_callback_leave(void) {
  NtsEnvironment *environment = nts_environment_current();
  environment->in_callback--;
  /* A foreign loop handing control back: the outermost callback has returned
   * and no compiled task is running (`depth` 0), so this is the loop's turn
   * ending, and node checkpoints at every one of those. Entered from a task
   * instead -- a `g_signal_emit` inside a timer -- `depth` is not 0, and the
   * task's own `nts_leave` is the checkpoint, after it runs to completion. */
  if (environment->checkpoint_after_callbacks &&
      environment->in_callback == 0 && environment->depth == 0) {
    if (environment->returns_to_loop == NULL ||
        environment->returns_to_loop()) {
      nts_checkpoint();
    } else if (!environment->checkpoint_posted) {
      /* Compiled code below, which runs on first: the jobs at the loop's next
       * turn, or after module evaluation, whichever is first. */
      environment->checkpoint_posted = true;
      nts_post_task(
          (NtsTask){.run = nts_posted_checkpoint, .drop = NULL, .state = NULL});
    }
  }
}

bool nts_in_callback(void) {
  return nts_environment_current()->in_callback != 0;
}

void nts_checkpoint_after_callbacks(bool on) {
  nts_environment_current()->checkpoint_after_callbacks = on;
}

void nts_callbacks_return_to_loop_when(bool (*at_loop)(void)) {
  nts_environment_current()->returns_to_loop = at_loop;
}

_Noreturn void nts_no_arm(const char *member) {
  fprintf(stderr,
          "nts: reading `%s` through a value no arm of its chain recognised; "
          "the set of inhabiting layouts was not an over-approximation\n",
          member);
  abort();
}

_Noreturn void nts_refused(const NtsString *what) {
  fflush(stdout);
  fputs("nts: refused at run time: ", stderr);
  for (uint32_t at = 0; what && at < what->length; at++) {
    fputc((int)nts_unit(what, at), stderr);
  }
  fputc('\n', stderr);
  abort();
}

_Noreturn void nts_assertion_failed(const NtsString *what) {
  fflush(stdout);
  fputs("nts: refused: ", stderr);
  for (uint32_t at = 0; what && at < what->length; at++) {
    fputc((int)nts_unit(what, at), stderr);
  }
  fputc('\n', stderr);
  exit(EXIT_FAILURE);
}

_Noreturn void nts_no_arm_of(NtsValue subject, const NtsString *member) {
  const char *name = "a value with no descriptor";
  if (NTS_TAG_IS_MANAGED(nts_value_tag(subject))) {
    const NtsHeader *header = (const NtsHeader *)nts_value_reference(subject);
    if (header != 0 && header->descriptor != 0 &&
        header->descriptor->name != 0) {
      name = header->descriptor->name;
    }
  }
  fputs("nts: calling `", stderr);
  /* Unit by unit, as `nts_uncaught` prints its detail: a managed string is not
     NUL-terminated and converting it here would allocate on the abort path. */
  if (member != 0) {
    for (uint32_t at = 0; at < member->length; at++) {
      fputc((int)nts_unit(member, at), stderr);
    }
  }
  fprintf(stderr,
          "` on a value no arm of its chain recognised -- it is `%s`, tag %u, "
          "and the set of inhabiting classes did not list it\n",
          name, nts_value_tag(subject));
  abort();
}

_Noreturn void nts_uncaught(NtsValue value, const NtsString *detail) {
  /* An embedder with somewhere to put it gets it, and the process survives.
     Popped here rather than by the caller, because the caller is reached by a
     jump and the frame it lands in is no longer the innermost one. */
  /* A callback's throw stops here rather than jumping over the C frames that
     called it. There is nowhere to deliver it to: a C function pointer's
     signature has no error channel, and inventing a return value would be
     worse than stopping -- a comparator that answers 0 because it failed sorts
     the array wrongly and says nothing. */
  if (nts_env->in_callback != 0) {
    fputs("nts: a callback threw across a C boundary that cannot carry it: ",
          stderr);
    if (detail) {
      for (uint32_t at = 0; at < detail->length; at++) {
        fputc((int)nts_unit(detail, at), stderr);
      }
    } else {
      fputs("(no message)", stderr);
    }
    fputc('\n', stderr);
    /* `exit` for the reasons the uncaught path below gives -- an observable
       status and a flushed `stdout` -- and status 1 because from the outside
       this *is* an uncaught throw. What differs is only that it could not be
       offered to a landing first. */
    exit(1);
  }
  NtsLanding *landing = nts_env->landing;
  if (landing) {
    nts_env->landing = landing->previous;
    landing->thrown = value;
    landing->detail = detail;
    longjmp(landing->frame, 1);
  }
  fputs("nts: uncaught ", stderr);
  const NtsString *text = NULL;
  switch (nts_value_tag(value)) {
  case NTS_TAG_STRING:
    text = (const NtsString *)nts_value_reference(value);
    break;
  case NTS_TAG_NUMBER:
    fprintf(stderr, "%g", nts_value_number(value));
    break;
  case NTS_TAG_BOOLEAN:
    fputs(nts_value_boolean(value) ? "true" : "false", stderr);
    break;
  case NTS_TAG_UNDEFINED:
    fputs("undefined", stderr);
    break;
  case NTS_TAG_NULL:
    fputs("null", stderr);
    break;
  default: {
    /* An object or a function. A descriptor does name the class it describes --
     * `Error`, `TypeError`, whatever a user subclass is called -- so this half
     * needs nothing from the compiler; only `message` does, being a field. The
     * two together read the way node's uncaught line does. */
    const NtsHeader *object = nts_value_reference(value);
    const char *class_name =
        object && object->descriptor ? object->descriptor->name : NULL;
    fputs(class_name ? class_name : "[object]", stderr);
    if (detail) {
      fputs(": ", stderr);
      text = detail;
    }
    break;
  }
  }
  if (text) {
    /* Narrow strings are the common case and the only one worth spelling
     * carefully; a wide one is dumped as its code units rather than not at
     * all. */
    for (uint32_t at = 0; at < text->length; at++) {
      fputc((int)nts_unit(text, at), stderr);
    }
  }
  fputc('\n', stderr);
  /* `exit` rather than `abort`, on two counts. Node ends an uncaught throw with
   * status 1, and an exit status is observable, so the differential would read
   * 134 against its 1. And `abort` does not flush: anything the program had
   * already written to a buffered `stdout` would be lost, while node prints it.
   * The other aborts in this file are compiler or runtime invariants, where a
   * core file is the point; this one is a program doing something the language
   * allows. */
  exit(1);
}

bool nts_is_class(NtsValue value, const NtsDescriptor *klass) {
  if (!NTS_TAG_IS_MANAGED(nts_value_tag(value))) {
    return false;
  }
  const NtsHeader *object = nts_value_reference(value);
  return object && object->descriptor == klass;
}

double nts_promise_state(const NtsPromise *promise) {
  return promise ? (double)promise->state : (double)NTS_PROMISE_PENDING;
}

bool nts_is_buffer(NtsValue value) {
  if (!NTS_TAG_IS_MANAGED(nts_value_tag(value))) {
    return false;
  }
  const NtsHeader *object = nts_value_reference(value);
  return object && object->descriptor &&
         object->descriptor->kind == NTS_KIND_BUFFER;
}

/* An erased value read back as an array of erased values -- `h as unknown[]`,
 * or an `unknown[]` slot's value out of an `unknown` -- which is a claim about
 * the array's elements the object may not keep: an `unknown` can hold any
 * array, and a `number[]` is eight-byte doubles where this reads sixteen-byte
 * values. A write through the claim stored a value's bits into a double's slot.
 * So the claim is checked, as an unerase to a class is, and anything other than
 * an array of values stops by name. NULL is the absent value a nullable array
 * is. Hands back the same array without retaining it. */
NtsArray *nts_array_of_values(NtsArray *array) {
  if (!array) {
    return NULL;
  }
  const NtsDescriptor *descriptor = array->header.descriptor;
  if (descriptor->kind == NTS_KIND_ARRAY && descriptor->erased) {
    return array;
  }
  fflush(stdout);
  fputs("nts: refused at run time: an array read as `unknown[]` whose "
        "elements are not erased values, which this compiler holds as "
        "another kind of element\n",
        stderr);
  abort();
}

bool nts_is_array(NtsValue value) {
  if (!NTS_TAG_IS_MANAGED(nts_value_tag(value))) {
    return false;
  }
  const NtsHeader *object = nts_value_reference(value);
  if (!object || !object->descriptor) {
    return false;
  }
  return object->descriptor->kind == NTS_KIND_ARRAY ||
         object->descriptor->kind == NTS_KIND_TUPLE;
}

/* A `const` read through a closure before its declaration ran.
 *
 *     const read = () => later;   // the cell exists, holding nothing
 *     run(read);                  // <- here
 *     const later = 1;
 *
 * JavaScript throws a `ReferenceError`. Nothing here throws, so this stops the
 * program and names the variable rather than letting the read answer with the
 * zero the cell still holds. */
void nts_cell_unready(const char *name) {
  fprintf(stderr, "nts: `%s` was read before its declaration ran\n", name);
  abort();
}

/* `String(v)` where `v` carries its own tag. Primitives spell themselves;
 * objects ask their descriptor, whose selected printer can return a null
 * string placeholder with a language raise pending. Forward both unchanged:
 * only the compiled conversion boundary takes and throws that payload.
 *
 * A successful result is owned. A string already in the value is retained
 * rather than copied, which makes `String(s)` free when s was already text. */
NtsString *nts_value_to_string(NtsValue value) {
  switch (nts_value_tag(value)) {
  case NTS_TAG_UNDEFINED:
    return nts_string_from_utf8("undefined", 9);
  case NTS_TAG_NULL:
    return nts_string_from_utf8("null", 4);
  case NTS_TAG_BOOLEAN:
    return nts_bool_to_string(nts_value_boolean(value));
  case NTS_TAG_NUMBER:
    return nts_number_to_string(nts_value_number(value));
  case NTS_TAG_BIGINT:
    return nts_bigint_to_string(
        nts_bigint_unbox((const NtsBigIntBox *)nts_value_reference(value)));
  case NTS_TAG_STRING: {
    NtsString *text = (NtsString *)nts_value_reference(value);
    nts_retain((NtsHeader *)text);
    return text;
  }
  /* `SymbolDescriptiveString` -- `"Symbol("`, the description, `")"`. The one
   * conversion the language allows *only* through `String`: `sym + ""` throws
   * a TypeError by 13.15.3, so no implicit coercion reaches here and this arm
   * is reached solely by a `String()` the source wrote.
   *
   * Its typed sibling has existed for a while; what was missing was this one,
   * for a symbol arriving in an erased slot. `String(type)` where
   * `type: string | symbol` is node's `events`, and it is under
   * `MaxListenersExceededWarning`, `warnMaxListenersExceeded`, `addListener`
   * and therefore `EventEmitter#on`. */
  case NTS_TAG_SYMBOL:
    return nts_symbol_to_string((const NtsSymbol *)nts_value_reference(value));
  /* An object or a function prints as its type says it does
   * (`NtsDescriptor.to_string`), and a type no one taught to print stops by
   * name rather than answering `"[object Object]"` for it. */
  case NTS_TAG_OBJECT:
  case NTS_TAG_FUNCTION: {
    const NtsHeader *object = nts_value_reference(value);
    if (object && object->descriptor && object->descriptor->to_string) {
      return object->descriptor->to_string(object);
    }
    fprintf(stderr,
            NTS_REFUSED "String() of `%s`, whose type says nothing "
                        "about how it prints\n",
            object && object->descriptor && object->descriptor->name
                ? object->descriptor->name
                : "?");
    abort();
  }
  default:
    fprintf(stderr,
            NTS_REFUSED "String() of tag %u, which the lowering should have "
                        "refused\n",
            nts_value_tag(value));
    abort();
  }
}

/* `BigInt(x)` on a number, which is a conversion with a precondition.
 *
 * The specification throws a `RangeError` when the value is not an integer --
 * `BigInt(1.5)` is not `1n` -- so a plain cast would be a wrong answer rather
 * than a lossy one. There is no `throw` to raise here, and the same is true of
 * an index past the end of an array, so this refuses the way that does.
 *
 * The second bound is ours rather than the language's: this `bigint` is 128
 * bits, and a double above 2^127 has no value here to convert to. That is the
 * boundary `docs/language/numbers.md` argues for, refused where it is crossed
 * rather than wrapped silently. */
__int128 nts_bigint_from_number(double value) {
  if (!(value == nts_to_integer(value))) {
    fprintf(stderr, NTS_REFUSED "%g is not an integer, so it has no bigint\n",
            value);
    abort();
  }
  /* Asymmetric, because two's complement is. `1.7014118346046923e38` is
   * exactly 2^127, the largest signed 128-bit integer is 2^127 - 1, and
   * converting the accepted positive endpoint is undefined -- UBSan says so.
   * The negative endpoint is exactly representable and valid, and the next
   * double below +2^127 is valid, so the interval is closed on the left and
   * open on the right. Hex float literals rather than a decimal spelling
   * because the boundary is a power of two and this says which one. */
  if (!(value >= -0x1p127 && value < 0x1p127)) {
    fprintf(stderr, NTS_REFUSED "%g is outside the 128 bits a bigint has\n",
            value);
    abort();
  }
  return (__int128)value;
}

_Noreturn void nts_bounds(double index, uint32_t length) {
  fprintf(stderr, NTS_REFUSED "index %g is outside [0, %u)\n", index, length);
  abort();
}

/* The shared part: everything but deciding what the elements start as. */
static NtsArray *nts_array_allocate(const NtsDescriptor *descriptor,
                                    double length) {
  /* **2^31 - 1, not 2^32 - 1**, and the narrower bound is what makes the
   * compiler's type for a length honest rather than convenient.
   *
   * `NtsHeader.length` is a `uint32_t`, so the storage would hold twice this.
   * What the *compiler* wants is for `array.len` to be an `int32`: an `i64`
   * length makes the loop counter that compares against it an `i64` too, and
   * that is a shape neither backend's optimiser will treat as a counted loop --
   * measured at **13.1x** on `benches/cases/elementwise` against the same loop
   * with an `int` counter, and 32% on `array-predicates`.
   *
   * Signed rather than unsigned because unsigned buys precision about an array
   * no lane can allocate -- 2^31 doubles is 16 GB in one block, and the JVM's
   * own `MAX_ARRAY` is 2^31 - 9 -- and costs an unsigned comparison where a
   * signed one would do.
   *
   * So the type is not a claim about a hypothetical array. It is a consequence
   * of this refusal, which is the same shape as the bigint upper endpoint: a
   * bound the program cannot cross, stated where it is enforced. */
  if (!(length >= 0.0 && length <= NTS_MAX_LENGTH &&
        length == (double)(uint32_t)length)) {
    fprintf(stderr, NTS_REFUSED "%g is not a valid array length\n", length);
    abort();
  }
  uint32_t count = (uint32_t)length;
  /* `nts_alloc` aligns to 16, so 16 more bytes always hold the step up to the
   * next `NTS_ELEMENT_ALIGN` boundary. */
  size_t bytes = sizeof(NtsArray) + (NTS_ELEMENT_ALIGN - 16u) +
                 (size_t)count * descriptor->size;
  NtsArray *array = (NtsArray *)nts_alloc(bytes);
  array->header.descriptor = descriptor;
  array->header.reserved = nts_fresh_count();
  nts_note_allocation();
  array->header.flags = 0;
  array->header.length = count;
  array->capacity = count;
  /* Just past the struct, so an array nothing grows keeps its elements next to
   * its header and reads them with the locality inline storage had -- at the
   * first `NTS_ELEMENT_ALIGN` boundary there. */
  array->elements = nts_array_inline_elements(array);
  return array;
}

/* Zeroed rather than left as holes: there is no `undefined` in a double, so a
 * hole has no representation to leave behind. This is what `new Array(n)` gets,
 * and anything else the source can read before it writes. */
/* The same shape `codegen/c` emits for a `double` element type: kind, element
   size, no references, no erased elements, and a name the runtime prints. */
static const NtsDescriptor nts_desc_number_array = {NTS_KIND_ARRAY,
                                                    (uint32_t)sizeof(double),
                                                    0,
                                                    0,
                                                    0,
                                                    0,
                                                    "double[]",
                                                    0,
                                                    0,
                                                    NTS_ARRAY_FLOAT,
                                                    0u,
                                                    NULL,
                                                    nts_array_to_string,
                                                    NULL,
                                                    NULL,
                                                    NULL};

NtsArray *nts_array_of_numbers(double length) {
  return nts_array_new(&nts_desc_number_array, length);
}

uint32_t nts_array_length(NtsValue array) {
  if (!nts_is_array(array)) {
    fprintf(stderr, NTS_REFUSED "the length of a non-array value\n");
    abort();
  }
  const NtsHeader *object = nts_value_reference(array);
  if (object->descriptor->kind != NTS_KIND_ARRAY) {
    fprintf(stderr,
            NTS_REFUSED "the length of `%s`, a tuple whose indexed storage "
                        "count is not built\n",
            object->descriptor->name ? object->descriptor->name : "?");
    abort();
  }
  return object->length;
}

void nts_array_mark_null_slots(NtsArray *array) {
  if (array != NULL && (array->header.flags & NTS_ARRAY_IMMUTABLE) == 0u) {
    array->header.flags |= NTS_NULL_SLOTS;
  }
}

/* `xs[i]` where the compiler knows `xs` is an array and not what it holds.
 *
 * A guard is what produces this: `Array.isArray(xs)` proves the value is an
 * array without saying anything about its elements, so the read has a
 * descriptor at run time and no element type at compile time. Every static
 * element read is a load at a known width into a known C type; this is the one
 * that has to ask.
 *
 * `size` alone cannot answer. Eight bytes is a `double` or an `int64_t`, and
 * both are emitted -- element narrowing picks a signed 64-bit width for an
 * array that leaves the `i32` range and stays inside the safe integers, so the
 * two descriptors differ in `name` and in nothing else a reader can switch on.
 * That is why `element` exists.
 *
 * Out of range is `undefined` rather than the trap `nts_index` takes, and the
 * difference is not an inconsistency: a static read produces a `double`, which
 * has no way to say "absent", while this produces an `NtsValue`, which does.
 * JavaScript says `undefined` and here it can be said.
 *
 * The result is owned -- retained before it is handed back -- because that is
 * what the ownership pass assumes of a runtime call it has not been told
 * otherwise about, and being wrong in that direction leaks rather than
 * double-frees. */
NtsValue nts_array_element(NtsValue array, double index, uint32_t null_slot) {
  if (!nts_is_array(array)) {
    /* The lowering emits this only under a proof that the value is an array,
     * so reaching it means the proof was wrong rather than the program was. */
    fprintf(stderr,
            NTS_REFUSED "element of a %s, which the lowering proved was an "
                        "array\n",
            nts_value_tag(array) == NTS_TAG_UNDEFINED ? "undefined"
                                                      : "non-array");
    abort();
  }
  const NtsArray *object = (const NtsArray *)nts_value_reference(array);
  const NtsDescriptor *descriptor = object->header.descriptor;
  /* Array identity includes tuples, but their fields are not array slots and
   * their header length is not an element count. Check that capability before
   * bounds; a zero tuple header must not invent an undefined element. */
  if (descriptor->kind != NTS_KIND_ARRAY) {
    fprintf(stderr,
            NTS_REFUSED "an erased read of `%s`, a tuple whose indexed storage "
                        "contract is not built\n",
            descriptor->name ? descriptor->name : "?");
    abort();
  }
  if (!(index >= 0.0 && index < (double)object->header.length &&
        index == (double)(uint32_t)index)) {
    return nts_value_of_undefined();
  }
  uint32_t at = (uint32_t)index;
  switch (descriptor->element) {
  case NTS_ARRAY_VALUE: {
    /* Handed out owned, a handle included: `nts_value_retain`, not a
     * managed-only retain, or the caller's release is one too many. */
    NtsValue element = NTS_ITEMS(object, NtsValue)[at];
    nts_value_retain(element);
    return element;
  }
  case NTS_ARRAY_REFERENCE: {
    NtsHeader *element = NTS_ITEMS(object, NtsHeader *)[at];
    /* Which absence a null slot is, the element type says and the lowering
     * passes: a `(T | null)[]` holds a null, and answering `undefined` read
     * it wrong wherever the read could also be past the end. */
    if (!element) {
      /* Or the array says so itself, where the read site's type is `any[]`
       * and the erasure recorded it (`nts_array_mark_null_slots`). */
      const bool null = null_slot == NTS_TAG_NULL ||
                        (object->header.flags & NTS_NULL_SLOTS) != 0u;
      return null ? nts_value_of_null() : nts_value_of_undefined();
    }
    nts_retain(element);
    return nts_value_of_reference(element, nts_tag_of_reference(element));
  }
  case NTS_ARRAY_FOREIGN:
    /* No tag holds a foreign object, and the lowering never erases one. */
    fprintf(stderr,
            NTS_REFUSED "an erased read of `%s`, an array of foreign objects\n",
            descriptor->name ? descriptor->name : "?");
    abort();
  case NTS_ARRAY_BOOL:
    return nts_value_of_boolean(NTS_ITEMS(object, bool)[at]);
  case NTS_ARRAY_BIGINT:
    return nts_value_of_reference(
        (NtsHeader *)nts_bigint_box(NTS_ITEMS(object, __int128)[at]),
        NTS_TAG_BIGINT);
  case NTS_ARRAY_FLOAT:
    if (descriptor->size == sizeof(float)) {
      return nts_value_of_number((double)NTS_ITEMS(object, float)[at]);
    }
    return nts_value_of_number(NTS_ITEMS(object, double)[at]);
  case NTS_ARRAY_INT:
    switch (descriptor->size) {
    case 1:
      return nts_value_of_number((double)NTS_ITEMS(object, int8_t)[at]);
    case 2:
      return nts_value_of_number((double)NTS_ITEMS(object, int16_t)[at]);
    case 4:
      return nts_value_of_number((double)NTS_ITEMS(object, int32_t)[at]);
    case 8:
      return nts_value_of_number((double)NTS_ITEMS(object, int64_t)[at]);
    default:
      break;
    }
    break;
  case NTS_ARRAY_UINT:
    switch (descriptor->size) {
    case 1:
      return nts_value_of_number((double)NTS_ITEMS(object, uint8_t)[at]);
    case 2:
      return nts_value_of_number((double)NTS_ITEMS(object, uint16_t)[at]);
    case 4:
      return nts_value_of_number((double)NTS_ITEMS(object, uint32_t)[at]);
    case 8:
      return nts_value_of_number((double)NTS_ITEMS(object, uint64_t)[at]);
    default:
      break;
    }
    break;
  default:
    break;
  }
  /* `NTS_ARRAY_UNKNOWN` is a descriptor written before this field existed --
   * every one in this file and in `codegen/c` is taught, and the hand-written
   * ones in `runtime/node` are built without `-Wextra`, so theirs end early and
   * default to zero. Refusing is the whole point of the value: an element read
   * out of a width with no kind would be a plausible number rather than a wrong
   * one, and nothing downstream could tell. */
  fprintf(stderr,
          NTS_REFUSED "element of `%s`, whose descriptor does not say what its "
                      "elements are (kind %u, size %u)\n",
          descriptor->name ? descriptor->name : "?", descriptor->element,
          descriptor->size);
  abort();
}

NtsArray *nts_array_new(const NtsDescriptor *descriptor, double length) {
  NtsArray *array = nts_array_allocate(descriptor, length);
  memset(array->elements, 0, (size_t)array->header.length * descriptor->size);
  return array;
}

/* Not zeroed, for an allocation the compiler fills completely before anything
 * can read it -- `map`'s result, whose loop runs the length it just allocated.
 *
 * Worth 7% on the `pipeline` benchmark, which it takes to parity with
 * hand-written C++. The compiler emits this one only where it can see every
 * slot being written, because the failure mode here is reading uninitialized
 * memory rather than reading a zero. */
NtsArray *nts_array_new_uninitialized(const NtsDescriptor *descriptor,
                                      double length) {
  NtsArray *array = nts_array_allocate(descriptor, length);
#if NTS_POISON
  /* Fill with something that is *not* zero, so that "every slot is written"
   * stops being an argument and becomes a check: a slot this allocation's
   * caller failed to write reads as -1.4e-130 rather than as 0, and any sum
   * over the array says so immediately.
   *
   * Measured rather than assumed: with `map` sabotaged to store nothing, the
   * unwritten slots read as *exactly zero* -- the allocator hands back zeroed
   * pages -- which is indistinguishable from a slot legitimately holding zero,
   * and is precisely the value the old unconditional `memset` produced. A
   * program whose correct answer contains a zero there would agree by
   * accident. Under `NTS_POISON` it cannot: the same sabotage reads
   * `a5d03c3c3c3c3c3c`.
   *
   * The evidence for the whole optimization is that the example suite agrees
   * with node under this define. */
  memset(array->elements, 0xA5,
         (size_t)array->header.length * descriptor->size);
#endif
  return array;
}

/* Where a relative index lands, or -1 for out of range. Negative counts from
 * the end.
 *
 * A length rather than a container, because `Array.prototype.at` and
 * `String.prototype.at` are one rule over two things -- and a rule written
 * twice is a rule that will disagree with itself once. */
static double nts_relative_offset(double at, uint32_t length) {
  at = nts_to_integer(at);
  if (at < 0) {
    at += (double)length;
  }
  return (at < 0 || at >= (double)length) ? -1.0 : at;
}

/* Where an index lands, or -1 for out of range. Negative counts from the end.
 */
static double nts_array_offset(const NtsArray *a, double at) {
  return nts_relative_offset(at, a->header.length);
}

/* Make room for one more element, whatever its width.
 *
 * Split out of `nts_array_push` so that an array of references grows the same
 * way an array of numbers does. Nothing here reads an element: the size comes
 * from the descriptor, which is why the split costs nothing. */
/* Split in two, and the split is the point.
 *
 * The *check* belongs at the call site: `push` is inlined, and asking whether
 * an array is full is a load and a compare that the caller can often fold away
 * entirely. The *growth* does not: it is a `malloc`, a copy of everything and a
 * free, it happens log n times, and inlining it puts the code for the one push
 * that reallocates into all the ones that do not.
 *
 * Marking the whole of `nts_array_reserve` `noinline` was tried first and made
 * `array-predicates` worse than leaving the compiler alone -- because that
 * forced the *check* out of line too, and the check is what runs every time.
 * One call per append, for a comparison. */
static NTS_NOINLINE void nts_array_grow(NtsArray *a) {
  {
    /* Doubling, so a loop of pushes is linear rather than quadratic. The first
     * growth moves the elements out of the block the array itself lives in, and
     * every one after reallocates -- but the array object stays where it is, so
     * nothing holding a reference to it notices. That is the whole reason the
     * elements are not inline. */
    uint32_t wanted = a->capacity ? a->capacity * 2u : 4u;
    size_t bytes = (size_t)wanted * a->header.descriptor->size;
    /* Aligned as inline elements are (`nts_array_inline_elements`): `malloc`
     * promises 16. */
    size_t block =
        (bytes + (NTS_ELEMENT_ALIGN - 1u)) & ~(size_t)(NTS_ELEMENT_ALIGN - 1u);
    void *moved = nts_elements_alloc(block);
    if (!moved) {
      fprintf(stderr, "nts: out of memory growing an array\n");
      abort();
    }
    memcpy(moved, a->elements,
           (size_t)a->header.length * a->header.descriptor->size);
    /* Counted here rather than left to `nts_alloc`, which never sees this
     * block: an array's elements are `malloc`'d directly, so without these two
     * lines `nts_live_bytes` reports the header and calls the elements
     * nothing. That is how the missing free below stayed invisible -- a
     * program that leaked every element block it ever grew measured as holding
     * exactly what it should. */
    nts_env->bytes_held += bytes;
    /* And counted, which it was not.
     *
     * `nts_note_allocation` says "objects, arrays, strings and maps all come
     * through it". An array's *header* did; the block holding its elements
     * did not, so `tooling/memory`'s allocation column read the same number
     * for an array of four and an array of four thousand, and could not have
     * read otherwise. The bytes above were already right -- the paragraph
     * beside them explains that they were added because a leak was invisible
     * without them -- and the count is the same argument one column over.
     *
     * `nts_map_rehash` had this exact hole and was fixed first; a table
     * reallocates as it grows and so does an array, for the same reason and
     * with the same three lines missing. */
    nts_note_allocation();
    if (!nts_array_is_inline(a)) {
      /* Not the inline block, so it was one of ours to free. */
      nts_env->bytes_held -= (size_t)a->capacity * a->header.descriptor->size;
      /* Paired with the note above, or `nts_live_count` -- which is
       * `allocated - reclaimed` -- reads every grown array as a leak. */
      nts_env->reclaimed++;
      nts_elements_free(a->elements);
    }
    a->elements = moved;
    a->capacity = wanted;
  }
}

static inline void nts_array_reserve(NtsArray *a) {
  if (a->header.length == a->capacity) {
    nts_array_grow(a);
  }
}

/* The out-of-line half of `nts_slot_or_grow`: an append, or the abort the
 * in-range check already fell through to.
 *
 * Reached only when the index is *not* a slot the array already has, so this is
 * the log-n path and the one that may `malloc`. The header's comment carries
 * why the split is where it is.
 *
 * The new slot is left holding whatever the allocation did, and the caller
 * stores into it on the very next line -- which is the same contract
 * `nts_array_push` has with itself, one statement apart rather than two. It is
 * sound for exactly the element types that take no reference count, because a
 * counted store first loads what the slot held so that it can release it, and a
 * slot that did not exist a moment ago held nothing to load. */
uint32_t nts_append_slot(NtsArray *a, double index) {
  if (!(index == (double)(uint32_t)index &&
        (uint32_t)index == a->header.length)) {
    nts_bounds(index, a->header.length);
  }
  nts_array_reserve(a);
  a->header.length++;
  return (uint32_t)index;
}

/* Inlined, which is the largest number in `benches/cases/array-predicates`:
 * 3.73us to 2.19us, and past the `std::vector` it is measured against.
 *
 * `filter` appends once per element it keeps, and the whole of an append is a
 * compare, a store and an increment -- so out of line it was 51% of that
 * benchmark's instructions, nearly all of it call overhead. Growing is inside
 * it and stays inside it: marking `nts_array_reserve` `noinline` to keep this
 * one small made the row *worse* than not inlining at all, which is the
 * compiler knowing more about the tradeoff than the attribute does.
 *
 * `nts_array_push_ref` is the same function for a reference element and is not
 * inlined, because nothing here measured it and a number is what ships a
 * change. */
__attribute__((always_inline)) double nts_array_push(NtsArray *a,
                                                     double value) {
  nts_array_reserve(a);
  NTS_ITEMS(a, double)[a->header.length] = value;
  a->header.length++;
  return (double)a->header.length;
}

/* The same methods on an array of references.
 *
 * Every one of the twenty-two profile sites that wanted an array method on a
 * non-numeric array wanted a *reference* element -- strings, objects,
 * closures, an `Int32Array`. Not one wanted an array of booleans, so there is
 * no `_bool` family here: a rule with no case behind it is one nothing keeps
 * honest.
 *
 * `void *` rather than `NtsHeader *` in the argument positions for the reason
 * `nts_array_fill_ref` already uses it: C converts any object pointer to and
 * from `void *` without a cast, so the emitter passes an `NtsString *` or a
 * class pointer straight through and the prototype is the only place the
 * difference would have to be written down.
 *
 * The reference counting is the part worth stating. A parameter is borrowed
 * and a call's result is owned, so `at` retains what it hands back, `pop`
 * retains nothing -- the array is giving up its own count along with the
 * element -- and `slice` retains each element it copies. `reverse` moves
 * pointers within one array and changes no count.
 *
 * `push` is the exception: it *consumes*. The reference it is given moves into
 * the element slot and the array gives it back when it is dropped, so the
 * caller has nothing left to give up. It used to retain, and the caller
 * released its own a moment later -- two operations to move a reference one
 * slot, on every element of every array of objects a program builds.
 *
 * The compiler is the only thing that calls this, from `lower_pushes`, and it
 * knows: `rc::consumes` names this function and the argument it takes. A caller
 * whose value is still live afterwards retains before handing it over, exactly
 * as it would for a store. */
double nts_array_push_ref(NtsArray *a, void *value) {
  nts_array_reserve(a);
  NTS_ITEMS(a, void *)[a->header.length] = value;
  a->header.length++;
  return (double)a->header.length;
}

/* `pop` on an array of references.
 *
 * A null is what it answers for an empty array, and it needs no tag to do it:
 * `T | undefined` for a reference *is* the null pointer, which is the whole
 * reason a `string | null` costs nothing. So this returns the element type
 * directly where the numeric `pop` had to return an erased value. */
void *nts_array_pop_ref(NtsArray *a) {
  if (a->header.length == 0) {
    return NULL;
  }
  a->header.length--;
  return NTS_ITEMS(a, void *)[a->header.length];
}

/* How an array of counted elements counts them: a managed reference through
 * the runtime, a foreign object through its family (`NTS_ARRAY_FOREIGN`). The
 * helpers below that duplicate or drop elements are written once over this
 * pair and instantiated for each: `static inline` with a constant argument, so
 * the `_ref` ones compile to what they were before the pair existed. */
static inline void *nts_count_managed(void *element) {
  nts_retain((NtsHeader *)element);
  return element;
}
static inline void nts_uncount_managed(void *element) {
  nts_release((NtsHeader *)element);
}
static inline const NtsFamilyOps *nts_array_family(const NtsArray *a) {
  return a->header.descriptor->foreign_slots[0].ops;
}

static inline void *nts_array_at_counted(const NtsArray *a, double at,
                                         void *(*retain)(void *)) {
  double offset = nts_array_offset(a, at);
  if (offset < 0) {
    return NULL;
  }
  return retain(NTS_ITEMS(a, void *)[(uint32_t)offset]);
}
void *nts_array_at_ref(const NtsArray *a, double at) {
  return nts_array_at_counted(a, at, nts_count_managed);
}
void *nts_array_at_foreign(const NtsArray *a, double at) {
  return nts_array_at_counted(a, at, nts_array_family(a)->retain);
}
NtsValue nts_array_at_element(const NtsArray *a, double at,
                              uint32_t null_slot) {
  double offset = nts_array_offset(a, at);
  if (offset < 0) {
    return nts_value_of_undefined();
  }
  NtsHeader *element = NTS_ITEMS(a, NtsHeader *)[(uint32_t)offset];
  if (!element) {
    return null_slot == NTS_TAG_NULL ? nts_value_of_null()
                                     : nts_value_of_undefined();
  }
  nts_retain(element);
  return nts_value_of_reference(element, nts_tag_of_reference(element));
}

/* `indexOf` and `includes` by identity, which is what `===` is for an object.
 *
 * Two separately made objects with the same contents are not equal and this
 * finds neither in the other's place. There is no NaN case to part them over,
 * so unlike the numeric pair these two agree on everything. */
double nts_array_index_of_ref(const NtsArray *a, const void *needle) {
  void *const *items = NTS_ITEMS(a, void *);
  for (uint32_t at = 0; at < a->header.length; at++) {
    if (items[at] == needle) {
      return (double)at;
    }
  }
  return -1.0;
}

bool nts_array_includes_ref(const NtsArray *a, const void *needle) {
  return nts_array_index_of_ref(a, needle) >= 0.0;
}

/* And by *value*, which is what `===` is for a string.
 *
 * `["a"].indexOf("a")` is 0 in node across two separately built strings, so an
 * identity comparison would answer -1 -- the one cell of this that a shared
 * implementation gets wrong, and the reason strings have their own pair. */
double nts_array_index_of_str(const NtsArray *a, const NtsString *needle) {
  const NtsString *const *items = NTS_ITEMS(a, const NtsString *);
  for (uint32_t at = 0; at < a->header.length; at++) {
    if (items[at] == needle || nts_string_eq(items[at], needle)) {
      return (double)at;
    }
  }
  return -1.0;
}

bool nts_array_includes_str(const NtsArray *a, const NtsString *needle) {
  return nts_array_index_of_str(a, needle) >= 0.0;
}

bool nts_array_includes_str_value(const NtsArray *a, NtsValue needle) {
  if (nts_value_tag(needle) != NTS_TAG_STRING)
    return false;
  return nts_array_includes_str(a,
                                (const NtsString *)nts_value_reference(needle));
}

double nts_array_index_of_str_value(const NtsArray *a, NtsValue needle) {
  if (nts_value_tag(needle) != NTS_TAG_STRING)
    return -1.0;
  return nts_array_index_of_str(a,
                                (const NtsString *)nts_value_reference(needle));
}

/* `shift` and `unshift`, which are `pop` and `push` at the other end.
 *
 * The other end costs a `memmove`: an array's elements are contiguous and its
 * length is where they stop, so taking one off the front means moving the rest
 * down. That is O(n) where `pop` is O(1), and it is what the operation *is* --
 * V8 pays the same move for an array in this representation.
 *
 * Seventeen `shift`s and sixteen `unshift`s in `runtime/node`, which is why
 * these are here and `flat`, `flatMap` and `findLast` -- zero uses between them
 * -- are not. */
double nts_array_shift(NtsArray *a) {
  /* Shifting nothing is `undefined`, and this one cannot say so. See
   * `nts_array_pop`, which answers NaN for the same reason. */
  if (a->header.length == 0) {
    return (double)NAN;
  }
  double *items = NTS_ITEMS(a, double);
  double first = items[0];
  a->header.length--;
  memmove(items, items + 1, (size_t)a->header.length * sizeof(double));
  return first;
}

void *nts_array_shift_ref(NtsArray *a) {
  if (a->header.length == 0) {
    return NULL;
  }
  void **items = NTS_ITEMS(a, void *);
  void *first = items[0];
  a->header.length--;
  memmove(items, items + 1, (size_t)a->header.length * sizeof(void *));
  return first;
}

double nts_array_unshift(NtsArray *a, double value) {
  nts_array_reserve(a);
  double *items = NTS_ITEMS(a, double);
  memmove(items + 1, items, (size_t)a->header.length * sizeof(double));
  items[0] = value;
  a->header.length++;
  return (double)a->header.length;
}

/* **Consuming**, like `nts_array_push_ref`: the caller owes a reference and the
 * slot takes it. */
double nts_array_unshift_ref(NtsArray *a, void *value) {
  nts_array_reserve(a);
  void **items = NTS_ITEMS(a, void *);
  memmove(items + 1, items, (size_t)a->header.length * sizeof(void *));
  items[0] = value;
  a->header.length++;
  return (double)a->header.length;
}

double nts_array_pop(NtsArray *a) {
  /* Popping nothing is `undefined`. This one cannot say so -- it returns a
   * double -- so it answers NaN, and the compiler calls it only where the
   * checker has narrowed the result back to a number. `nts_array_pop_value` is
   * the one that can say `undefined`, and it is what an un-narrowed `pop`
   * lowers to. */
  if (a->header.length == 0) {
    return (double)NAN;
  }
  a->header.length--;
  return NTS_ITEMS(a, double)[a->header.length];
}

/* `pop` where the result keeps its `undefined`.
 *
 * `undefined` is not NaN. `String()` spells them differently, `??` takes one
 * and not the other, `=== undefined` separates them, and node answers
 * `String([].pop())` with "undefined" where this answered "NaN" -- a wrong
 * answer, and the comment above it asserted the two were the same rather than
 * checking.
 *
 * The checker already types `pop` as `T | undefined`, and for a number that is
 * an erased value with a tag of its own. So the tag is what says it, and a
 * caller that narrows back to a number pays nothing for this existing. */
/* `undefined`, with NaN where the number would be.
 *
 * The tag is what says `undefined`, and every correct read goes through it.
 * `xs.at(i)!` is the one that does not: the `!` tells the checker the index is
 * in range, so lowering may read the payload straight out, and when the
 * assertion is false that read gets whatever is there. Zero is a plausible
 * number and NaN is not -- and NaN is what `nts_array_at` answers, so a
 * program that lied gets one wrong answer rather than two different ones. */
static NtsValue nts_absent_number(void) {
  NtsValue value;
  value.tag = NTS_TAG_UNDEFINED;
  value.as.number = (double)NAN;
  return value;
}

NtsValue nts_array_pop_value(NtsArray *a) {
  if (a->header.length == 0) {
    return nts_absent_number();
  }
  a->header.length--;
  return nts_value_of_number(NTS_ITEMS(a, double)[a->header.length]);
}

NtsValue nts_array_shift_value(NtsArray *a) {
  if (a->header.length == 0) {
    return nts_absent_number();
  }
  return nts_value_of_number(nts_array_shift(a));
}

/* Copy a string into two-byte slots, whichever way it was stored. */
static void nts_widen(uint16_t *into, const NtsString *from) {
  if ((from->flags & NTS_TWO_BYTE) != 0) {
    memcpy(into, NTS_ELEMENTS(from, uint16_t), (size_t)from->length * 2u);
    return;
  }
  const unsigned char *units = NTS_ELEMENTS(from, unsigned char);
  for (uint32_t i = 0; i < from->length; i++) {
    into[i] = units[i];
  }
}

/* Declared in the header: `nts_unicode.c` allocates its result directly. */

/* Give storage the caller already has a string's header, instead of allocating
 * one.
 *
 * The count is `NTS_IMMORTAL`, which is what makes the rest of the system need
 * no new rule: retain and release already do nothing to an immortal object, and
 * the compiler emits a release wherever this string's live range ends whether
 * it is on the heap or not. `nts_env->allocated` is deliberately not touched --
 * this did not allocate, and `nts_live_count` is how reference counting is
 * tested.
 */
static NtsString *nts_str_place(NtsHeader *into, uint32_t length, int wide) {
  into->descriptor = wide ? &nts_desc_string2 : &nts_desc_string1;
  into->reserved = NTS_IMMORTAL;
  into->flags = wide ? NTS_TWO_BYTE : 0u;
  into->length = length;
  if (wide) {
    NTS_ELEMENTS(into, uint16_t)[length] = 0;
  } else {
    NTS_ELEMENTS(into, unsigned char)[length] = 0;
  }
  return into;
}

/* The caller's frame where it offered one, the heap otherwise.
 *
 * A caller offers storage only where the compiler proved two things: that this
 * string does not outlive the frame, and that its length cannot exceed what the
 * storage holds. So there is no fallback path here and no test of the capacity
 * -- a run-time fallback would be a heap object the compiler already decided
 * not to release. */
static NtsString *nts_str_build(NtsHeader *into, uint32_t length, int wide) {
  return into ? nts_str_place(into, length, wide) : nts_str_raw(length, wide);
}

/* Concatenation is the only string operation that allocates. A literal does
 * not: it is immutable and known at compile time, so the compiler emits it as
 * static data and references it. */
NtsString *nts_concat_into(NtsHeader *into, const NtsString *a,
                           const NtsString *b) {
  uint32_t total = a->length + b->length;
  int wide = ((a->flags | b->flags) & NTS_TWO_BYTE) != 0;
  /* One extra code unit, kept at zero, so a one-byte string can be handed to
   * C directly. `nts_str_build` writes it. */
  NtsString *out = nts_str_build(into, total, wide);
  if (wide) {
    uint16_t *into = NTS_ELEMENTS(out, uint16_t);
    nts_widen(into, a);
    nts_widen(into + a->length, b);
    into[total] = 0;
  } else {
    unsigned char *bytes = NTS_ELEMENTS(out, unsigned char);
    memcpy(bytes, NTS_ELEMENTS(a, unsigned char), a->length);
    memcpy(bytes + a->length, NTS_ELEMENTS(b, unsigned char), b->length);
    bytes[total] = 0;
  }
  return out;
}

/* One code unit, whichever width the string is stored at. */
static uint16_t nts_unit_at(const NtsString *s, uint32_t at) {
  return (s->flags & NTS_TWO_BYTE) != 0
             ? NTS_ELEMENTS(s, uint16_t)[at]
             : (uint16_t)NTS_ELEMENTS(s, unsigned char)[at];
}

/* `padStart` and `padEnd`, which differ only by which end the filling goes.
 *
 * A fresh string even where nothing is added: `"abc".padStart(2)` is `"abc"`,
 * and returning the argument would hand the caller a reference it does not own.
 * Strings are values, so a copy is the same answer. */
static NtsString *nts_str_pad(const NtsString *s, double target,
                              const NtsString *pad, int at_start) {
  /* A NaN target fails both comparisons and asks for nothing, which is what
   * `ToLength(NaN)` is. */
  uint32_t want =
      (target >= 0.0 && target <= 4294967295.0) ? (uint32_t)target : 0u;
  uint32_t fill =
      (want > s->length && pad->length > 0u) ? want - s->length : 0u;
  uint32_t total = s->length + fill;
  int wide = ((s->flags | (fill != 0u ? pad->flags : 0u)) & NTS_TWO_BYTE) != 0;
  NtsString *out = nts_str_raw(total, wide);
  uint32_t head = at_start ? fill : 0u;
  if (wide) {
    nts_widen(NTS_ELEMENTS(out, uint16_t) + head, s);
  } else {
    memcpy(NTS_ELEMENTS(out, unsigned char) + head,
           NTS_ELEMENTS(s, unsigned char), s->length);
  }
  uint32_t at = at_start ? 0u : s->length;
  for (uint32_t i = 0; i < fill; i++) {
    uint16_t unit = nts_unit_at(pad, i % pad->length);
    if (wide) {
      NTS_ELEMENTS(out, uint16_t)[at + i] = unit;
    } else {
      NTS_ELEMENTS(out, unsigned char)[at + i] = (unsigned char)unit;
    }
  }
  out->length = total;
  return out;
}

NtsString *nts_str_pad_start(const NtsString *s, double target,
                             const NtsString *pad) {
  return nts_str_pad(s, target, pad, 1);
}

NtsString *nts_str_pad_end(const NtsString *s, double target,
                           const NtsString *pad) {
  return nts_str_pad(s, target, pad, 0);
}

/* Whether every surrogate in the string is half of a pair.
 *
 * A one-byte string cannot hold one at all, which is most strings and is the
 * whole of the answer for them. */
bool nts_str_is_well_formed(const NtsString *s) {
  if ((s->flags & NTS_TWO_BYTE) == 0) {
    return true;
  }
  const uint16_t *units = NTS_ELEMENTS(s, uint16_t);
  for (uint32_t i = 0; i < s->length; i++) {
    if (units[i] >= 0xD800u && units[i] <= 0xDBFFu) {
      if (i + 1u >= s->length || units[i + 1u] < 0xDC00u ||
          units[i + 1u] > 0xDFFFu) {
        return false;
      }
      i++;
    } else if (units[i] >= 0xDC00u && units[i] <= 0xDFFFu) {
      return false;
    }
  }
  return true;
}

/* The same string with every lone surrogate replaced by U+FFFD. */
NtsString *nts_str_to_well_formed(const NtsString *s) {
  int wide = (s->flags & NTS_TWO_BYTE) != 0;
  NtsString *out = nts_str_raw(s->length, wide);
  if (!wide) {
    memcpy(NTS_ELEMENTS(out, unsigned char), NTS_ELEMENTS(s, unsigned char),
           s->length);
    return out;
  }
  const uint16_t *units = NTS_ELEMENTS(s, uint16_t);
  uint16_t *into = NTS_ELEMENTS(out, uint16_t);
  for (uint32_t i = 0; i < s->length; i++) {
    if (units[i] >= 0xD800u && units[i] <= 0xDBFFu && i + 1u < s->length &&
        units[i + 1u] >= 0xDC00u && units[i + 1u] <= 0xDFFFu) {
      into[i] = units[i];
      into[i + 1u] = units[i + 1u];
      i++;
    } else if (units[i] >= 0xD800u && units[i] <= 0xDFFFu) {
      into[i] = 0xFFFDu;
    } else {
      into[i] = units[i];
    }
  }
  return out;
}

NtsString *nts_concat(const NtsString *a, const NtsString *b) {
  return nts_concat_into(NULL, a, b);
}

/* The smallest capacity a grown string of `n` units gets: a power of two, and
 * never below `NTS_STRING_FLOOR`.
 *
 * Branchless, and that is not a flourish: this runs on *every* append, to ask
 * whether the string still has room. Written as a loop it was O(log n) per
 * append and so O(n log n) to build a string of n units -- 150us where node
 * took 110 for twenty thousand appends, most of it shifting a one upwards to
 * rediscover a capacity that had not changed. */
static uint32_t nts_round_up_pow2(uint32_t n) {
  /* A floor, so that a short string is not built by doubling from one. Ninety
   * code units -- a line of decoded text -- reached capacity through 1, 2, 4,
   * 8, 16, 32, 64, 128: eight allocations to hold what one could. Starting at
   * sixteen makes it two, and sixteen units is sixteen bytes of slack on a
   * narrow string, which is less than the header it hangs off.
   *
   * The invariant survives it: this is still the capacity a length implies, so
   * `capacity == nts_round_up_pow2(length)` still holds for every grown
   * string. */
  if (n <= NTS_STRING_FLOOR) {
    return NTS_STRING_FLOOR;
  }
  /* Doubling, but not for ever. Past a point it is the wrong shape: a string
   * of 1M+1 units would take 2M, and the slack is no longer the few bytes that
   * bought the allocations back. So growth becomes linear in fixed chunks,
   * which is what `sds` does at the same threshold and for the same reason.
   *
   * The invariant holds either way -- this is still the capacity a length
   * implies -- because both halves are functions of `n` alone. */
  if (n > NTS_STRING_DOUBLE_TO) {
    return (n + (NTS_STRING_CHUNK - 1u)) & ~(NTS_STRING_CHUNK - 1u);
  }
  /* The next power of two at or above `n`, from the bit position of the
   * highest one in `n - 1`. `n > NTS_STRING_FLOOR` above, so `n - 1` is at
   * least sixteen and the count is defined.
   *
   * The smear this replaced -- five shifts and five ors -- is the textbook
   * spelling and was already the fast half of a fix. It is still ten
   * instructions to rediscover a capacity, on every append, and the machine
   * has had the instruction since 2003. */
  return 1u << (32 - (uint32_t)__builtin_clz(n - 1u));
}

/* How many code units this string can hold without moving. See `NTS_GROWN`. */
static uint32_t nts_str_capacity(const NtsString *s) {
  return (s->flags & NTS_GROWN) != 0 ? nts_round_up_pow2(s->length) : s->length;
}

/* A grown copy of `a` with room for `total` units at width `wide`, holding
 * `a`'s units and its length. `a` is left for the caller to retire once it has
 * appended, since what it appends may be read out of `a` itself. Out of line:
 * every append inlines `nts_str_reserve`, and this is its rare half. */
static NTS_NOINLINE NtsString *nts_str_regrow(const NtsString *a,
                                              uint32_t total, int wide) {
  /* Sized to the next power of two so that the *next* append has somewhere to
   * go. That is what makes a loop of n appends cost log n allocations instead
   * of n, and it is why the capacity can be derived from the length rather
   * than stored beside it. */
  NtsString *out = nts_str_raw(nts_round_up_pow2(total), wide);
  if (wide) {
    nts_widen(NTS_ELEMENTS(out, uint16_t), a);
  } else {
    memcpy(NTS_ELEMENTS(out, unsigned char), NTS_ELEMENTS(a, unsigned char),
           a->length);
  }
  out->length = a->length;
  out->flags |= NTS_GROWN;
  return out;
}

/* `a`, which the caller hands over, with room for `extra` more code units, two
 * bytes wide if `wide` or if `a` already is: `a` itself where the append may
 * write into it, or a grown copy (`nts_str_regrow`). The caller writes the
 * units, the terminator and the length, and then, if it was handed a copy,
 * gives `a` back (`nts_str_retire`).
 *
 * One growth policy for every append -- `nts_str_append`, and the helpers that
 * append a number, a unit or a slice without making a string of it first.
 *
 * In place when every one of these holds. `reserved == 1` is the whole safety
 * argument: one reference exists and this call is consuming it, so nobody can
 * be looking at the units being overwritten. An immortal string -- a literal,
 * or frame storage -- fails it, which is right: neither is ours to write. And
 * the room is there only in an `NTS_GROWN` string, which is never hashed
 * (`NTS_HASHED`), so no kept hash can go stale. */
static inline NtsString *nts_str_reserve(NtsString *a, uint32_t extra,
                                         int wide) {
  const int already_wide = (a->flags & NTS_TWO_BYTE) != 0;
  wide = wide || already_wide;
  const uint32_t total = a->length + extra;
  if (a->reserved == 1u && wide == already_wide &&
      total <= nts_str_capacity(a)) {
    return a;
  }
  return nts_str_regrow(a, total, wide);
}

/* Give back the string a grown copy replaced.
 *
 * Returned rather than released where the count says it is ours alone: no
 * other reference exists, a string has no fields to give back, and one with no
 * reference fields is never a collection candidate, so nothing is buffered that
 * could be left pointing at it.
 *
 * `nts_free_string` and not `nts_free_block`: the first does the reclaiming
 * bookkeeping, and `nts_live_count` is how reference counting is tested.
 * Freeing the block alone gave the memory back and left the object counted as
 * live, which the suite reported as five leaks -- correctly. It was
 * `nts_destroy`, the general death path, which costs a string a walk of
 * everything it does not hold: 13% of `json-serialize` and 15% of
 * `json-stringify-typed`, whose accumulators outgrow their blocks.
 *
 * This is what keeps growth off the bill. Six reallocations building a string
 * were six releases, and the operation they were counted against is one the
 * program never asked for. */
static inline void nts_str_retire(NtsString *a) {
  if (a->reserved == 1u) {
    nts_free_string((NtsHeader *)a);
  } else if (a->reserved != NTS_IMMORTAL) {
    /* Out of line: this is inlined into every append, and a string both
     * shared and outgrown is the rare case. `nts_release` inlines its fast
     * path, and copied into an append loop it took a register the loop kept
     * its index in (`str-append-loop`, +23%). */
    nts_release_counted((NtsHeader *)a);
  }
  /* An immortal left alone. A literal or frame storage has no count to give
   * back -- retain and release both return on their first line -- so releasing
   * one is a call that decides nothing, and `let out = ""` in front of a loop
   * put exactly one of those on every string built in this program. */
}

/* Allocate a string of `length` code units, narrow if every unit fits a byte.
 *
 * The two representations are not a detail a caller should reproduce: a slice
 * of a wide string can be entirely narrow, and storing it wide would make an
 * equality test between it and a narrow literal take the slow path forever. */
/* A string of `length` code units at the given width, with its header set and
 * its terminator written, and its contents left to the caller.
 *
 * Separate from `nts_str_alloc` because most strings are made by *copying* an
 * existing one, and a copy that knows its own width has nothing to inspect and
 * nowhere to stage. `nts_str_alloc` is what remains: the case where the units
 * arrive as `uint16_t` and the width is still a question. */
NtsString *nts_str_raw(uint32_t length, int wide) {
  /* The same 2^31 - 1 bound `nts_array_allocate` enforces, and for the same
   * reason: `hir::flow` gives `OpKind::Length` an `int32` fact, and that
   * operation covers a string's length as well as an array's. A string this
   * runtime could build past the bound would make the fact false, and a false
   * fact about a length is a loop counter that wraps.
   *
   * Every string is made here or by a caller that goes through here, so this is
   * the one place it has to hold. 2^31 units is 2 GB one-byte or 4 GB wide;
   * node's own maximum string is smaller than either. */
  if (length > (uint32_t)NTS_MAX_LENGTH) {
    fprintf(stderr, NTS_REFUSED "a string of %u code units is too long\n",
            length);
    abort();
  }
  size_t width = wide ? 2u : 1u;
  NtsString *out =
      (NtsString *)nts_alloc(NTS_STRING_UNITS + ((size_t)length + 1) * width);
  out->descriptor = wide ? &nts_desc_string2 : &nts_desc_string1;
  out->reserved = nts_fresh_count();
  nts_note_allocation();
  out->flags = wide ? NTS_TWO_BYTE : 0u;
  out->length = length;
  if (wide) {
    NTS_ELEMENTS(out, uint16_t)[length] = 0;
  } else {
    NTS_ELEMENTS(out, unsigned char)[length] = 0;
  }
  return out;
}

NtsString *nts_str_alloc(const uint16_t *units, uint32_t length) {
  int wide = 0;
  for (uint32_t at = 0; at < length; at++) {
    if (units[at] > 0xFFu) {
      wide = 1;
      break;
    }
  }
  NtsString *out = nts_str_raw(length, wide);
  if (wide) {
    uint16_t *into = NTS_ELEMENTS(out, uint16_t);
    for (uint32_t at = 0; at < length; at++) {
      into[at] = units[at];
    }
    into[length] = 0;
  } else {
    unsigned char *into = NTS_ELEMENTS(out, unsigned char);
    for (uint32_t at = 0; at < length; at++) {
      into[at] = (unsigned char)units[at];
    }
    into[length] = 0;
  }
  return out;
}

/* The empty string and every string of one narrow code unit, made once.
 *
 * A range of a string is a new string, and a short one is mostly header: a
 * parser's `"a"`, a tokenizer's `charAt`, a split into characters each cost an
 * allocation, and under counting a death, for a value that is the same every
 * time. A string is immutable to the program -- the one write into an existing
 * string is `nts_str_append`'s, and that only into one whose count says it is
 * the sole owner, which an immortal never is -- so these are shared, as V8's
 * single-character string table is. `benchmarks/cases/json-parse` makes two per
 * row, its `"tags":["a","b"]`. */
typedef struct {
  NtsHeader header;
  uint32_t hash;
  unsigned char units[2];
} NtsUnitString;
_Static_assert(offsetof(NtsUnitString, units) == NTS_STRING_UNITS,
               "a shared string's units are not where every string's are");

#define NTS_UNIT_STRING(unit)                                                  \
  {{&nts_desc_string1, NTS_IMMORTAL, 0u, 1u}, 0u, {(unsigned char)(unit), 0u}}
#define NTS_UNIT_STRINGS_4(unit)                                               \
  NTS_UNIT_STRING(unit), NTS_UNIT_STRING((unit) + 1),                          \
      NTS_UNIT_STRING((unit) + 2), NTS_UNIT_STRING((unit) + 3)
#define NTS_UNIT_STRINGS_16(unit)                                              \
  NTS_UNIT_STRINGS_4(unit), NTS_UNIT_STRINGS_4((unit) + 4),                    \
      NTS_UNIT_STRINGS_4((unit) + 8), NTS_UNIT_STRINGS_4((unit) + 12)
#define NTS_UNIT_STRINGS_64(unit)                                              \
  NTS_UNIT_STRINGS_16(unit), NTS_UNIT_STRINGS_16((unit) + 16),                 \
      NTS_UNIT_STRINGS_16((unit) + 32), NTS_UNIT_STRINGS_16((unit) + 48)

static const NtsUnitString nts_unit_strings[256] = {
    NTS_UNIT_STRINGS_64(0), NTS_UNIT_STRINGS_64(64), NTS_UNIT_STRINGS_64(128),
    NTS_UNIT_STRINGS_64(192)};
static const NtsUnitString nts_empty_string = {
    {&nts_desc_string1, NTS_IMMORTAL, 0u, 0u}, 0u, {0u, 0u}};

/* Copy a range of code units out of a string, into the caller's storage where
 * it supplied one, and as a shared string where it is one of those above. */
static NtsString *nts_str_range(NtsHeader *into, const NtsString *s,
                                uint32_t from, uint32_t to) {
  uint32_t length = to > from ? to - from : 0u;
  if (into == NULL && length <= 1u) {
    if (length == 0u) {
      return (NtsString *)(void *)&nts_empty_string;
    }
    uint16_t unit = nts_unit(s, from);
    if (unit <= 0xFFu) {
      return (NtsString *)(void *)&nts_unit_strings[unit];
    }
  }
  if (length == 0) {
    return nts_str_build(into, 0, 0);
  }

  /* A slice of a narrow string is narrow, and every code unit is one byte in
   * both. So there is nothing to inspect, nothing to stage, and nothing to
   * convert: one allocation and one `memcpy`.
   *
   * This used to allocate a `uint16_t` staging buffer, fill it a unit at a time
   * through `nts_unit` -- which branches on the width for every character --
   * hand that to `nts_str_alloc`, which scanned it for wide units and then
   * narrowed it back, and free the buffer. Two allocations and three passes to
   * copy some bytes. Slicing is what a parser does, so it is worth the special
   * case rather than the generality. */
  if (!(s->flags & NTS_TWO_BYTE)) {
    NtsString *out = nts_str_build(into, length, 0);
    memcpy(NTS_ELEMENTS(out, unsigned char),
           NTS_ELEMENTS(s, const unsigned char) + from, length);
    return out;
  }

  /* A slice of a wide string may be entirely narrow, and keeping it wide would
   * make every later read of it pay for a width it does not use. One pass to
   * find out, then one to copy. */
  const uint16_t *units = NTS_ELEMENTS(s, const uint16_t) + from;
  int wide = 0;
  for (uint32_t at = 0; at < length; at++) {
    if (units[at] > 0xFFu) {
      wide = 1;
      break;
    }
  }
  NtsString *out = nts_str_build(into, length, wide);
  if (wide) {
    memcpy(NTS_ELEMENTS(out, uint16_t), units,
           (size_t)length * sizeof(uint16_t));
  } else {
    unsigned char *into = NTS_ELEMENTS(out, unsigned char);
    for (uint32_t at = 0; at < length; at++) {
      into[at] = (unsigned char)units[at];
    }
  }
  return out;
}

/* `ToIntegerOrInfinity` then a clamp into `[0, length]`, with a negative index
 * counted from the end -- which is what makes `s.slice(-2)` the last two. */
static uint32_t nts_str_clamp(double index, uint32_t length, int relative) {
  /* The case every real call is: a whole number the caller already computed as
   * an index into this string. Three comparisons settle it, where the general
   * path below costs a `trunc` and the sign handling that `s.slice(-2)` needs
   * and this does not.
   *
   * The cast is defined because the range test came first: a value in
   * `[0, length]` is inside `uint32`. And `x == (double)(uint32_t)x` is false
   * for a fraction and for a NaN, so both fall through to the general path
   * rather than being quietly truncated here.
   *
   * Worth a special case because slicing is what a parser does, and a parser
   * indexes with integers. Two of these run per `substring`. */
  if (index >= 0.0 && index <= (double)length &&
      index == (double)(uint32_t)index) {
    return (uint32_t)index;
  }
  index = nts_to_integer(index);
  if (relative && index < 0) {
    index += (double)length;
  }
  if (index < 0) {
    return 0u;
  }
  if (index >= (double)length) {
    return length;
  }
  return (uint32_t)index;
}

/* Where `needle` first occurs at or after `from`, or -1.
 *
 * The narrow-narrow case gets `memchr` and `memcmp`, which is not a
 * micro-optimization: both are vectorized in every C library worth using, and
 * the naive form -- a branch per code unit, through a function that has to ask
 * which width the string is -- was fourteen times more work than the loop this
 * benchmark was written to measure. Most strings in most programs are narrow,
 * so this is the path that runs. */
static double nts_str_find(const NtsString *s, const NtsString *needle,
                           uint32_t from, int backwards) {
  if (needle->length > s->length) {
    return -1.0;
  }
  uint32_t last = s->length - needle->length;

  const int both_narrow = ((s->flags | needle->flags) & NTS_TWO_BYTE) == 0;
  if (both_narrow && !backwards) {
    const unsigned char *text = NTS_ELEMENTS(s, unsigned char);
    const unsigned char *want = NTS_ELEMENTS(needle, unsigned char);
    if (needle->length == 0) {
      return (double)(from <= last ? from : last);
    }
    uint32_t at = from;
    while (at <= last) {
      const unsigned char *hit = (const unsigned char *)memchr(
          text + at, want[0], (size_t)(last - at) + 1u);
      if (!hit) {
        return -1.0;
      }
      at = (uint32_t)(hit - text);
      if (memcmp(hit, want, needle->length) == 0) {
        return (double)at;
      }
      at++;
    }
    return -1.0;
  }

  for (uint32_t start = 0; start <= last; start++) {
    uint32_t at = backwards ? last - start : start;
    if (!backwards && at < from) {
      continue;
    }
    uint32_t matched = 0;
    while (matched < needle->length &&
           nts_unit(s, at + matched) == nts_unit(needle, matched)) {
      matched++;
    }
    if (matched == needle->length) {
      return (double)at;
    }
  }
  return -1.0;
}

double nts_str_code_point_at(const NtsString *s, double at) {
  at = nts_to_integer(at);
  double unit = nts_str_char_code_at(s, at);
  if (unit != unit) {
    return unit;
  }
  uint32_t index = (uint32_t)at;
  uint16_t lead = (uint16_t)unit;
  /* A surrogate pair is one code point spread over two units. */
  if (lead >= 0xD800u && lead <= 0xDBFFu && index + 1 < s->length) {
    uint16_t trail = nts_unit(s, index + 1);
    if (trail >= 0xDC00u && trail <= 0xDFFFu) {
      return (double)(0x10000u + ((lead - 0xD800u) << 10) + (trail - 0xDC00u));
    }
  }
  return unit;
}

double nts_str_index_of(const NtsString *s, const NtsString *needle) {
  return nts_str_find(s, needle, 0u, 0);
}

/* `indexOf(needle, from)`, which is the same search from somewhere other than
 * the start. `nts_str_find` has taken a start position all along; the one
 * argument form is this one with a zero, and `path.indexOf(':', index + 1)` --
 * a scan that resumes -- is what wanted the other. */
double nts_str_index_of_from(const NtsString *s, const NtsString *needle,
                             double from) {
  return nts_str_find(s, needle, nts_str_clamp(from, s->length, 0), 0);
}

double nts_str_last_index_of(const NtsString *s, const NtsString *needle) {
  return nts_str_find(s, needle, 0u, 1);
}

bool nts_str_includes(const NtsString *s, const NtsString *needle) {
  return nts_str_find(s, needle, 0u, 0) >= 0.0;
}

bool nts_str_starts_with(const NtsString *s, const NtsString *needle) {
  if (needle->length > s->length) {
    return false;
  }
  for (uint32_t at = 0; at < needle->length; at++) {
    if (nts_unit(s, at) != nts_unit(needle, at)) {
      return false;
    }
  }
  return true;
}

bool nts_str_ends_with(const NtsString *s, const NtsString *needle) {
  if (needle->length > s->length) {
    return false;
  }
  uint32_t offset = s->length - needle->length;
  for (uint32_t at = 0; at < needle->length; at++) {
    if (nts_unit(s, offset + at) != nts_unit(needle, at)) {
      return false;
    }
  }
  return true;
}

NtsString *nts_str_char_at_into(NtsHeader *into, const NtsString *s,
                                double at) {
  at = nts_to_integer(at);
  if (at < 0 || at >= (double)s->length) {
    /* Out of range is the empty string, unlike `charCodeAt`'s NaN. */
    return nts_str_build(into, 0, 0);
  }
  uint32_t index = (uint32_t)at;
  return nts_str_range(into, s, index, index + 1u);
}

NtsString *nts_str_char_at(const NtsString *s, double at) {
  return nts_str_char_at_into(NULL, s, at);
}

/* `s[i]`, which is not `s.charAt(i)`.
 *
 * The difference is the whole reason this exists beside it. `charAt` answers
 * `""` for an index that is not there; `s[i]` answers `undefined`, and
 * TypeScript types it `string` regardless -- exactly what it says about
 * `xs[i]`, where the bounds test is what checks the claim. So this keeps that
 * bargain rather than inventing a third answer: an index outside the string
 * stops the program where an index outside an array would. */
NtsString *nts_str_at_into(NtsHeader *into, const NtsString *s, double at) {
  /* **Not `nts_to_integer` first.** A property key is an *index* only when it
   * is a non-negative integer, so node answers `undefined` for `s[1.7]` and
   * `s[NaN]`: `"1.7"` and `"NaN"` are property names that are not there.
   * Converting first made both of them a character -- `"abc"[1.7]` answered
   * `"b"` and `"abc"[NaN]` answered `"a"` -- which is a *wrong answer* rather
   * than the stop this is documented to give, and the comment above is about
   * an index outside the string while neither of these is an index at all.
   *
   * The array path has been right about this by construction: `xs[i]` lowers
   * to a bounds test on the unconverted value, and `NaN` fails every
   * comparison. This is that test written out, which is also why `at !=
   * nts_to_integer(at)` is the second half rather than the whole of it -- a
   * `NaN` fails the first half and a fraction passes it. */
  if (!(at >= 0.0 && at < (double)s->length) || at != nts_to_integer(at)) {
    nts_bounds(at, s->length);
  }
  uint32_t index = (uint32_t)at;
  return nts_str_range(into, s, index, index + 1u);
}

NtsString *nts_str_at(const NtsString *s, double at) {
  return nts_str_at_into(NULL, s, at);
}

/* `s.at(i)`, which is neither `s[i]` nor `s.charAt(i)`.
 *
 * **Three spellings and three answers for an index that is not there**, and the
 * language means a different one each time: `charAt` gives `""`, `s[i]` stops
 * the program the way an out-of-range array index does, and `at` gives
 * `undefined` -- which for a reference is the null pointer, the same answer
 * `nts_array_at_ref` gives for the same reason.
 *
 * And `at` is the only one of the three that counts a negative index from the
 * end, which is the reason the method exists at all. */
NtsString *nts_str_relative_at(const NtsString *s, double at) {
  double offset = nts_relative_offset(at, s->length);
  if (offset < 0) {
    return NULL;
  }
  uint32_t index = (uint32_t)offset;
  return nts_str_range(NULL, s, index, index + 1u);
}

NtsString *nts_str_repeat(const NtsString *s, double times) {
  if (times != times || times < 0) {
    times = 0;
  }
  times = floor(times);
  /* A repeat that cannot fit in a string's length is an allocation that would
   * fail anyway; refusing loudly beats a truncated answer. */
  if (times * (double)s->length > 4294967295.0) {
    fprintf(stderr,
            NTS_REFUSED "repeat produces a string longer than 2^32-1\n");
    abort();
  }
  uint32_t total = (uint32_t)(times * (double)s->length);
  if (total == 0) {
    return nts_str_alloc(0, 0);
  }
  uint16_t *units = (uint16_t *)malloc((size_t)total * sizeof(uint16_t));
  if (!units) {
    fprintf(stderr, "nts: out of memory\n");
    abort();
  }
  for (uint32_t at = 0; at < total; at++) {
    units[at] = nts_unit(s, at % s->length);
  }
  NtsString *out = nts_str_alloc(units, total);
  free(units);
  return out;
}

NtsString *nts_str_slice_into(NtsHeader *into, const NtsString *s, double from,
                              double to) {
  /* Negative counts from the end, which is what distinguishes `slice` from
   * `substring`. */
  uint32_t start = nts_str_clamp(from, s->length, 1);
  uint32_t end = nts_str_clamp(to, s->length, 1);
  return nts_str_range(into, s, start, end);
}

NtsString *nts_str_slice(const NtsString *s, double from, double to) {
  return nts_str_slice_into(NULL, s, from, to);
}

NtsString *nts_str_substring_general(NtsHeader *into, const NtsString *s,
                                     double from, double to) {
  /* Negative clamps to zero and the two ends swap if they are out of order,
   * which is what distinguishes `substring` from `slice`. */
  uint32_t start = nts_str_clamp(from, s->length, 0);
  uint32_t end = nts_str_clamp(to, s->length, 0);
  if (start > end) {
    uint32_t swap = start;
    start = end;
    end = swap;
  }
  return nts_str_range(into, s, start, end);
}

NtsString *nts_str_substring(const NtsString *s, double from, double to) {
  return nts_str_substring_general(NULL, s, from, to);
}

/* # Appending without making the string appended
 *
 * `out += String(n)`, `out += s[i]`, `out += s.charAt(i)`,
 * `out += String.fromCharCode(c)` and `out += s.slice(a, b)` each made a
 * string to append -- a number's text, a one-unit string, a slice -- copied it
 * onto `out` and gave it back. These write it into `out` directly
 * (`hir::destinations` sends the calls here).
 *
 * Two entry points for each, as `+` has two. `nts_str_append_*` consumes `a`,
 * as `nts_str_append` does, and grows it by the same policy
 * (`nts_str_reserve`): in place only where the count is one. `nts_str_concat_*`
 * leaves `a` as it was and answers a fresh grown string, as `nts_concat` does:
 * `rc` chooses it where `a` is read again or is not this function's to give,
 * which is the split it makes between `nts_str_append` and `nts_concat`, so no
 * call ever asks which it is. Each reads what it appends before reserving,
 * since that may be `a` itself. */

static uint32_t nts_number_format(char *out, double x);
static uint32_t nts_digits10(uint32_t n);
static int nts_u32toa(char *buf, uint32_t n);

/* Where an append writes: `a` or its grown copy when `a` is handed over, else
 * always a fresh grown copy. `consume` is a constant at every call. */
__attribute__((always_inline)) static inline NtsString *
nts_str_room(NtsString *a, uint32_t extra, int wide, int consume) {
  if (consume) {
    return nts_str_reserve(a, extra, wide);
  }
  return nts_str_regrow(a, a->length + extra,
                        wide || (a->flags & NTS_TWO_BYTE) != 0);
}

/* After writing: give back the string a copy replaced, when it was handed
 * over. */
__attribute__((always_inline)) static inline NtsString *
nts_str_written(NtsString *out, NtsString *a, int consume) {
  if (consume && out != a) {
    nts_str_retire(a);
  }
  return out;
}

/* Nothing to append: `a` itself when handed over, else a fresh copy, since
 * the non-consuming entry answers a string of its own. */
__attribute__((always_inline)) static inline NtsString *
nts_str_unchanged(NtsString *a, int consume) {
  if (consume) {
    return a;
  }
  return nts_str_regrow(a, a->length, (a->flags & NTS_TWO_BYTE) != 0);
}

/* `a + b`: `b`'s units onto `a`. `b` is read whole before `a` is reserved,
 * since it may be `a` itself. */
__attribute__((always_inline)) static inline NtsString *
nts_str_add_string(NtsString *a, const NtsString *b, int consume) {
  const uint32_t at = a->length;
  const uint32_t total = at + b->length;
  NtsString *out =
      nts_str_room(a, b->length, (b->flags & NTS_TWO_BYTE) != 0, consume);
  /* One unit on the right, spelled out rather than handed to a copy.
   *
   * `out += c` is the shape a decoder writes, once per code point, and the
   * right-hand side of it is a string of length one. `memcpy` of one byte is a
   * call into the C library's vector dispatch, which reads its length, picks a
   * strategy and moves a byte: on `benches/cases/node-utf8` that was 494,776
   * calls to `__memcpy_avx_unaligned_erms`, seven per cent of the whole
   * program, to do 494,776 bytes of work.
   *
   * The branch is free where it does not hit -- one compare against a length
   * already loaded -- and where it does it is a store. */
  if ((out->flags & NTS_TWO_BYTE) != 0) {
    uint16_t *units = NTS_ELEMENTS(out, uint16_t);
    if (b->length == 1u) {
      units[at] = nts_unit(b, 0);
    } else {
      nts_widen(units + at, b);
    }
    units[total] = 0;
  } else {
    unsigned char *bytes = NTS_ELEMENTS(out, unsigned char);
    if (b->length == 1u) {
      bytes[at] = NTS_ELEMENTS(b, unsigned char)[0];
    } else {
      memcpy(bytes + at, NTS_ELEMENTS(b, unsigned char), b->length);
    }
    bytes[total] = 0;
  }
  out->length = total;
  return nts_str_written(out, a, consume);
}

__attribute__((always_inline)) NtsString *nts_str_append(NtsString *a,
                                                         const NtsString *b) {
  return nts_str_add_string(a, b, 1);
}

/* A fresh grown string, so the appends after it write in place: the first
 * link of a chain (`appended_results::consumed_left_sides`). */
NtsString *nts_str_concat_grown(const NtsString *a, const NtsString *b) {
  return nts_str_add_string((NtsString *)a, b, 0);
}

/* One code unit onto `a`. */
__attribute__((always_inline)) static inline NtsString *
nts_str_add_unit(NtsString *a, uint16_t unit, int consume) {
  const uint32_t at = a->length;
  NtsString *out = nts_str_room(a, 1u, unit > 0xFFu, consume);
  if ((out->flags & NTS_TWO_BYTE) != 0) {
    uint16_t *units = NTS_ELEMENTS(out, uint16_t);
    units[at] = unit;
    units[at + 1u] = 0;
  } else {
    unsigned char *bytes = NTS_ELEMENTS(out, unsigned char);
    bytes[at] = (unsigned char)unit;
    bytes[at + 1u] = 0;
  }
  out->length = at + 1u;
  return nts_str_written(out, a, consume);
}

/* `a + String(n)`: the number's text, as `nts_number_to_string` writes it,
 * straight into the string.
 *
 * A whole number in the `i32` range takes `nts_number_to_string_into`'s fast
 * path: its digits counted first (`nts_digits10`), so exactly that much room is
 * reserved and they are written where they go, with no scratch buffer. Every
 * count and identifier a template writes is one; through the general
 * formatter and a copy, `str-template` was 3-6% slower than the string it
 * replaced. Anything else is `nts_number_format` and one copy. */
__attribute__((always_inline)) static inline NtsString *
nts_str_add_number(NtsString *a, double n, int consume) {
  char text[NTS_NUMBER_STRING_MAX];
  const int32_t whole =
      n >= -2147483648.0 && n <= 2147483647.0 ? (int32_t)n : 0;
  const int integral = (double)whole == n;
  const uint32_t magnitude =
      whole < 0 ? (uint32_t)(-(int64_t)whole) : (uint32_t)whole;
  const uint32_t sign = whole < 0 ? 1u : 0u;
  const uint32_t length =
      integral ? nts_digits10(magnitude) + sign : nts_number_format(text, n);
  const uint32_t at = a->length;
  NtsString *out = nts_str_room(a, length, 0, consume);
  if ((out->flags & NTS_TWO_BYTE) == 0) {
    char *data = (char *)NTS_ELEMENTS(out, unsigned char) + at;
    if (integral) {
      if (sign != 0u) {
        data[0] = '-';
      }
      nts_u32toa(data + sign, magnitude);
    } else {
      memcpy(data, text, length);
    }
    data[length] = 0;
  } else {
    if (integral) {
      if (sign != 0u) {
        text[0] = '-';
      }
      nts_u32toa(text + sign, magnitude);
    }
    uint16_t *units = NTS_ELEMENTS(out, uint16_t) + at;
    for (uint32_t i = 0; i < length; i++) {
      units[i] = (unsigned char)text[i];
    }
    units[length] = 0;
  }
  out->length = at + length;
  return nts_str_written(out, a, consume);
}

/* `a + s[i]`, with `s[i]`'s rule for an index that is not there: it stops the
 * program, as `nts_str_at` does, and `s[1.7]` and `s[NaN]` are not indices. */
__attribute__((always_inline)) static inline NtsString *
nts_str_add_at(NtsString *a, const NtsString *s, double at, int consume) {
  if (!(at >= 0.0 && at < (double)s->length) || at != nts_to_integer(at)) {
    nts_bounds(at, s->length);
  }
  return nts_str_add_unit(a, nts_unit(s, (uint32_t)at), consume);
}

/* `a + s.charAt(i)`: the index converted as `charAt` converts it, and nothing
 * appended for one outside the string, which `charAt` answers with `""`. */
__attribute__((always_inline)) static inline NtsString *
nts_str_add_char_at(NtsString *a, const NtsString *s, double at, int consume) {
  at = nts_to_integer(at);
  if (at < 0 || at >= (double)s->length) {
    return nts_str_unchanged(a, consume);
  }
  return nts_str_add_unit(a, nts_unit(s, (uint32_t)at), consume);
}

/* `a + s.slice(from, to)`, with `slice`'s bounds: negative counts from the
 * end, and an empty range appends nothing. A slice of a wide string that
 * holds no wide unit keeps a narrow `a` narrow, as `nts_str_slice` would have
 * made the slice itself narrow. */
__attribute__((always_inline)) static inline NtsString *
nts_str_add_slice(NtsString *a, const NtsString *s, double from, double to,
                  int consume) {
  const uint32_t start = nts_str_clamp(from, s->length, 1);
  const uint32_t end = nts_str_clamp(to, s->length, 1);
  if (end <= start) {
    return nts_str_unchanged(a, consume);
  }
  const uint32_t length = end - start;
  const int from_wide = (s->flags & NTS_TWO_BYTE) != 0;
  int wide = 0;
  if (from_wide && (a->flags & NTS_TWO_BYTE) == 0) {
    const uint16_t *units = NTS_ELEMENTS(s, const uint16_t) + start;
    for (uint32_t i = 0; i < length && !wide; i++) {
      wide = units[i] > 0xFFu;
    }
  }
  const uint32_t at = a->length;
  NtsString *out = nts_str_room(a, length, wide, consume);
  if ((out->flags & NTS_TWO_BYTE) != 0) {
    uint16_t *into = NTS_ELEMENTS(out, uint16_t) + at;
    if (from_wide) {
      memcpy(into, NTS_ELEMENTS(s, const uint16_t) + start,
             (size_t)length * sizeof(uint16_t));
    } else {
      const unsigned char *bytes = NTS_ELEMENTS(s, const unsigned char) + start;
      for (uint32_t i = 0; i < length; i++) {
        into[i] = bytes[i];
      }
    }
    into[length] = 0;
  } else {
    unsigned char *into = NTS_ELEMENTS(out, unsigned char) + at;
    if (from_wide) {
      const uint16_t *units = NTS_ELEMENTS(s, const uint16_t) + start;
      for (uint32_t i = 0; i < length; i++) {
        into[i] = (unsigned char)units[i];
      }
    } else {
      memcpy(into, NTS_ELEMENTS(s, const unsigned char) + start, length);
    }
    into[length] = 0;
  }
  out->length = at + length;
  return nts_str_written(out, a, consume);
}

/* Inlined, as `nts_number_to_string_into` is: a caller that knows its number
 * is whole folds the range test away and keeps the digit loop. */
__attribute__((always_inline)) NtsString *nts_str_append_number(NtsString *a,
                                                                double n) {
  return nts_str_add_number(a, n, 1);
}

__attribute__((always_inline)) NtsString *
nts_str_concat_number(const NtsString *a, double n) {
  return nts_str_add_number((NtsString *)a, n, 0);
}

NtsString *nts_str_append_at(NtsString *a, const NtsString *s, double at) {
  return nts_str_add_at(a, s, at, 1);
}

NtsString *nts_str_concat_at(const NtsString *a, const NtsString *s,
                             double at) {
  return nts_str_add_at((NtsString *)a, s, at, 0);
}

NtsString *nts_str_append_char_at(NtsString *a, const NtsString *s, double at) {
  return nts_str_add_char_at(a, s, at, 1);
}

NtsString *nts_str_concat_char_at(const NtsString *a, const NtsString *s,
                                  double at) {
  return nts_str_add_char_at((NtsString *)a, s, at, 0);
}

/* `a + String.fromCharCode(c)`, one argument: its code unit, by the same
 * conversion as `nts_string_from_char_code`. */
NtsString *nts_str_append_char_code(NtsString *a, double code) {
  return nts_str_add_unit(a, nts_to_uint16(code), 1);
}

NtsString *nts_str_concat_char_code(const NtsString *a, double code) {
  return nts_str_add_unit((NtsString *)a, nts_to_uint16(code), 0);
}

NtsString *nts_str_append_slice(NtsString *a, const NtsString *s, double from,
                                double to) {
  return nts_str_add_slice(a, s, from, to, 1);
}

NtsString *nts_str_concat_slice(const NtsString *a, const NtsString *s,
                                double from, double to) {
  return nts_str_add_slice((NtsString *)a, s, from, to, 0);
}

/* # JSON's quoted strings: 25.5.4.3 `QuoteJSONString`
 *
 * `runtime/web-platform/src/json/text.ts` is the specification and the oracle.
 * Its `quoteJSONString` and `firstEscapeIndex` call these where the target
 * provides them (`typeof nts_json_quote === "function"`, which `hir::features`
 * answers per backend) and keep their own loops everywhere else, so node, Bun
 * and every target without them run the TypeScript, and any difference is a
 * disagreement the differential sees.
 *
 * Table 78 escapes seven units by name -- `\b`, `\t`, `\n`, `\f`, `\r`, `\"`
 * and `\\` -- and every other control character, and a surrogate with no
 * partner, is `\uXXXX` in lowercase. A well-formed pair is one code point and
 * is written as it stands; `/` and U+007F are written bare.
 *
 * Almost nothing in a document needs any of it, so the work is finding the
 * first unit that does: 32 bytes at a time with AVX2 (x86-64-v3, the default
 * native target), 16 with SSE2, eight in a little-endian 64-bit word, and
 * units otherwise. Narrow scans below 16 remaining units stay inline; the
 * long scan and the wide scan stay out of line. A tail shorter than a step is
 * read as the last
 * whole step, overlapping what was already read, with the units before it
 * shifted out of the answer. A wide string's surrogates are found as
 * candidates by the same comparison and settled one by one, against their
 * neighbour. */

/* Bit 7 of each byte of `word` set where JSON text escapes that byte: below
 * U+0020, `"` or `\`. Exact per byte -- no carry crosses into a neighbour, as
 * the classic has-a-zero-byte trick's borrow does -- so the lowest set bit is
 * the first such byte whatever the bytes before it were, which the overlapping
 * last step relies on. */
#if __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
static inline uint64_t nts_json_escapes_in_word(uint64_t word) {
  const uint64_t low = 0x7F7F7F7F7F7F7F7Full;
  const uint64_t high = 0x8080808080808080ull;
  /* Bit 7 set where a byte is at least U+0020: below 0x80 by the sum, at or
   * above it by its own bit. */
  const uint64_t printable = ((word & low) + 0x6060606060606060ull) | word;
  const uint64_t quote = word ^ 0x2222222222222222ull;
  const uint64_t backslash = word ^ 0x5C5C5C5C5C5C5C5Cull;
  /* Bit 7 clear only where the byte is zero: the sum reaches 0x80 for every
   * other below 0x80, and its own bit is set for the rest. */
  const uint64_t not_quote = ((quote & low) + low) | quote;
  const uint64_t not_backslash = ((backslash & low) + low) | backslash;
  return ~(printable & not_quote & not_backslash) & high;
}
#endif

#if defined(__SSE2__)
/* The bits of a 16-byte window's units JSON text escapes. */
static inline uint32_t nts_json_escapes_in_16(const unsigned char *at) {
  const __m128i bytes = _mm_loadu_si128((const __m128i *)(const void *)at);
  const __m128i hits = _mm_or_si128(
      _mm_or_si128(_mm_cmpeq_epi8(bytes, _mm_set1_epi8('"')),
                   _mm_cmpeq_epi8(bytes, _mm_set1_epi8('\\'))),
      _mm_cmpeq_epi8(_mm_min_epu8(bytes, _mm_set1_epi8(0x1F)), bytes));
  return (uint32_t)_mm_movemask_epi8(hits);
}
#endif

/* The long part of a narrow scan, where at least 16 units remain: 32 bytes a
 * step with AVX2, then 16 with SSE2 (or eight in a word), the last step
 * overlapping what was read. Out of line: a key or a short value never comes
 * here. */
static NTS_NOINLINE uint32_t nts_json_scan_narrow_long(
    const unsigned char *units, uint32_t at, uint32_t length) {
#if defined(__AVX2__)
  const __m256i quote = _mm256_set1_epi8('"');
  const __m256i backslash = _mm256_set1_epi8('\\');
  const __m256i control = _mm256_set1_epi8(0x1F);
  while (length - at >= 32u) {
    const __m256i bytes =
        _mm256_loadu_si256((const __m256i *)(const void *)(units + at));
    const __m256i hits = _mm256_or_si256(
        _mm256_or_si256(_mm256_cmpeq_epi8(bytes, quote),
                        _mm256_cmpeq_epi8(bytes, backslash)),
        _mm256_cmpeq_epi8(_mm256_min_epu8(bytes, control), bytes));
    const uint32_t mask = (uint32_t)_mm256_movemask_epi8(hits);
    if (mask != 0u) {
      return at + (uint32_t)__builtin_ctz(mask);
    }
    at += 32u;
  }
#endif
#if defined(__SSE2__)
  while (at < length) {
    const uint32_t from = length - at < 16u ? length - 16u : at;
    const uint32_t mask = nts_json_escapes_in_16(units + from) >> (at - from);
    if (mask != 0u) {
      return at + (uint32_t)__builtin_ctz(mask);
    }
    at = from + 16u;
  }
  return length;
#else
#if __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
  while (at < length) {
    const uint32_t from = length - at < 8u ? length - 8u : at;
    uint64_t word;
    memcpy(&word, units + from, sizeof word);
    const uint64_t mask = nts_json_escapes_in_word(word) >> (8u * (at - from));
    if (mask != 0u) {
      return at + (uint32_t)__builtin_ctzll(mask) / 8u;
    }
    at = from + 8u;
  }
#endif
  for (; at < length; at++) {
    if (units[at] < 0x20u || units[at] == '"' || units[at] == '\\') {
      return at;
    }
  }
  return length;
#endif
}

/* The first unit at or after `at` that JSON text escapes in a narrow string's
 * `units`, or `length`. A narrow string holds no surrogate, so every candidate
 * is an answer. Inline for fewer than 16 units left: one 16-byte window
 * where the string has sixteen units, up to two words where it has eight,
 * else a unit at a time. */
__attribute__((always_inline)) static inline uint32_t
nts_json_scan_narrow(const unsigned char *units, uint32_t at, uint32_t length) {
  if (length - at >= 16u) {
    return nts_json_scan_narrow_long(units, at, length);
  }
#if defined(__SSE2__)
  if (length >= 16u) {
    const uint32_t from = length - 16u;
    const uint32_t mask = nts_json_escapes_in_16(units + from) >> (at - from);
    return mask != 0u ? at + (uint32_t)__builtin_ctz(mask) : length;
  }
#endif
#if __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
  while (at < length && length >= 8u) {
    const uint32_t from = length - at < 8u ? length - 8u : at;
    uint64_t word;
    memcpy(&word, units + from, sizeof word);
    const uint64_t mask = nts_json_escapes_in_word(word) >> (8u * (at - from));
    if (mask != 0u) {
      return at + (uint32_t)__builtin_ctzll(mask) / 8u;
    }
    at = from + 8u;
  }
#endif
  for (; at < length; at++) {
    if (units[at] < 0x20u || units[at] == '"' || units[at] == '\\') {
      return at;
    }
  }
  return length;
}

/* The first unit at or after `at` in a wide string's `units` that JSON text
 * escapes or that is a surrogate, which it escapes unless its partner is
 * beside it; or `length`. */
static uint32_t nts_json_candidates_wide(const uint16_t *units, uint32_t at,
                                         uint32_t length) {
#if defined(__AVX2__)
  const __m256i quote = _mm256_set1_epi16('"');
  const __m256i backslash = _mm256_set1_epi16('\\');
  const __m256i control = _mm256_set1_epi16(0x1F);
  const __m256i surrogate_bits = _mm256_set1_epi16((short)0xF800);
  const __m256i surrogate = _mm256_set1_epi16((short)0xD800);
  while (at < length && length >= 16u) {
    const uint32_t from = length - at < 16u ? length - 16u : at;
    const __m256i x =
        _mm256_loadu_si256((const __m256i *)(const void *)(units + from));
    const __m256i hits = _mm256_or_si256(
        _mm256_or_si256(_mm256_cmpeq_epi16(x, quote),
                        _mm256_cmpeq_epi16(x, backslash)),
        _mm256_or_si256(_mm256_cmpeq_epi16(_mm256_min_epu16(x, control), x),
                        _mm256_cmpeq_epi16(_mm256_and_si256(x, surrogate_bits),
                                           surrogate)));
    /* Two mask bits a unit. */
    const uint32_t mask =
        (uint32_t)_mm256_movemask_epi8(hits) >> (2u * (at - from));
    if (mask != 0u) {
      return at + (uint32_t)__builtin_ctz(mask) / 2u;
    }
    at = from + 16u;
  }
#endif
  for (; at < length; at++) {
    const uint16_t unit = units[at];
    if (unit < 0x20u || unit == '"' || unit == '\\' ||
        (unit & 0xF800u) == 0xD800u) {
      return at;
    }
  }
  return length;
}

/* `nts_json_scan_narrow` for a wide string: its candidates, less each lead
 * whose trail follows it, which is one code point written as it stands. */
static NTS_NOINLINE uint32_t nts_json_scan_wide(const uint16_t *units,
                                                uint32_t at, uint32_t length) {
  for (;;) {
    at = nts_json_candidates_wide(units, at, length);
    if (at == length || (units[at] & 0xF800u) != 0xD800u) {
      return at;
    }
    if (units[at] > 0xDBFFu || at + 1u == length ||
        (units[at + 1u] & 0xFC00u) != 0xDC00u) {
      return at;
    }
    at += 2u;
  }
}

/* The first unit at or after `at` that JSON text escapes in `s`, or its
 * length. */
__attribute__((always_inline)) static inline uint32_t
nts_json_scan(const NtsString *s, uint32_t at) {
  if ((s->flags & NTS_TWO_BYTE) != 0) {
    return nts_json_scan_wide(NTS_ELEMENTS(s, const uint16_t), at, s->length);
  }
  return nts_json_scan_narrow(NTS_ELEMENTS(s, const unsigned char), at,
                              s->length);
}

/* The escape JSON text writes for `unit`, which it escapes, into `text`; how
 * many units it is. */
static uint32_t nts_json_escape(char text[6], uint16_t unit) {
  static const char hex[] = "0123456789abcdef";
  text[0] = '\\';
  switch (unit) {
  case '"':
    text[1] = '"';
    return 2u;
  case '\\':
    text[1] = '\\';
    return 2u;
  case '\b':
    text[1] = 'b';
    return 2u;
  case '\t':
    text[1] = 't';
    return 2u;
  case '\n':
    text[1] = 'n';
    return 2u;
  case '\f':
    text[1] = 'f';
    return 2u;
  case '\r':
    text[1] = 'r';
    return 2u;
  default:
    text[1] = 'u';
    text[2] = hex[unit >> 12];
    text[3] = hex[(unit >> 8) & 0xFu];
    text[4] = hex[(unit >> 4) & 0xFu];
    text[5] = hex[unit & 0xFu];
    return 6u;
  }
}

/* How many units `s` quoted takes, `first` being its first escape: its own,
 * the two quotes, and what each escape adds. Refused past the longest string
 * this runtime builds, counting the `before` units it is appended to, as
 * `nts_str_raw` refuses the string the TypeScript would have made. */
static uint32_t nts_json_quoted_length(uint32_t before, const NtsString *s,
                                       uint32_t first) {
  uint64_t total = (uint64_t)s->length + 2u;
  char text[6];
  for (uint32_t at = first; at < s->length; at = nts_json_scan(s, at + 1u)) {
    total += nts_json_escape(text, nts_unit(s, at)) - 1u;
  }
  if ((uint64_t)before + total > (uint64_t)NTS_MAX_LENGTH) {
    fprintf(stderr, NTS_REFUSED "a string of %llu code units is too long\n",
            (unsigned long long)((uint64_t)before + total));
    abort();
  }
  return (uint32_t)total;
}

/* `count` units of ASCII `text` into `out` at unit `into`; where it ends. */
static inline uint32_t nts_json_put_text(NtsString *out, uint32_t into,
                                         const char *text, uint32_t count) {
  if ((out->flags & NTS_TWO_BYTE) != 0) {
    uint16_t *units = NTS_ELEMENTS(out, uint16_t) + into;
    for (uint32_t i = 0; i < count; i++) {
      units[i] = (unsigned char)text[i];
    }
  } else {
    unsigned char *bytes = NTS_ELEMENTS(out, unsigned char) + into;
    for (uint32_t i = 0; i < count; i++) {
      bytes[i] = (unsigned char)text[i];
    }
  }
  return into + count;
}

/* Units [from, to) of `s` into `out` at unit `into`, widened where `out` is
 * wide and `s` is not; where they end. `out` is never narrower than `s`. */
static inline uint32_t nts_json_put_units(NtsString *out, uint32_t into,
                                          const NtsString *s, uint32_t from,
                                          uint32_t to) {
  const uint32_t count = to - from;
  if ((out->flags & NTS_TWO_BYTE) == 0) {
    memcpy(NTS_ELEMENTS(out, unsigned char) + into,
           NTS_ELEMENTS(s, const unsigned char) + from, count);
  } else if ((s->flags & NTS_TWO_BYTE) != 0) {
    memcpy(NTS_ELEMENTS(out, uint16_t) + into,
           NTS_ELEMENTS(s, const uint16_t) + from,
           (size_t)count * sizeof(uint16_t));
  } else {
    uint16_t *units = NTS_ELEMENTS(out, uint16_t) + into;
    const unsigned char *bytes = NTS_ELEMENTS(s, const unsigned char) + from;
    for (uint32_t i = 0; i < count; i++) {
      units[i] = bytes[i];
    }
  }
  return into + count;
}

/* `s` quoted, into `out` from unit `into` on, `first` being its first escape:
 * the quote, each plain run and each escape, the quote, and the terminator.
 * Every escape after the first is found by the same scan, resuming where the
 * last stopped, so `s` is read once end to end.
 *
 * `out` may be `s` itself, appended to in place: everything written lands at
 * or past `into`, which is at or past `s`'s length, and everything read is
 * before it. */
static uint32_t nts_json_write(NtsString *out, uint32_t into,
                               const NtsString *s, uint32_t first) {
  const uint32_t length = s->length;
  char text[6];
  uint32_t plain = 0;
  into = nts_json_put_text(out, into, "\"", 1u);
  for (uint32_t at = first; at < length; at = nts_json_scan(s, plain)) {
    into = nts_json_put_units(out, into, s, plain, at);
    into = nts_json_put_text(out, into, text,
                             nts_json_escape(text, nts_unit(s, at)));
    plain = at + 1u;
  }
  into = nts_json_put_units(out, into, s, plain, length);
  into = nts_json_put_text(out, into, "\"", 1u);
  if ((out->flags & NTS_TWO_BYTE) != 0) {
    NTS_ELEMENTS(out, uint16_t)[into] = 0;
  } else {
    NTS_ELEMENTS(out, unsigned char)[into] = 0;
  }
  return into;
}

/* How far past the first escape a string is written in one pass, into room
 * for the worst case -- six units for each unit left -- rather than counted
 * first and scanned twice. 64 units: at most 320 units of room a string never
 * uses, and only one that has an escape; one with none is sized exactly. */
#define NTS_JSON_ONE_PASS 64u

/* The room `s` quoted needs after `before` units, `first` being its first
 * escape: exact where nothing or more than `NTS_JSON_ONE_PASS` units follow
 * it, else the worst case for what does (`nts_json_write` answers the exact
 * end). Refused past the longest string, as `nts_json_quoted_length` is. */
static uint32_t nts_json_room(uint32_t before, const NtsString *s,
                              uint32_t first) {
  const uint32_t tail = s->length - first;
  if (tail == 0u || tail > NTS_JSON_ONE_PASS) {
    return nts_json_quoted_length(before, s, first);
  }
  const uint64_t total = (uint64_t)s->length + 2u + 5u * (uint64_t)tail;
  if ((uint64_t)before + total > (uint64_t)NTS_MAX_LENGTH) {
    return nts_json_quoted_length(before, s, first);
  }
  return (uint32_t)total;
}

/* `a + quoteJSONString(s)`, by `nts_str_append_*`'s rules: wide where either
 * side is, as `nts_str_append` widens, and `s` read whole before `a` is
 * reserved, since it may be `a` itself. */
__attribute__((always_inline)) static inline NtsString *
nts_str_add_json_quoted(NtsString *a, const NtsString *s, int consume) {
  const uint32_t first = nts_json_scan(s, 0u);
  const uint32_t at = a->length;
  const int wide = (s->flags & NTS_TWO_BYTE) != 0;
  uint32_t room = nts_json_room(at, s, first);
  /* The worst case only where it is written in place anyway: an estimate
   * must never be what makes the append grow its string. */
  if (room != s->length + 2u &&
      !(consume && a->reserved == 1u &&
        (wide == 0 || (a->flags & NTS_TWO_BYTE) != 0) &&
        at + room <= nts_str_capacity(a))) {
    room = nts_json_quoted_length(at, s, first);
  }
  NtsString *out = nts_str_room(a, room, wide, consume);
  out->length = nts_json_write(out, at, s, first);
  return nts_str_written(out, a, consume);
}

NtsString *nts_json_quote(const NtsString *s) {
  const uint32_t first = nts_json_scan(s, 0u);
  NtsString *out =
      nts_str_raw(nts_json_room(0u, s, first), (s->flags & NTS_TWO_BYTE) != 0);
  out->length = nts_json_write(out, 0u, s, first);
  return out;
}

double nts_json_first_escape(const NtsString *s, double from) {
  /* The TypeScript loop's own guard: nothing from the end on, nor from NaN. */
  if (!(from < (double)s->length)) {
    return -1.0;
  }
  const uint32_t at = nts_json_scan(s, from > 0.0 ? (uint32_t)from : 0u);
  return at == s->length ? -1.0 : (double)at;
}

NtsString *nts_str_append_json_quoted(NtsString *a, const NtsString *s) {
  return nts_str_add_json_quoted(a, s, 1);
}

NtsString *nts_str_concat_json_quoted(const NtsString *a, const NtsString *s) {
  return nts_str_add_json_quoted((NtsString *)a, s, 0);
}

/* The elements of an array of numbers. */
static double *nts_numbers(const NtsArray *a) { return NTS_ITEMS(a, double); }

double nts_array_index_of(const NtsArray *a, double needle) {
  /* Strict equality, so a NaN is never found -- `[NaN].indexOf(NaN)` is -1.
   * `includes` differs here, deliberately. */
  const double *items = nts_numbers(a);
  for (uint32_t at = 0; at < a->header.length; at++) {
    if (items[at] == needle) {
      return (double)at;
    }
  }
  return -1.0;
}

double nts_array_last_index_of(const NtsArray *a, double needle) {
  const double *items = nts_numbers(a);
  for (uint32_t step = 0; step < a->header.length; step++) {
    uint32_t at = a->header.length - 1u - step;
    if (items[at] == needle) {
      return (double)at;
    }
  }
  return -1.0;
}

bool nts_array_includes(const NtsArray *a, double needle) {
  /* SameValueZero, which is `===` except that it finds a NaN. That one
   * difference is the thing an implementation is most likely to get wrong. */
  const double *items = nts_numbers(a);
  const int wanted_nan = needle != needle;
  for (uint32_t at = 0; at < a->header.length; at++) {
    if (wanted_nan ? items[at] != items[at] : items[at] == needle) {
      return true;
    }
  }
  return false;
}

double nts_array_at(const NtsArray *a, double at) {
  /* Out of range is `undefined`, and NaN is what a double has to say it with.
   * See `nts_array_pop` -- the compiler calls this one only where the result
   * was narrowed to a number. */
  double offset = nts_array_offset(a, at);
  return offset < 0 ? (double)NAN : nts_numbers(a)[(uint32_t)offset];
}

/* `at` where the result keeps its `undefined`. See `nts_array_pop_value`. */
NtsValue nts_array_at_value(const NtsArray *a, double at) {
  double offset = nts_array_offset(a, at);
  return offset < 0 ? nts_absent_number()
                    : nts_value_of_number(nts_numbers(a)[(uint32_t)offset]);
}

/* Hand back the array that was passed in, *borrowed*.
 *
 * `fill` and `reverse` work in place and return their receiver, which is what
 * makes `xs.fill(0).length` mean something. The receiver is a parameter, and
 * this function holds it only because its caller does.
 *
 * There was a retain here, and it was right for as long as a call's result was
 * unconditionally owned: without it the caller released its own reference *and*
 * this one, and the array was freed while still in use -- a live count that
 * went negative and elements that came back as whatever was allocated over
 * them, found by giving `examples/arrays` a `slice` and a `reverse` in one
 * expression. Invisible under NoGC, which frees nothing.
 *
 * What changed is the caller, not the argument. `own::RUNTIME_HANDS_BACK` names
 * these functions, so the result is recognized as one of the arguments and
 * borrowed -- and where the borrow cannot be proved safe the caller takes a
 * reference of its own rather than assuming this one. Retaining here as well
 * would be the same bug pointing the other way. */
static NtsArray *nts_array_same(NtsArray *a) { return a; }

NtsArray *nts_array_fill(NtsArray *a, double value) {
  double *items = nts_numbers(a);
  for (uint32_t at = 0; at < a->header.length; at++) {
    items[at] = value;
  }
  /* In place, returning what it was given -- which is what makes
   * `xs.fill(0).length` mean something. */
  return nts_array_same(a);
}

NtsArray *nts_array_fill_bool(NtsArray *a, bool value) {
  bool *items = NTS_ITEMS(a, bool);
  for (uint32_t at = 0; at < a->header.length; at++) {
    items[at] = value;
  }
  return nts_array_same(a);
}

static inline NtsArray *nts_array_fill_counted(NtsArray *a, void *value,
                                               void *(*retain)(void *),
                                               void (*release)(void *),
                                               bool foreign) {
  void **items = NTS_ITEMS(a, void *);
  for (uint32_t at = 0; at < a->header.length; at++) {
    /* Retain before release, so filling an array with something it already
     * holds cannot free the value between the two. */
    retain(value);
    if (foreign) {
      nts_call_foreign_release(release, items[at]);
    } else {
      release(items[at]);
    }
    items[at] = value;
  }
  return nts_array_same(a);
}
NtsArray *nts_array_fill_ref(NtsArray *a, void *value) {
  return nts_array_fill_counted(a, value, nts_count_managed,
                                nts_uncount_managed, false);
}
NtsArray *nts_array_fill_foreign(NtsArray *a, void *value) {
  const NtsFamilyOps *ops = nts_array_family(a);
  return nts_array_fill_counted(a, value, ops->retain, ops->release, true);
}

/* The coercions, as linkable symbols.
 *
 * `nts_to_int32` and its siblings are `static inline` in the header, which is
 * right for C -- every translation unit gets the ten instructions rather than a
 * call -- and invisible to any backend that is not a C compiler. A header is
 * not a contract another code generator can read.
 *
 * So the inline stays and this stands beside it: one definition, called by
 * nobody in C, giving a second backend a symbol to link against. It is the
 * smallest possible statement of the rule that what the runtime *offers* has
 * to be linkable, and the first thing across the C-to-LLVM boundary -- a double
 * in, an `int32_t` out, which is the simplest ABI there is to be wrong about.
 */
int32_t nts_to_int32_fn(double x) { return nts_to_int32(x); }

/* The presence bits, for exactly the same reason: two instructions in C and a
 * symbol everywhere else. The shift they apply is defined once, in the header,
 * and these are what stop a backend from needing to know it. */
/* `"k" in v` where `v` is `object` and some type declares `k` optionally. The
 * caller pairs this with an `instanceof`, so a non-reference reaching here is
 * the arm that already answered false. */
bool nts_presence_has_value(NtsValue value, uint32_t index) {
  if (!NTS_TAG_IS_MANAGED(nts_value_tag(value))) {
    return false;
  }
  const NtsHeader *object = nts_value_reference(value);
  return object && nts_presence_has(object, index);
}

void nts_presence_init_fn(NtsHeader *object, uint32_t mask) {
  nts_presence_init(object, mask);
}

void nts_presence_set_fn(NtsHeader *object, uint32_t index) {
  nts_presence_set(object, index);
}

void nts_presence_clear_fn(NtsHeader *object, uint32_t index) {
  nts_presence_clear(object, index);
}

bool nts_presence_has_fn(const NtsHeader *object, uint32_t index) {
  return nts_presence_has(object, index);
}

/* Rounding, for the same reason and with more in it: the header's definition
 * carries three cases a backend would have to get right on its own -- the half
 * that goes toward positive infinity, the value already integral near 2^53, and
 * the negative zero that `1 / x` can still tell apart. */
double nts_round_fn(double x) { return nts_round(x); }

/* The two comparisons, for the same reason. A backend that lowered these to
 * `llvm.minnum` would be right on ordinary numbers and wrong on both of the
 * cases these definitions exist for. */
double nts_min_fn(double a, double b) { return nts_min(a, b); }
double nts_max_fn(double a, double b) { return nts_max(a, b); }

/* The bounds checks, likewise. A backend that cannot read a C header cannot
 * inline `nts_check`, and reproducing it would be a second implementation of
 * the same rule to keep in step with the first. */
uint32_t nts_check_fn(const NtsArray *array, uint32_t index) {
  return nts_check(array, index);
}

uint32_t nts_index_fn(const NtsArray *array, double index) {
  return nts_index(array, index);
}

/* The growing pair, for the same reason: a backend that cannot inline needs the
 * rule as a symbol rather than a second copy of it. */
uint32_t nts_check_or_grow_fn(NtsArray *array, uint32_t index) {
  return nts_check_or_grow(array, index);
}

uint32_t nts_slot_or_grow_fn(NtsArray *array, double index) {
  return nts_slot_or_grow(array, index);
}

uint32_t nts_view_check_fn(const NtsView *view, uint32_t index) {
  return nts_view_check(view, index);
}

uint32_t nts_view_index_fn(const NtsView *view, double index) {
  return nts_view_index(view, index);
}

/* The frame-placed substring, likewise. Under `-flto` this is inlined and the
 * fast path costs a backend that cannot read the header nothing; without it,
 * one call -- still far cheaper than the allocation it replaces. */
__attribute__((always_inline)) NtsString *
nts_str_substring_into_fn(NtsHeader *into, const NtsString *s, double from,
                          double to) {
  return nts_str_substring_into(into, s, from, to);
}

/* The narrow coercions as linkable symbols. Each is one instruction around the
 * `uint32` reduction they already share, so out of line they cost a call that
 * `-flto` removes -- and in exchange a backend that cannot read a `static
 * inline` can compile `Uint8Array` arithmetic at all. `benches/cases/bytes` was
 * refused outright for want of one symbol. */
int8_t nts_to_int8_fn(double x) { return nts_to_int8(x); }
uint8_t nts_to_uint8_fn(double x) { return nts_to_uint8(x); }
int16_t nts_to_int16_fn(double x) { return nts_to_int16(x); }
uint16_t nts_to_uint16_fn(double x) { return nts_to_uint16(x); }

/* Reading a code unit, and the truthiness of a string.
 *
 * Both are `static inline` in the header for C's benefit and unreadable to any
 * other backend. Truthiness in particular is worth not reproducing: a string is
 * falsy when it is absent *or* empty, which is a null test and a length test
 * with a short circuit between them, and an LLVM backend that inlined it would
 * have to invent a basic block to keep the load out of the null case. */
uint16_t nts_unit_fn(const NtsString *s, uint32_t at) {
  return nts_unit(s, at);
}

double nts_str_char_code_at_fn(const NtsString *s, double at) {
  return nts_str_char_code_at(s, at);
}

double nts_str_char_code_at_int_fn(const NtsString *s, int64_t at) {
  return nts_str_char_code_at_int(s, at);
}

bool nts_string_truthy(const NtsString *s) { return s != 0 && s->length != 0; }

/* The linkable companion to `nts_value_truthy`, which is a `static inline`.
 *
 * The C backend writes the inline one at the call site and the second backend
 * cannot: it emits calls by name, and a `static inline` has no name to call.
 * The same reason `nts_to_int32_fn` and `nts_round_fn` exist, and the same
 * suffix. */
bool nts_value_truthy_fn(NtsValue value) { return nts_value_truthy(value); }

/* And the same for the two mixed comparisons that are `static inline`.
 *
 * `x === 3` where `x` is erased is a tag test and a compare, which is small
 * enough to write at the call site and is why the header has it inline. The
 * second backend still needs a symbol. */
bool nts_value_eq_number_fn(NtsValue value, double number) {
  return nts_value_eq_number(value, number);
}

bool nts_value_eq_boolean_fn(NtsValue value, bool boolean) {
  return nts_value_eq_boolean(value, boolean);
}

uint32_t nts_to_uint32_fn(double x) { return nts_to_uint32(x); }

/* `String.fromCharCode(x)`: one UTF-16 code unit, from `ToUint16(x)`.
 *
 * `ToUint16` rather than a cast. The specification truncates towards zero,
 * takes the result modulo 2^16, and gives 0 for NaN and both infinities -- so
 * `String.fromCharCode(65601)` is "A" and `String.fromCharCode(NaN)` is
 * "\u0000". A `(uint16_t)` cast in C reaches the first of those by accident and
 * the second is undefined behaviour, which is why the conversion is shared with
 * the bitwise operators rather than written again here. */
NtsString *nts_string_from_char_code(double code) {
  return nts_string_from_char_code_into(NULL, code);
}

NtsString *nts_string_from_char_code_into(NtsHeader *into, double code) {
  uint16_t unit = nts_to_uint16(code);
  int wide = unit > 0xFFu;
  NtsString *out = nts_str_build(into, 1, wide);
  if (wide) {
    NTS_ELEMENTS(out, uint16_t)[0] = unit;
    NTS_ELEMENTS(out, uint16_t)[1] = 0;
  } else {
    NTS_ELEMENTS(out, unsigned char)[0] = (unsigned char)unit;
    NTS_ELEMENTS(out, unsigned char)[1] = 0;
  }
  return out;
}

/* `String.fromCodePoint(x)`, which is a different function and not a longer
 * name for the one above.
 *
 * A code point above 0xFFFF is *two* code units, so this can return a string of
 * length 2 where `fromCharCode` always returns one.
 *
 * **The range check is not here.** node throws a `RangeError` for anything that
 * is not an integer in [0, 0x10FFFF], and a `RangeError` is laid out by the
 * *program* -- its descriptor lives in the generated file -- so this function
 * has nothing to allocate and never did. It used to print the value and
 * `abort()` on that reasoning, which took the process down where node throws
 * something catchable: `punycode.ucs2.encode([NaN])` could not be tested at all
 * rather than failing one assertion. `hir::lower::guard_code_point` makes the
 * check where the class can be built, which is where `"x".repeat(-1)` already
 * put its own.
 *
 * What is left here is the empty string, and it is chosen the same way
 * `nts_str_repeat` chooses its clamp: a value that reaches this line got past
 * the guard, so the guard is broken, and the useful behaviour is the one a
 * differential can SEE. An `abort()` is a crashed case, which the harness
 * scores as declined and the step still reports as agreement -- measured, by
 * moving the guard's ceiling one past `0x10FFFF` and watching the suite stay
 * green. An empty string is a wrong answer, and a wrong answer is caught. */
NtsString *nts_string_from_code_point(double point) {
  return nts_string_from_code_point_into(NULL, point);
}

NtsString *nts_string_from_code_point_into(NtsHeader *into, double point) {
  if (!(point >= 0.0 && point <= 1114111.0) || point != nts_to_integer(point)) {
    return nts_str_build(into, 0, 0);
  }
  uint32_t value = (uint32_t)point;
  if (value <= 0xFFFFu) {
    return nts_string_from_char_code_into(into, (double)value);
  }
  NtsString *out = nts_str_build(into, 2, 1);
  uint16_t *units = NTS_ELEMENTS(out, uint16_t);
  value -= 0x10000u;
  units[0] = (uint16_t)(0xD800u + (value >> 10));
  units[1] = (uint16_t)(0xDC00u + (value & 0x3FFu));
  units[2] = 0;
  return out;
}

/* Copy one string's code units into another at an offset, at its width. */
static void nts_copy_units(NtsString *out, uint32_t offset,
                           const NtsString *from, int wide) {
  if (wide) {
    nts_widen(NTS_ELEMENTS(out, uint16_t) + offset, from);
  } else {
    memcpy(NTS_ELEMENTS(out, unsigned char) + offset,
           NTS_ELEMENTS(from, unsigned char), from->length);
  }
}

/* `join`, on an array whose elements are strings.
 *
 * Two passes, because a string is one allocation of a known length rather than
 * a builder: the first adds up the code units and asks whether any of them
 * needs two bytes, the second writes. Repeated `nts_concat` would reach the
 * same answer in quadratic time, leaving every intermediate behind.
 *
 * node writes an empty string for a `null` or `undefined` element, which a
 * `string[]` cannot hold -- and the compiler calls this only where the element
 * type says as much, so there is no absence to spell here. */
/* Defined with the number formatter further down, and used here: `join` is a
 * string operation and belongs beside the other one, while the digit loop
 * belongs beside `nts_number_to_string`. Moving either to satisfy C's ordering
 * would put one of them in the wrong chapter. */
static int nts_u32toa(char *buf, uint32_t n);
static uint32_t nts_number_format(char *out, double x);

/* One element of a numeric `join`, formatted into `out` and its length
 * returned.
 *
 * `out` needs 32 bytes: the widest answer `nts_number_format` writes is 25
 * characters (`-0.000001` and seventeen digits). It is the formatter every
 * number sink shares, so a fraction is written in place here too, with no
 * string made and freed for it. */
static uint32_t nts_join_one(char *out, double x) {
  return nts_number_format(out, x);
}

/* Write `length` ASCII characters at `offset`, into either storage. */
static void nts_join_put(NtsString *out, uint32_t offset, const char *from,
                         uint32_t length, int wide) {
  if (wide) {
    uint16_t *into = NTS_ELEMENTS(out, uint16_t) + offset;
    for (uint32_t at = 0; at < length; at++) {
      into[at] = (uint16_t)(unsigned char)from[at];
    }
  } else {
    memcpy(NTS_ELEMENTS(out, unsigned char) + offset, from, length);
  }
}

/* `join`, on an array of numbers.
 *
 * The same two passes `nts_array_join_str` takes and one difference that
 * decides the shape: an element has no length until it is formatted, so the
 * first pass formats to measure and the second formats again to write. Storing
 * the first pass's answers would be an allocation per element or a second
 * buffer as large as the result, and formatting an integer twice is a digit
 * loop twice.
 *
 * Narrow unless the *separator* is wide, because every character a number
 * formats to is ASCII. */
NtsString *nts_array_join_num(const NtsArray *a, const NtsString *sep) {
  const double *items = NTS_ITEMS(a, const double);
  uint32_t count = a->header.length;
  char scratch[32];
  uint32_t total = count > 1u ? sep->length * (count - 1u) : 0u;
  for (uint32_t at = 0; at < count; at++) {
    total += nts_join_one(scratch, items[at]);
  }
  int wide = count > 1u && (sep->flags & NTS_TWO_BYTE) != 0;
  NtsString *out = nts_str_build(NULL, total, wide);
  uint32_t written = 0;
  for (uint32_t at = 0; at < count; at++) {
    if (at != 0) {
      nts_copy_units(out, written, sep, wide);
      written += sep->length;
    }
    uint32_t length = nts_join_one(scratch, items[at]);
    nts_join_put(out, written, scratch, length, wide);
    written += length;
  }
  if (wide) {
    NTS_ELEMENTS(out, uint16_t)[total] = 0;
  } else {
    NTS_ELEMENTS(out, unsigned char)[total] = 0;
  }
  return out;
}

/* The same over a view, which differs only in how an element is read: a view
 * has an element width and an offset into a buffer, so `nts_view_get` is the
 * one place that knows how to fetch one. */
NtsString *nts_view_join(const NtsView *view, const NtsString *sep) {
  uint32_t count = (uint32_t)nts_view_length(view);
  char scratch[32];
  uint32_t total = count > 1u ? sep->length * (count - 1u) : 0u;
  for (uint32_t at = 0; at < count; at++) {
    total += nts_join_one(scratch, nts_view_get(view, (double)at));
  }
  int wide = count > 1u && (sep->flags & NTS_TWO_BYTE) != 0;
  NtsString *out = nts_str_build(NULL, total, wide);
  uint32_t written = 0;
  for (uint32_t at = 0; at < count; at++) {
    if (at != 0) {
      nts_copy_units(out, written, sep, wide);
      written += sep->length;
    }
    uint32_t length = nts_join_one(scratch, nts_view_get(view, (double)at));
    nts_join_put(out, written, scratch, length, wide);
    written += length;
  }
  if (wide) {
    NTS_ELEMENTS(out, uint16_t)[total] = 0;
  } else {
    NTS_ELEMENTS(out, unsigned char)[total] = 0;
  }
  return out;
}

NtsString *nts_array_join_str(const NtsArray *a, const NtsString *sep) {
  const NtsString *const *items = NTS_ITEMS(a, const NtsString *);
  uint32_t count = a->header.length;
  uint32_t total = count > 1u ? sep->length * (count - 1u) : 0u;
  int wide = count > 1u && (sep->flags & NTS_TWO_BYTE) != 0;
  /* **An absent element joins as nothing.** A `(string | undefined)[]` or a
   * `(string | null)[]` keeps its absent slots as null references, and JS
   * joins `null` and `undefined` alike as the empty string. Read without the
   * test, the slot's length was a load through null: SIGSEGV on C and LLVM
   * (tooling/conformance/outcomes/a-join-over-an-absent-string-element). */
  for (uint32_t at = 0; at < count; at++) {
    if (!items[at]) {
      continue;
    }
    total += items[at]->length;
    wide |= (items[at]->flags & NTS_TWO_BYTE) != 0;
  }
  NtsString *out = nts_str_build(NULL, total, wide);
  uint32_t written = 0;
  for (uint32_t at = 0; at < count; at++) {
    if (at != 0) {
      nts_copy_units(out, written, sep, wide);
      written += sep->length;
    }
    if (!items[at]) {
      continue;
    }
    nts_copy_units(out, written, items[at], wide);
    written += items[at]->length;
  }
  if (wide) {
    NTS_ELEMENTS(out, uint16_t)[total] = 0;
  } else {
    NTS_ELEMENTS(out, unsigned char)[total] = 0;
  }
  return out;
}

/* `Array.prototype.toString`: the elements joined by `","`, `null` and
 * `undefined` contributing nothing and everything else its own text, so an
 * array inside an array is joined in turn. Each element is read as an erased
 * value (`nts_array_element`), the one reader that knows every element kind
 * and refuses one it does not.
 *
 * **An array that contains itself prints the inner occurrence as empty**, as
 * node does: its join keeps the arrays it is inside of on a stack, and this
 * one does the same rather than recursing until the stack runs out. */
#define NTS_JOIN_DEPTH 64u
static _Thread_local const NtsHeader *nts_joining[NTS_JOIN_DEPTH];
static _Thread_local uint32_t nts_joining_depth;

NtsString *nts_array_to_string(const NtsHeader *object) {
  for (uint32_t at = 0; at < nts_joining_depth; at++) {
    if (nts_joining[at] == object) {
      return NTS_TEXT("");
    }
  }
  if (nts_joining_depth == NTS_JOIN_DEPTH) {
    fprintf(stderr,
            NTS_REFUSED "the text of an array nested more than %u "
                        "deep\n",
            NTS_JOIN_DEPTH);
    abort();
  }
  nts_joining[nts_joining_depth++] = object;
  uint32_t count = object->length;
  NtsValue array = nts_value_of_reference((NtsHeader *)object, NTS_TAG_OBJECT);
  NtsString **parts = count ? malloc(sizeof(NtsString *) * count) : NULL;
  if (count && !parts) {
    fprintf(stderr, NTS_REFUSED "out of memory joining an array\n");
    abort();
  }
  uint32_t total = count > 1u ? count - 1u : 0u;
  int wide = 0;
  for (uint32_t at = 0; at < count; at++) {
    /* Either absence joins as nothing, so which one a null slot is does not
     * matter here. */
    NtsValue element = nts_array_element(array, (double)at, NTS_TAG_UNDEFINED);
    uint32_t tag = nts_value_tag(element);
    parts[at] = tag == NTS_TAG_UNDEFINED || tag == NTS_TAG_NULL
                    ? NTS_TEXT("")
                    : nts_value_to_string(element);
    nts_value_release(element);
    if (nts_raising()) {
      /* Only completed strings belong to this prefix. The failed call's
       * placeholder must never be read, and the outer language boundary owns
       * the pending payload. A foreign release during cleanup has its own
       * pending state through nts_call_foreign_release. */
      for (uint32_t done = 0; done < at; done++) {
        nts_release((NtsHeader *)parts[done]);
      }
      free(parts);
      nts_joining[--nts_joining_depth] = NULL;
      return NULL;
    }
    total += parts[at]->length;
    wide |= (parts[at]->flags & NTS_TWO_BYTE) != 0;
  }
  NtsString *out = nts_str_build(NULL, total, wide);
  uint32_t written = 0;
  for (uint32_t at = 0; at < count; at++) {
    if (at != 0) {
      nts_join_put(out, written, ",", 1u, wide);
      written += 1u;
    }
    nts_copy_units(out, written, parts[at], wide);
    written += parts[at]->length;
    nts_release(parts[at]);
  }
  free(parts);
  if (wide) {
    NTS_ELEMENTS(out, uint16_t)[total] = 0;
  } else {
    NTS_ELEMENTS(out, unsigned char)[total] = 0;
  }
  nts_joining[--nts_joining_depth] = NULL;
  return out;
}

const NtsHeader nts_bound_function_name = {0};

/* What a function is called, off its descriptor: `""` is a name, and a null
 * entry is a refusal, never a guess. Owned, as every `NtsString *` a helper
 * returns is: the compiler's names are immortal, and a bound function's is
 * made here. */
static NtsString *nts_function_name_of(const NtsHeader *function) {
  const NtsDescriptor *descriptor = function ? function->descriptor : NULL;
  const NtsHeader *name = descriptor ? descriptor->function_name : NULL;
  if (name == &nts_bound_function_name && descriptor->references > 0) {
    const NtsHeader *target =
        *(NtsHeader *const *)((const char *)function + descriptor->offsets[0]);
    NtsString *of = nts_function_name_of(target);
    NtsString *prefix = NTS_TEXT("bound ");
    NtsString *out = nts_concat(prefix, of);
    nts_release((NtsHeader *)prefix);
    nts_release((NtsHeader *)of);
    return out;
  }
  if (name && name != &nts_bound_function_name) {
    nts_retain((NtsHeader *)name);
    return (NtsString *)name;
  }
  fprintf(stderr,
          NTS_REFUSED "the name of `%s`, whose type does not say what it is "
                      "called\n",
          descriptor && descriptor->name ? descriptor->name : "?");
  abort();
}

NtsString *nts_function_name(NtsValue function) {
  return nts_function_name_of(nts_value_reference(function));
}

/* A closure or a class token. Node prints the function's source text, which a
 * compiled program does not keep, so this prints what node and every browser
 * print for a function they have no source for: a built-in's, with its name. */
NtsString *nts_function_to_string(const NtsHeader *object) {
  static const char head[] = "function ";
  static const char tail[] = "() { [native code] }";
  NtsString *name = nts_function_name_of(object);
  int wide = (name->flags & NTS_TWO_BYTE) != 0;
  uint32_t at = sizeof head - 1u;
  uint32_t total = at + name->length + (uint32_t)(sizeof tail - 1u);
  NtsString *out = nts_str_build(NULL, total, wide);
  nts_join_put(out, 0, head, at, wide);
  nts_copy_units(out, at, name, wide);
  nts_join_put(out, at + name->length, tail, sizeof tail - 1u, wide);
  if (wide) {
    NTS_ELEMENTS(out, uint16_t)[total] = 0;
  } else {
    NTS_ELEMENTS(out, unsigned char)[total] = 0;
  }
  nts_release((NtsHeader *)name);
  return out;
}

static inline NtsArray *nts_array_slice_counted(const NtsArray *a, double from,
                                                double to,
                                                void *(*retain)(void *)) {
  uint32_t start = nts_str_clamp(from, a->header.length, 1);
  uint32_t end = nts_str_clamp(to, a->header.length, 1);
  uint32_t count = end > start ? end - start : 0u;
  NtsArray *out =
      nts_array_new_uninitialized(a->header.descriptor, (double)count);
  void *const *items = NTS_ITEMS(a, void *);
  void **into = NTS_ITEMS(out, void *);
  for (uint32_t at = 0; at < count; at++) {
    into[at] = retain(items[start + at]);
  }
  return out;
}
NtsArray *nts_array_slice_ref(const NtsArray *a, double from, double to) {
  return nts_array_slice_counted(a, from, to, nts_count_managed);
}
NtsArray *nts_array_slice_foreign(const NtsArray *a, double from, double to) {
  return nts_array_slice_counted(a, from, to, nts_array_family(a)->retain);
}

/* Shorten an array to its first `count` elements.
 *
 * What `filter` does *before* it writes any: it allocates the longest result it
 * could need -- one element per element of the input -- and then says the array
 * is empty, so the room is there and the length is nothing. `push` maintains
 * the length from then on and never reallocates, and the collector never sees a
 * slot the loop has not written.
 *
 * **Not a general `truncate`.** One of those would have to release what it
 * drops, and this releases nothing. It does not have to: the slots past `count`
 * hold what the allocation started with, and `filter` asks for a zeroed one
 * precisely so that this is true. The name says which of the two it is, because
 * the other one is what a caller reaching for a `truncate` would expect.
 *
 * One allocation for the whole method, and no reallocation. Growing from empty
 * is the other way to write it, and it is what a hand-written loop does, but it
 * pays a fresh block every time it doubles.
 *
 * Returns nothing, which is not an oversight. Handing the array back made the
 * result a value the caller had to decide the ownership of, and where the
 * borrow could not be proved safe -- across the loop that follows, it cannot --
 * that was a retain and a release for an array the function already owned. */
void nts_array_keep_first(NtsArray *a, double count) {
  uint32_t keep = count > 0.0 ? (uint32_t)count : 0u;
  if (keep < a->header.length) {
    a->header.length = keep;
  }
}

/* One merge pass over `[from, mid)` and `[mid, to)`, writing into `into`.
 *
 * `<=` on the left-hand element rather than `<`, which is the whole of what
 * makes this stable: where two compare equal the earlier one is taken first.
 * A null slot compares as `absent`, the text a `null` element sorts by. */
static void nts_merge_strings(NtsString **items, NtsString **into,
                              uint32_t from, uint32_t mid, uint32_t to,
                              NtsString *absent) {
  uint32_t left = from;
  uint32_t right = mid;
  for (uint32_t at = from; at < to; at++) {
    if (left < mid &&
        (right >= to ||
         nts_string_cmp(items[left] ? items[left] : absent,
                        items[right] ? items[right] : absent) <= 0)) {
      into[at] = items[left++];
    } else {
      into[at] = items[right++];
    }
  }
}

/* The default `sort` of an array of strings, where a null slot is the absence
 * `null_slot` names -- what the element type admits, which the lowering knows
 * and a null pointer does not say. `undefined` goes last, in order, without
 * being compared, as `SortCompare` is never called for it; `null` is compared
 * as the string "null", as `String(null)` is. Both were a dereference of the
 * null pointer here. */
NtsArray *nts_array_sort_str(NtsArray *a, uint32_t null_slot) {
  uint32_t length = a->header.length;
  NtsString **items = NTS_ITEMS(a, NtsString *);
  if (null_slot != NTS_TAG_NULL) {
    uint32_t present = 0;
    for (uint32_t at = 0; at < length; at++) {
      if (items[at]) {
        items[present++] = items[at];
      }
    }
    for (uint32_t at = present; at < length; at++) {
      items[at] = NULL;
    }
    length = present;
  }
  if (length < 2u) {
    return nts_array_same(a);
  }
  NtsString *absent = null_slot == NTS_TAG_NULL ? NTS_TEXT("null") : NULL;
  /* Aborts on failure, the way every other allocation here does. Returning the
   * array unsorted would be the permissive direction: a silent wrong answer in
   * the one situation where the program cannot notice. */
  NtsString **scratch =
      (NtsString **)malloc((size_t)length * sizeof(NtsString *));
  if (!scratch) {
    fprintf(stderr, "nts: out of memory\n");
    abort();
  }
  /* Bottom-up, so there is no recursion and no stack depth to bound: widths
   * double until one run covers the array, and the two buffers swap roles each
   * pass. An odd number of passes would leave the answer in `scratch`, so the
   * result is copied back when it does. */
  NtsString **from = items;
  NtsString **into = scratch;
  for (uint32_t width = 1u; width < length; width *= 2u) {
    for (uint32_t at = 0; at < length; at += width * 2u) {
      uint32_t mid = at + width < length ? at + width : length;
      uint32_t end = at + width * 2u < length ? at + width * 2u : length;
      nts_merge_strings(from, into, at, mid, end, absent);
    }
    NtsString **swap = from;
    from = into;
    into = swap;
  }
  if (from != items) {
    for (uint32_t at = 0; at < length; at++) {
      items[at] = from[at];
    }
  }
  free(scratch);
  if (absent) {
    nts_release((NtsHeader *)absent);
  }
  return nts_array_same(a);
}

NtsArray *nts_array_reverse_ref(NtsArray *a) {
  void **items = NTS_ITEMS(a, void *);
  for (uint32_t at = 0; at * 2u + 1u < a->header.length; at++) {
    void *swap = items[at];
    items[at] = items[a->header.length - 1u - at];
    items[a->header.length - 1u - at] = swap;
  }
  return nts_array_same(a);
}

NtsArray *nts_array_reverse(NtsArray *a) {
  double *items = nts_numbers(a);
  for (uint32_t at = 0; at * 2u + 1u < a->header.length; at++) {
    double swap = items[at];
    items[at] = items[a->header.length - 1u - at];
    items[a->header.length - 1u - at] = swap;
  }
  return nts_array_same(a);
}

/* `xs.splice(start, count)`: remove a run and hand it back.
 *
 * Two arguments only. The insert form takes as many more as it is given, and is
 * a different signature rather than a longer one; ten of the twelve `splice`
 * calls in `runtime/node` are this shape.
 *
 * The removed elements *move*. For an array of references the new array holds
 * them and the old one no longer does, so the count is unchanged either way and
 * nothing here retains or releases -- the same reason `nts_array_push_ref` is
 * consuming.
 *
 * Every one of those twelve calls throws the result away, which this cannot see
 * and so still allocates for. A `_void` form chosen where the result is dead
 * would be the fix, and it is a question about the caller rather than about
 * this. */
static NtsArray *nts_array_splice_at(NtsArray *a, double start, double count,
                                     size_t width) {
  uint32_t length = a->header.length;
  uint32_t from = nts_str_clamp(start, length, 1);
  uint32_t take = nts_str_clamp(count, length - from, 0);
  NtsArray *out =
      nts_array_new_uninitialized(a->header.descriptor, (double)take);
  unsigned char *items = (unsigned char *)a->elements;
  if (take != 0) {
    memcpy(out->elements, items + (size_t)from * width, (size_t)take * width);
  }
  memmove(items + (size_t)from * width, items + (size_t)(from + take) * width,
          (size_t)(length - from - take) * width);
  a->header.length = length - take;
  return out;
}

/* `a.length = n` -- truncation, which JavaScript does in place.
 *
 * `splice` is the only other helper that shortens an array, and it gets away
 * without releasing anything because it **moves** the dropped run into the
 * array it hands back: ownership transfers, the counts are unchanged. Here
 * nothing is handed back, so an array of references has to give up the counts
 * it holds on the elements it forgets, or they are leaked by a length store.
 *
 * The JVM lane does the same job with the opposite instruction. It has no
 * retains -- the platform collector owns everything -- so its equivalent is a
 * `fill(items, want, length, null)`: a stale reference left in the backing
 * array keeps its object alive for as long as the array does. The shared fact
 * is that **the dropped elements stop being reachable**, not that either lane
 * calls release, and reading it the other way makes that row look like it is
 * skipping a step.
 *
 * # What refuses, and the two reasons are not the same
 *
 * A non-integral or negative length is a `RangeError` in JavaScript, so this
 * refuses the way `nts_bigint_from_number` refuses a non-integer: there is no
 * `throw` to raise from here.
 *
 * **Growing does not throw in JavaScript** -- `xs.length = 10` on three
 * elements is legal and produces seven holes. It refuses here because a hole is
 * a shape this compiler has no representation for at all, so the honest answer
 * is a refusal rather than seven zeroes that read as elements. That is our
 * limitation rather than the language's, and it is worth the two being told
 * apart: every one of the 62 sites in the corpus shrinks. */
static void nts_array_set_length_at(NtsArray *a, double n, size_t width) {
  /* The bound is `ToUint32`, not whatever the cast below happens to saturate
   * at. `4294967295` is a length JavaScript accepts; `4294967296` is a
   * `RangeError`. Getting this from the cast instead would be the right outcome
   * by the wrong rule at one end and a **wrong answer** at the other:
   * `(uint32_t)4294967296` is 0, so the growth check would see a shrink to
   * empty and truncate the array silently. Caught because the JVM lane asked
   * node rather than asserting, and found its own bound was
   * `Integer.MAX_VALUE`. */
  if (!(n == nts_to_integer(n)) || n < 0 || n > 4294967295.0) {
    fprintf(stderr, NTS_REFUSED "%g is not a valid array length\n", n);
    abort();
  }
  uint32_t want = (uint32_t)n;
  uint32_t length = a->header.length;
  if (want > length) {
    fprintf(stderr,
            NTS_REFUSED
            "growing an array by its length would leave holes, which have no "
            "representation here (%u to %u)\n",
            length, want);
    abort();
  }
  (void)width;
  a->header.length = want;
}

void nts_array_set_length(NtsArray *a, double n) {
  nts_array_set_length_at(a, n, sizeof(double));
}

/* The reference case, which is the one the comment above is about. */
static inline void nts_array_set_length_counted(NtsArray *a, double n,
                                                void (*release)(void *),
                                                bool foreign) {
  uint32_t length = a->header.length;
  nts_array_set_length_at(a, n, sizeof(void *));
  for (uint32_t at = a->header.length; at < length; at++) {
    if (foreign) {
      nts_call_foreign_release(release, NTS_ITEMS(a, void *)[at]);
    } else {
      release(NTS_ITEMS(a, void *)[at]);
    }
  }
}
void nts_array_set_length_ref(NtsArray *a, double n) {
  nts_array_set_length_counted(a, n, nts_uncount_managed, false);
}
void nts_array_set_length_foreign(NtsArray *a, double n) {
  nts_array_set_length_counted(a, n, nts_array_family(a)->release, true);
}

/* And the tagged case, where only some of the dropped slots hold a reference
 * and the tag is what says which. */
void nts_array_set_length_value(NtsArray *a, double n) {
  uint32_t length = a->header.length;
  nts_array_set_length_at(a, n, sizeof(NtsValue));
  for (uint32_t at = a->header.length; at < length; at++) {
    nts_value_release(NTS_ITEMS(a, NtsValue)[at]);
  }
}

NtsArray *nts_array_splice(NtsArray *a, double start, double count) {
  return nts_array_splice_at(a, start, count, sizeof(double));
}

NtsArray *nts_array_splice_ref(NtsArray *a, double start, double count) {
  return nts_array_splice_at(a, start, count, sizeof(void *));
}

/* `push` on an array whose elements are erased. See the header for what
 * `_value` means here, and for the three members of this family that are named
 * for their result instead. */
double nts_array_push_value(NtsArray *a, NtsValue value) {
  nts_array_reserve(a);
  NTS_ITEMS(a, NtsValue)[a->header.length] = value;
  a->header.length++;
  return (double)a->header.length;
}

/* `xs.concat(ys)`, one argument.
 *
 * Uninitialized, like `slice` and `splice` beside it: every slot of the result
 * is written by the copies below, so zeroing it first is a `memset` of the
 * whole answer thrown away. That claim is checked rather than argued --
 * `NTS_POISON` fills an uninitialized allocation with a pattern that is not
 * zero, and the example suite agrees with node under it.
 *
 * JavaScript's `concat` takes any number of them and *spreads* the ones that
 * are arrays while appending the ones that are not, which is two questions --
 * how many, and is each one an array -- that the checker can answer and this
 * cannot. One array argument is the shape worth having a helper for; the rest
 * is refused by name rather than answered wrongly. */
/* Append every element of `src` to `dst`, which is what a spread inside a
 * larger array literal does.
 *
 * `[...a, x, ...b]` sums the lengths before it allocates, so `dst` already has
 * the room and `nts_array_push` never reallocates -- the same shape `filter`
 * uses. The reference form retains, because both arrays hold the element
 * afterwards, and then pushes through the consuming helper. */
void nts_array_extend(NtsArray *dst, const NtsArray *src) {
  const double *items = nts_numbers(src);
  for (uint32_t at = 0; at < src->header.length; at++) {
    nts_array_push(dst, items[at]);
  }
}

static inline void nts_array_extend_counted(NtsArray *dst, const NtsArray *src,
                                            void *(*retain)(void *)) {
  void *const *items = NTS_ITEMS(src, void *);
  for (uint32_t at = 0; at < src->header.length; at++) {
    nts_array_push_ref(dst, retain(items[at]));
  }
}
void nts_array_extend_ref(NtsArray *dst, const NtsArray *src) {
  nts_array_extend_counted(dst, src, nts_count_managed);
}
void nts_array_extend_foreign(NtsArray *dst, const NtsArray *src) {
  nts_array_extend_counted(dst, src, nts_array_family(src)->retain);
}

NtsArray *nts_array_concat(const NtsArray *a, const NtsArray *b) {
  uint32_t total = a->header.length + b->header.length;
  NtsArray *out =
      nts_array_new_uninitialized(a->header.descriptor, (double)total);
  memcpy(nts_numbers(out), nts_numbers(a),
         (size_t)a->header.length * sizeof(double));
  memcpy(nts_numbers(out) + a->header.length, nts_numbers(b),
         (size_t)b->header.length * sizeof(double));
  return out;
}

/* The same, and each element is a reference the new array now holds too -- so
 * unlike `splice`, which *moves* them, this one retains. */
static inline NtsArray *nts_array_concat_counted(const NtsArray *a,
                                                 const NtsArray *b,
                                                 void *(*retain)(void *)) {
  uint32_t total = a->header.length + b->header.length;
  NtsArray *out =
      nts_array_new_uninitialized(a->header.descriptor, (double)total);
  void **into = NTS_ITEMS(out, void *);
  void *const *first = NTS_ITEMS(a, void *);
  void *const *second = NTS_ITEMS(b, void *);
  for (uint32_t at = 0; at < a->header.length; at++) {
    into[at] = retain(first[at]);
  }
  for (uint32_t at = 0; at < b->header.length; at++) {
    into[a->header.length + at] = retain(second[at]);
  }
  return out;
}
NtsArray *nts_array_concat_ref(const NtsArray *a, const NtsArray *b) {
  return nts_array_concat_counted(a, b, nts_count_managed);
}
NtsArray *nts_array_concat_foreign(const NtsArray *a, const NtsArray *b) {
  return nts_array_concat_counted(a, b, nts_array_family(a)->retain);
}

/* The same again, for an array whose elements carry their own tag.
 *
 * `NtsValue` is sixteen bytes and only *sometimes* a reference, so neither of
 * the two above can copy one: the double form reads eight and the reference
 * form retains a payload that may be a number. This retains exactly the
 * elements whose tag says they are references, which is the rule
 * `nts_array_element` already follows for reading one.
 *
 * Reached by a spread into a rest parameter of `unknown[]` --
 * `this.emit(EventEmitter.errorMonitor, ...args)` is the one in `runtime/node`,
 * and it is under `EventEmitter#on` and therefore under `http.createServer`. */
NtsArray *nts_array_concat_value(const NtsArray *a, const NtsArray *b) {
  uint32_t total = a->header.length + b->header.length;
  NtsArray *out =
      nts_array_new_uninitialized(a->header.descriptor, (double)total);
  NtsValue *into = NTS_ITEMS(out, NtsValue);
  const NtsValue *first = NTS_ITEMS(a, NtsValue);
  const NtsValue *second = NTS_ITEMS(b, NtsValue);
  for (uint32_t at = 0; at < a->header.length; at++) {
    into[at] = first[at];
  }
  for (uint32_t at = 0; at < b->header.length; at++) {
    into[a->header.length + at] = second[at];
  }
  /* Each copy owns what it holds, a handle included: the result's death
   * gives each one back (`nts_release_foreign`). Only one lane finds this
   * function's bugs: on 2026-09-26 lowering refused `xs.concat(ys)` on an
   * `unknown[]` for the C product (NTS1001) while the LLVM product of the same
   * program reached here. */
  for (uint32_t at = 0; at < total; at++) {
    nts_value_retain(into[at]);
  }
  return out;
}

/* `[first, ...rest] = xs` over an `unknown[]` -- a rest element is a slice --
 * and the `_value` width of the family above. `nts_array_slice` copied eight
 * bytes an element at eight-byte offsets, so `rest` held halves of sixteen-byte
 * values: tags read from payloads, and payloads a later release would follow
 * (the Wasm lane's test262 parity run found it, and declined the same call by
 * name). Each copy owns what it holds, as `nts_array_concat_value`'s do. */
NtsArray *nts_array_slice_value(const NtsArray *a, double from, double to) {
  uint32_t start = nts_str_clamp(from, a->header.length, 1);
  uint32_t end = nts_str_clamp(to, a->header.length, 1);
  uint32_t count = end > start ? end - start : 0u;
  NtsArray *out =
      nts_array_new_uninitialized(a->header.descriptor, (double)count);
  const NtsValue *items = NTS_ITEMS(a, NtsValue);
  NtsValue *into = NTS_ITEMS(out, NtsValue);
  for (uint32_t at = 0; at < count; at++) {
    into[at] = items[start + at];
    nts_value_retain(into[at]);
  }
  return out;
}

NtsArray *nts_array_slice(const NtsArray *a, double from, double to) {
  /* Negative counts from the end, as `String.prototype.slice` does. */
  uint32_t start = nts_str_clamp(from, a->header.length, 1);
  uint32_t end = nts_str_clamp(to, a->header.length, 1);
  uint32_t count = end > start ? end - start : 0u;
  NtsArray *out =
      nts_array_new_uninitialized(a->header.descriptor, (double)count);
  if (count != 0) {
    memcpy(nts_numbers(out), nts_numbers(a) + start,
           (size_t)count * sizeof(double));
  }
  return out;
}

/* The `Number` predicates, each exactly specified -- no approximation here.
 *
 * A call rather than an expression because none of them is one operation. The
 * exception is `Number.isNaN`, which is `x != x` and is lowered as that: it
 * costs nothing, and folds away entirely where the specializer has narrowed the
 * value to an integer, which cannot be NaN. */
bool nts_is_finite(double x) { return isfinite(x); }

/* Finite and equal to its own truncation. `Math.floor` would do as well; the
 * point is that infinity is not an integer even though it has no fraction. */
bool nts_is_integer(double x) { return isfinite(x) && trunc(x) == x; }

/* An integer that a `double` represents uniquely: |x| <= 2^53 - 1. Above that
 * the spacing between representable doubles exceeds 1, so the value stands for
 * a range rather than for itself. */
bool nts_is_safe_integer(double x) {
  return nts_is_integer(x) && fabs(x) <= 9007199254740991.0;
}

/* The `Math` functions that are a call into libm, and the three that are not.
 *
 * Forwarded rather than lowered to an IR operation, because none of them is a
 * candidate for integer specialization -- a transcendental of an integer is not
 * an integer -- so an opcode would buy nothing and cost an arm in every pass.
 *
 * Each is checked against node rather than assumed to match libm. Two do not:
 * `pow` and `sign`. */

/* ECMAScript's exponentiation, which is **not** C's `pow`.
 *
 * Two divergences, and they are the same divergence twice: C99 answers 1 where
 * the specification answers NaN, both times because the *limit* is 1.
 *
 * The specification says that if the base is 1 or -1 and the exponent is an
 * infinity, the result is NaN. C99 says both are 1 -- and the difference is
 * reachable from ordinary source: `Math.pow(1, x)` where `x` overflows to
 * infinity.
 *
 * And `Number::exponentiate` step 1 is "if exponent is NaN, return NaN",
 * *before* it says anything about the base. C99 F.10.4.4 says `pow(+1, y)`
 * returns 1 for any y, **even a NaN**, so `1 ** NaN` answered 1 where node
 * answers NaN. Found by `test/language/expressions/exponentiation/
 * applying-the-exp-operator_A4.js`, which the census ran and which threw.
 *
 * Only `+1` needs it -- `pow(x, NaN)` is already NaN for every other base --
 * but the test is written on the exponent because that is where the
 * specification writes it, and a rule spelled as its own precondition is one
 * that keeps being true when the other arm moves. Note that `x ** 0` is
 * unaffected: zero is not a NaN, and both languages answer 1 for every base. */
double nts_math_pow(double base, double exponent) {
  if (exponent != exponent) {
    return NAN;
  }
  if ((base == 1.0 || base == -1.0) &&
      (exponent == INFINITY || exponent == -INFINITY)) {
    return NAN;
  }
  return pow(base, exponent);
}

/* `Math.sign`, which libm has no equivalent for. Zero keeps its sign and NaN
 * stays NaN, so this is neither `copysign` nor a pair of comparisons. */
double nts_math_sign(double x) {
  if (x != x || x == 0.0) {
    return x;
  }
  return x < 0.0 ? -1.0 : 1.0;
}

/* `Math.fround`: the nearest `float`, back as a `double`. */
double nts_math_fround(double x) { return (double)(float)x; }

double nts_math_log(double x) { return log(x); }
double nts_math_log2(double x) { return log2(x); }
double nts_math_log10(double x) { return log10(x); }
double nts_math_log1p(double x) { return log1p(x); }
double nts_math_exp(double x) { return exp(x); }
double nts_math_expm1(double x) { return expm1(x); }
double nts_math_sin(double x) { return sin(x); }
double nts_math_cos(double x) { return cos(x); }
double nts_math_tan(double x) { return tan(x); }
double nts_math_asin(double x) { return asin(x); }
double nts_math_acos(double x) { return acos(x); }
double nts_math_atan(double x) { return atan(x); }
double nts_math_sinh(double x) { return sinh(x); }
double nts_math_cosh(double x) { return cosh(x); }
double nts_math_tanh(double x) { return tanh(x); }
double nts_math_cbrt(double x) { return cbrt(x); }
double nts_math_atan2(double y, double x) { return atan2(y, x); }
double nts_math_hypot(double a, double b) { return hypot(a, b); }
/* `Math.imul`: ToInt32 of each, the low 32 bits of the product, as a signed
 * integer. Multiplied as `uint32_t`, which wraps by definition -- an `int32_t`
 * product overflowing is undefined -- and folded back into the signed range by
 * comparison rather than by a cast whose result C leaves to the
 * implementation. */
double nts_math_imul(double a, double b) {
  uint32_t product = (uint32_t)nts_to_int32(a) * (uint32_t)nts_to_int32(b);
  return product <= (uint32_t)INT32_MAX ? (double)product
                                        : (double)product - 4294967296.0;
}

/* An integer's decimal digits, two at a time.
 *
 * quickjs-ng's `u32toa` is a divide-by-ten loop into a scratch buffer followed
 * by a `memcpy`, which measured 7.44ns for values up to a million -- most of
 * what `String(n)` costs, and more than twice what `std::to_string` takes for
 * the same work.
 *
 * This is the standard alternative and the reason it is faster is arithmetic
 * rather than cleverness: half as many divisions, the length known before the
 * first digit so the digits go straight into the caller's buffer, and no
 * second buffer to copy out of.
 *
 * A non-integer's digits come from zmij instead (`nts_number_digits`). */
static const char nts_digit_pairs[201] =
    "00010203040506070809101112131415161718192021222324252627282930313233343536"
    "37383940414243444546474849505152535455565758596061626364656667686970717273"
    "7475767778798081828384858687888990919293949596979899";

/* How many decimal digits `n` has. A comparison chain rather than a logarithm:
 * every branch here is perfectly predicted in a loop over similar values, and
 * the result is needed *before* the digits so they can be written backwards
 * into place. */
static uint32_t nts_digits10(uint32_t n) {
  if (n < 10u) {
    return 1;
  }
  if (n < 100u) {
    return 2;
  }
  if (n < 1000u) {
    return 3;
  }
  if (n < 10000u) {
    return 4;
  }
  if (n < 100000u) {
    return 5;
  }
  if (n < 1000000u) {
    return 6;
  }
  if (n < 10000000u) {
    return 7;
  }
  if (n < 100000000u) {
    return 8;
  }
  if (n < 1000000000u) {
    return 9;
  }
  return 10;
}

static int nts_u32toa(char *buf, uint32_t n) {
  const uint32_t length = nts_digits10(n);
  char *at = buf + length;
  while (n >= 100u) {
    const uint32_t pair = (n % 100u) * 2u;
    n /= 100u;
    *--at = nts_digit_pairs[pair + 1u];
    *--at = nts_digit_pairs[pair];
  }
  if (n >= 10u) {
    const uint32_t pair = n * 2u;
    *--at = nts_digit_pairs[pair + 1u];
    *--at = nts_digit_pairs[pair];
  } else {
    *--at = (char)('0' + n);
  }
  return (int)length;
}

/* `n`'s decimal digits, for a whole number below 2^53: at most sixteen, as a
 * high part and eight zero-padded low digits once it passes 32 bits. */
static int nts_u53toa(char *buf, uint64_t n) {
  if (n <= UINT32_MAX) {
    return nts_u32toa(buf, (uint32_t)n);
  }
  const int length = nts_u32toa(buf, (uint32_t)(n / 100000000u));
  uint32_t low = (uint32_t)(n % 100000000u);
  char *at = buf + length + 8;
  for (int pairs = 0; pairs < 4; pairs++) {
    const uint32_t pair = (low % 100u) * 2u;
    low /= 100u;
    *--at = nts_digit_pairs[pair + 1u];
    *--at = nts_digit_pairs[pair];
  }
  return length + 8;
}

/* The shortest digits that round-trip to `magnitude`, a finite positive
 * double, and where the decimal point goes among them: `0.00123` is `"123"`
 * with the point at -2, `1.5e300` is `"15"` at 301.
 *
 * zmij computes them (`zmij/README.md`): shortest, correctly rounded, and
 * verified. Its C entry points hand back text in Python's layout -- `0.001`,
 * `123.45`, `1.2345678901234568e+20`, `1e-07` -- and keep the decimal
 * significand and exponent internal, so they are read back from that text
 * here, at most 24 characters, before ECMAScript's layout places them. */
static int nts_number_digits(double magnitude, char *digits, int *point) {
  char text[zmij_double_buffer_size];
  const char *end = zmij_write(text, sizeof text, magnitude);
  const char *at = text;
  int length = 0;
  int before = 0;
  int zeros = 0;
  bool after = false;
  for (; at < end && *at != 'e'; at++) {
    if (*at == '.') {
      after = true;
    } else if (length == 0 && *at == '0') {
      /* A leading `0.` and the zeros after it place the point; they are not
       * digits of the answer. */
      zeros += after ? 1 : 0;
    } else {
      digits[length++] = *at;
      before += after ? 0 : 1;
    }
  }
  int exponent = 0;
  if (at < end) {
    const bool negative = at[1] == '-';
    for (at += 2; at < end; at++) {
      exponent = exponent * 10 + (*at - '0');
    }
    exponent = negative ? -exponent : exponent;
  }
  while (length > 1 && digits[length - 1] == '0') {
    length--;
  }
  *point = (before > 0 ? before : -zeros) + exponent;
  return length;
}

/* ECMAScript's Number::toString(x) in radix 10, written into `out`, its length
 * returned: the one formatter behind every sink -- `String(n)`, templates and
 * `+`, JSON's numbers, `join`.
 *
 * At most 25 characters (`-0.000001` and seventeen digits), which every
 * caller's storage holds. */
static uint32_t nts_number_format(char *out, double x) {
  if (x != x) {
    memcpy(out, "NaN", 3);
    return 3;
  }
  if (isinf(x)) {
    if (x < 0) {
      memcpy(out, "-Infinity", 9);
      return 9;
    }
    memcpy(out, "Infinity", 8);
    return 8;
  }
  char *q = out;
  /* `-0` is not below zero, and `String(-0)` is `"0"`. */
  if (x < 0) {
    *q++ = '-';
    x = -x;
  }
  /* A whole number below 2^53 is its own shortest form, and everything below
   * 1e21 is written without an exponent: its digits, exactly. */
  if (x < 9007199254740992.0 && (double)(uint64_t)x == x) {
    return (uint32_t)(q - out) + (uint32_t)nts_u53toa(q, (uint64_t)x);
  }
  char digits[24];
  int point;
  const int length = nts_number_digits(x, digits, &point);
  /* ECMAScript's Number::toString, step by step: every digit and the zeros
   * that place them, the point inside the digits, a leading `0.` and some
   * zeros, or an exponent. The thresholds -- 21 above and -6 below -- are the
   * specification's, not a formatting preference. */
  if (point >= length && point <= 21) {
    memcpy(q, digits, (size_t)length);
    q += length;
    memset(q, '0', (size_t)(point - length));
    q += point - length;
  } else if (point > 0 && point <= 21) {
    memcpy(q, digits, (size_t)point);
    q += point;
    *q++ = '.';
    memcpy(q, digits + point, (size_t)(length - point));
    q += length - point;
  } else if (point > -6 && point <= 0) {
    *q++ = '0';
    *q++ = '.';
    memset(q, '0', (size_t)(-point));
    q += -point;
    memcpy(q, digits, (size_t)length);
    q += length;
  } else {
    *q++ = digits[0];
    if (length != 1) {
      *q++ = '.';
      memcpy(q, digits + 1, (size_t)(length - 1));
      q += length - 1;
    }
    *q++ = 'e';
    const int exponent = point - 1;
    *q++ = exponent < 0 ? '-' : '+';
    q += nts_u32toa(q, (uint32_t)(exponent < 0 ? -exponent : exponent));
  }
  return (uint32_t)(q - out);
}

NtsString *nts_number_to_string(double x) {
  return nts_number_to_string_into(NULL, x);
}

/* `n.toString(radix)`. V8's `DoubleToRadixCString`, which is the only
 * implementation that agrees with node on the fraction.
 *
 * The buffer is 2200 bytes because that is what V8 uses and the bound is real
 * rather than generous: the smallest denormal in radix 2 has about 1075
 * fractional digits, and the largest double has about 1024 integer ones.
 *
 * `delta` is the termination argument. It starts at half the distance to the
 * next representable double and is scaled by the radix alongside the fraction,
 * so the loop stops as soon as the digits remaining could not change which
 * double this is. Rounding up carries through the fraction and, if it runs off
 * the front, into the integer part -- which is why the integer part is written
 * after the fraction and not before. */
/* `n.toFixed(d)`. The header carries why this is not `printf("%.*f")`. */
NtsString *nts_number_to_fixed(double x, double digits) {
  int d = (int)digits;
  if (x != x)
    return nts_string_from_utf8("NaN", 3);
  if (x > 1.7976931348623157e308)
    return nts_string_from_utf8("Infinity", 8);
  if (x < -1.7976931348623157e308)
    return nts_string_from_utf8("-Infinity", 9);
  /* The specification defers to `ToString` here, so the exponential form is
   * the right answer rather than a fallback. */
  if (fabs(x) >= 1e21)
    return nts_number_to_string(x);

  /* `x < 0`, as the specification says, and not the sign bit: `(-0).toFixed(2)`
   * is `"0.00"` in node and `(-0.4).toFixed(0)` is `"-0"` -- the sign survives
   * a magnitude that rounds away because -0.4 < 0, and negative zero has no
   * sign to survive because -0 < 0 is false. The sign bit answers both with a
   * `-`, and `fuzz-statements.mjs` found the difference at seed 35. */
  bool negative = x < 0;
  double magnitude = fabs(x);

  /* The exact expansion. A double's decimal expansion terminates, and 1080
   * places is past the last significant digit of the smallest denormal, so
   * nothing is truncated before the rounding position. */
  char buffer[1200];
  snprintf(buffer, sizeof buffer, "%.*f", d + 40, magnitude);

  char *point = strchr(buffer, '.');
  size_t keep = (size_t)(point - buffer) + (d > 0 ? (size_t)d + 1u : 0u);
  /* The first digit dropped, which is the whole of the rounding decision: at
   * zero digits it sits one past the point rather than at `keep`. */
  char dropped = buffer[keep + (d > 0 ? 0u : 1u)];
  buffer[keep] = '\0';

  if (dropped >= '5') {
    size_t at = keep;
    bool carried = true;
    while (at > 0) {
      at--;
      if (buffer[at] == '.')
        continue;
      if (buffer[at] < '9') {
        buffer[at]++;
        carried = false;
        break;
      }
      buffer[at] = '0';
    }
    /* `9.99` at two digits carries off the front and grows the number. */
    if (carried) {
      size_t length = strlen(buffer);
      memmove(buffer + 1, buffer, length + 1);
      buffer[0] = '1';
      keep = length + 1;
    }
  }

  /* `(-0.4).toFixed(0)` is `"-0"` in JavaScript: the sign survives a magnitude
   * that rounded away. Taken from `signbit` rather than from `x < 0`, which is
   * false for negative zero. */
  if (negative) {
    size_t length = strlen(buffer);
    memmove(buffer + 1, buffer, length + 1);
    buffer[0] = '-';
  }
  return nts_string_from_utf8(buffer, strlen(buffer));
}

NtsString *nts_number_to_string_radix(double x, double radix) {
  /* The lowering has bounded ToIntegerOrInfinity(radix) to 2..36, so the
     truncation is the radix, for the base-10 shortcut and for every digit
     below: 10.5 is base 10, which is ToString(x), and 36.5 is base 36. */
  int base = (int)radix;
  radix = (double)base;
  if (base == 10)
    return nts_number_to_string(x);

  if (x != x)
    return nts_string_from_utf8("NaN", 3);
  if (x == 0.0)
    return nts_string_from_utf8("0", 1);
  if (x > 1.7976931348623157e308)
    return nts_string_from_utf8("Infinity", 8);
  if (x < -1.7976931348623157e308)
    return nts_string_from_utf8("-Infinity", 9);

  static const char digits[] = "0123456789abcdefghijklmnopqrstuvwxyz";
  char buffer[2200];
  const size_t kBufferSize = sizeof buffer;
  size_t integer_cursor = kBufferSize / 2;
  size_t fraction_cursor = integer_cursor;

  bool negative = x < 0.0;
  if (negative)
    x = -x;

  double integer = floor(x);
  double fraction = x - integer;

  /* Half the gap to the next double, and never zero: `nextafter` of zero is
   * the smallest denormal, which is the floor a fraction can be compared to. */
  double delta = 0.5 * (nextafter(x, 1.0 / 0.0) - x);
  double smallest = nextafter(0.0, 1.0 / 0.0);
  if (delta < smallest)
    delta = smallest;

  if (fraction >= delta) {
    buffer[fraction_cursor++] = '.';
    do {
      fraction *= radix;
      delta *= radix;
      int digit = (int)fraction;
      buffer[fraction_cursor++] = digits[digit];
      fraction -= digit;
      if (fraction > 0.5 || (fraction == 0.5 && (digit & 1) != 0)) {
        if (fraction + delta > 1.0) {
          /* Round up, carrying back through the digits already written. A
           * carry off the front of the fraction lands on the integer part,
           * which is why that is computed afterwards. */
          for (;;) {
            if (fraction_cursor == integer_cursor) {
              integer += 1.0;
              break;
            }
            char c = buffer[--fraction_cursor];
            if (c == '.')
              continue;
            int at = c > '9' ? c - 'a' + 10 : c - '0';
            if (at + 1 < base) {
              buffer[fraction_cursor++] = digits[at + 1];
              break;
            }
          }
          break;
        }
      }
    } while (fraction >= delta && fraction_cursor + 1 < kBufferSize);
  }

  /* The integer part, least significant digit first, written backwards from
   * the middle of the buffer.
   *
   * `fmod` rather than a cast, because the value can exceed every integer type
   * -- `1e300` in radix 2 is a thousand digits and no `uint64_t` holds it. */
  /* A double whose ULP exceeds one cannot represent consecutive integers, so
   * every digit below that point is a zero node writes and this must not
   * invent. `fmod` on such a value returns a remainder built from bits the
   * double does not have, and `1e21` in radix 3 came out
   * `...2022201202222111` where node writes `...20222` and eleven zeros.
   *
   * `ilogb(v) > 52` is V8's `Double::Exponent() > 0`: the significand is 53
   * bits, so an exponent above 52 puts the unit in the last place above one.
   * Divide the exponent out first, writing the zeros it stands for. */
  while (integer_cursor > 0 && integer > 0.0 && ilogb(integer / radix) > 52) {
    integer /= radix;
    buffer[--integer_cursor] = '0';
  }
  while (integer > 0.0 && integer_cursor > 0) {
    double remainder = fmod(integer, radix);
    integer = (integer - remainder) / radix;
    buffer[--integer_cursor] = digits[(int)remainder];
  }
  /* Against the buffer's middle, not against `fraction_cursor`: the fraction
   * has already moved that one past the '.', so the two are never equal when
   * there is a fraction and `(0.5).toString(2)` came out `.1` for `0.1`. */
  if (integer_cursor == kBufferSize / 2)
    buffer[--integer_cursor] = '0';
  if (negative)
    buffer[--integer_cursor] = '-';

  return nts_string_from_utf8(buffer + integer_cursor,
                              fraction_cursor - integer_cursor);
}

/* Inlined, which is a quarter of `benches/cases/number-format`: 961ns to 729ns,
 * past both the `snprintf` it is measured against and bun.
 *
 * Only the `i32` fast path is inlined; everything else is one call to
 * `nts_number_format`, and inlining the formatter wholesale is the kind of
 * thing that usually loses. What makes
 * it win is the fast path's *shape*: the caller almost always knows the value
 * is a whole number, so with the body in front of it the compiler folds the
 * range tests away and what is left is the digit loop. Out of line, every call
 * re-asked questions the caller had already answered. */
__attribute__((always_inline)) NtsString *
nts_number_to_string_into(NtsHeader *into, double x) {
  /* An integer is not a general double, and the shortest-round-trip algorithm
   * charges it as one. Every index, count and identifier a program formats is
   * an integer, and V8 has the same split for anything that fits a Smi.
   *
   * `-0` needs no guard: it converts to `0`, `(double)0 == -0.0` is true, and
   * `String(-0)` is `"0"` -- the sign is not part of the answer, so this gives
   * exactly the right characters. NaN and the infinities fail the round-trip
   * test and fall through to `nts_number_format`, which spells them. */
  /* The range test comes *before* the conversion. It used to come after, and
   * the comment above says NaN and the infinities are expected to arrive here
   * and fall through -- converting either to `int32_t` is undefined before the
   * round-trip test can reject it. A candidate outside the range takes zero,
   * which no such input can equal, so the gate answers the same and executes.
   *
   * A sweep of every power of two against node found no wrong *characters*
   * here, which is what made this invisible: undefined execution and a wrong
   * answer are different failures, and only one of them prints. */
  const int32_t whole =
      x >= -2147483648.0 && x <= 2147483647.0 ? (int32_t)x : 0;
  if ((double)whole == x) {
    /* Straight into the string: no scratch buffer and no copy, because
     * `nts_digits10` knows the length before a digit is written. An integer is
     * at most eleven characters, so it always fits the caller's storage. */
    const uint32_t magnitude =
        whole < 0 ? (uint32_t)(-(int64_t)whole) : (uint32_t)whole;
    const uint32_t sign = whole < 0 ? 1u : 0u;
    NtsString *out = nts_str_build(into, nts_digits10(magnitude) + sign, 0);
    char *data = (char *)NTS_ELEMENTS(out, unsigned char);
    if (sign != 0u) {
      data[0] = '-';
    }
    nts_u32toa(data + sign, magnitude);
    return out;
  }

  /* Everything else, out of line: one formatter behind every sink. */
  char text[NTS_NUMBER_STRING_MAX];
  const uint32_t total = nts_number_format(text, x);
  /* Always one byte: every character written in radix 10 is ASCII. */
  NtsString *out = nts_str_build(into, total, 0);
  memcpy(NTS_ELEMENTS(out, unsigned char), text, (size_t)total);
  return out;
}

/* `typeof` for a tag.
 *
 * Allocates, because a string in this runtime is a heap object and there is no
 * static one to hand back. That cost is why the common shape -- comparing
 * against a literal -- wants folding to an integer compare rather than going
 * through here, and why `NtsTag`'s values are the spellings rather than an
 * arbitrary numbering: the fold is then a table lookup at compile time.
 *
 * An unrecognised tag **aborts, naming it**. It answered "undefined" once, on
 * the argument that a wrong word is easier to find than a death -- but it is
 * also easier not to find: a tag added without an arm here would print
 * `typeof handle` as "undefined" for as long as nobody looked, and a death
 * that names the tag says which value it died on. */
NtsString *nts_tag_name(uint32_t tag) {
  switch (tag) {
  case NTS_TAG_UNDEFINED:
    return nts_string_from_utf8("undefined", 9);
  case NTS_TAG_BOOLEAN:
    return nts_string_from_utf8("boolean", 7);
  case NTS_TAG_NUMBER:
    return nts_string_from_utf8("number", 6);
  case NTS_TAG_STRING:
    return nts_string_from_utf8("string", 6);
  case NTS_TAG_FUNCTION:
    return nts_string_from_utf8("function", 8);
  case NTS_TAG_SYMBOL:
    return nts_string_from_utf8("symbol", 6);
  case NTS_TAG_OBJECT:
  /* `typeof null` is `"object"`. A famous wart, and the specification's, so
   * the two tags answer with one spelling. */
  case NTS_TAG_NULL:
  /* A C library's object, as GJS answers for a `GObject`. */
  case NTS_TAG_HANDLE_GOBJECT:
  case NTS_TAG_HANDLE_OBJC:
  case NTS_TAG_HANDLE_COM:
    return nts_string_from_utf8("object", 6);
  case NTS_TAG_BIGINT:
    return nts_string_from_utf8("bigint", 6);
  default:
    fprintf(stderr, "nts: `typeof` of a value with tag %u, which is not one\n",
            tag);
    abort();
  }
}

/* `String(true)`. Two answers and no formatting. */
NtsString *nts_bool_to_string(bool value) {
  return value ? nts_string_from_utf8("true", 4)
               : nts_string_from_utf8("false", 5);
}

/* `String(2n)`, in decimal and exact.
 *
 * A `bigint` prints with no exponent and no rounding however large it is, which
 * is the whole reason it is not a double -- so this is repeated division rather
 * than anything `printf` offers, C having no conversion for a 128-bit integer.
 *
 * The magnitude is taken on the *unsigned* twin: the most negative value of a
 * two's-complement type has no positive counterpart, and negating it in the
 * signed type is undefined. */
static NtsString *nts_bigint_text(__int128 value, bool inspect) {
  /* 2^127 is 39 digits; one more for the sign. */
  char digits[41];
  size_t at = sizeof digits;
  if (inspect) {
    digits[--at] = 'n';
  }
  bool negative = value < 0;
  unsigned __int128 magnitude =
      negative ? (unsigned __int128)0 - (unsigned __int128)value
               : (unsigned __int128)value;
  do {
    digits[--at] = (char)('0' + (unsigned)(magnitude % 10u));
    magnitude /= 10u;
  } while (magnitude != 0);
  if (negative) {
    digits[--at] = '-';
  }
  return nts_string_from_utf8(digits + at, sizeof digits - at);
}

NtsString *nts_bigint_to_string(__int128 value) {
  return nts_bigint_text(value, false);
}

NtsString *nts_string_from_utf8(const char *bytes, size_t length) {
  /* WHATWG's "UTF-8 decode", which is what `TextDecoder` and node do, so a
   * byte sequence decodes here to exactly the string it does there.
   *
   * It is stricter than "read a lead byte, then its continuation bytes" in
   * three ways that matter. The second byte's range depends on the first --
   * `E0` needs `A0..BF`, `ED` needs `80..9F`, `F0` needs `90..BF`, `F4` needs
   * `80..8F` -- which refuses **overlong forms**, the encoded surrogates
   * `ED A0..BF xx`, and code points above U+10FFFF. An overlong `C0 AF` was
   * decoded here as `/`, which is how a path check is smuggled past. And an
   * ill-formed sequence becomes **one** U+FFFD for its maximal prefix, with
   * the byte that broke it read again as the start of whatever follows; a
   * truncated four-byte sequence was three.
   *
   * At most one code unit per byte: a replacement is one unit for at least
   * one byte, and a supplementary character is two units for four bytes.
   *
   * One call decodes one complete sequence of bytes. It does not stream: a
   * sequence split across two calls is two ill-formed ends, not a character.
   *
   * **The same decoder as `utf8Decode` in
   * `runtime/web-platform/src/core/utf8.ts`**, which is the TypeScript side's
   * (and `Buffer.toString`'s). Two derivations of one algorithm, kept honest
   * by one table: `runtime/c/tests/utf8_decode.c`, generated by node, which
   * both pass row for row. Change either and run it against both.
   *
   * **ASCII is copied, not decoded.** Every path, name and label most C
   * libraries hand back is ASCII, and ASCII bytes already are a one-byte
   * string -- so it is allocated once at its final size and filled with a
   * `memcpy`, where the general path builds UTF-16 units in a temporary and
   * `nts_str_alloc` scans them again to choose a width. Measured on a 62-byte
   * path, 5M decodes: 80 ns a call through the general path, 36 ns here. Text
   * with anything above `0x7F` in it pays nothing for the scan it failed. */
  size_t ascii = 0;
  while (ascii < length && (unsigned char)bytes[ascii] < 0x80u) {
    ascii++;
  }
  if (ascii == length) {
    NtsString *out = nts_str_raw((uint32_t)length, 0);
    memcpy(NTS_ELEMENTS(out, unsigned char), bytes, length);
    return out;
  }
  uint16_t *units = (uint16_t *)malloc((length + 1u) * sizeof(uint16_t));
  if (!units) {
    fprintf(stderr, "nts: out of memory\n");
    abort();
  }
  uint32_t count = 0;
  for (; count < ascii; count++) {
    units[count] = (unsigned char)bytes[count];
  }
  uint32_t point = 0;
  unsigned needed = 0;
  unsigned seen = 0;
  unsigned char lower = 0x80u;
  unsigned char upper = 0xBFu;
  size_t at = ascii;
  while (at < length) {
    unsigned char byte = (unsigned char)bytes[at];
    if (needed == 0) {
      at++;
      if (byte <= 0x7Fu) {
        units[count++] = byte;
      } else if (byte >= 0xC2u && byte <= 0xDFu) {
        needed = 1;
        point = byte & 0x1Fu;
      } else if (byte >= 0xE0u && byte <= 0xEFu) {
        if (byte == 0xE0u) {
          lower = 0xA0u;
        } else if (byte == 0xEDu) {
          upper = 0x9Fu;
        }
        needed = 2;
        point = byte & 0x0Fu;
      } else if (byte >= 0xF0u && byte <= 0xF4u) {
        if (byte == 0xF0u) {
          lower = 0x90u;
        } else if (byte == 0xF4u) {
          upper = 0x8Fu;
        }
        needed = 3;
        point = byte & 0x07u;
      } else {
        units[count++] = 0xFFFDu;
      }
      continue;
    }
    if (byte < lower || byte > upper) {
      /* The sequence so far is one replacement, and this byte is not
       * consumed: it starts whatever comes next. */
      needed = 0;
      seen = 0;
      point = 0;
      lower = 0x80u;
      upper = 0xBFu;
      units[count++] = 0xFFFDu;
      continue;
    }
    at++;
    lower = 0x80u;
    upper = 0xBFu;
    point = (point << 6) | (byte & 0x3Fu);
    if (++seen != needed) {
      continue;
    }
    if (point > 0xFFFFu) {
      /* A supplementary character is a surrogate pair, and `length`
       * counts both halves -- which is what JavaScript reports. */
      point -= 0x10000u;
      units[count++] = (uint16_t)(0xD800u + (point >> 10));
      units[count++] = (uint16_t)(0xDC00u + (point & 0x3FFu));
    } else {
      units[count++] = (uint16_t)point;
    }
    needed = 0;
    seen = 0;
    point = 0;
  }
  /* A sequence the input ended inside of. */
  if (needed != 0) {
    units[count++] = 0xFFFDu;
  }
  NtsString *out = nts_str_alloc(units, count);
  free(units);
  return out;
}

/* `s` as UTF-8 into `out`, which has room for `s->length * 3` bytes,
 * answering the bytes written. The one transcoding a string gets on its way
 * out of the program, so a lone surrogate means the same thing in a `string`
 * parameter, a `string[]` one and a line of `console.log`. `c_string` says
 * the bytes are for C, which cannot hold a U+0000. */
static size_t nts_write_utf8(const NtsString *s, char *out, bool c_string) {
  size_t n = 0;
  for (uint32_t at = 0; at < s->length; at++) {
    uint32_t point = nts_unit(s, at);
    if (point == 0u && c_string) {
      fprintf(stderr,
              "nts: a string containing U+0000 at index %u cannot cross to C "
              "as a NUL-terminated `const char *`\n",
              (unsigned)at);
      abort();
    }
    if (point >= 0xD800u && point <= 0xDBFFu && at + 1u < s->length) {
      uint32_t low = nts_unit(s, at + 1u);
      if (low >= 0xDC00u && low <= 0xDFFFu) {
        point = 0x10000u + ((point - 0xD800u) << 10) + (low - 0xDC00u);
        at++;
      }
    }
    if (point >= 0xD800u && point <= 0xDFFFu) {
      point = 0xFFFDu;
    }
    if (point < 0x80u) {
      out[n++] = (char)point;
    } else if (point < 0x800u) {
      out[n++] = (char)(0xC0u | (point >> 6));
      out[n++] = (char)(0x80u | (point & 0x3Fu));
    } else if (point < 0x10000u) {
      out[n++] = (char)(0xE0u | (point >> 12));
      out[n++] = (char)(0x80u | ((point >> 6) & 0x3Fu));
      out[n++] = (char)(0x80u | (point & 0x3Fu));
    } else {
      out[n++] = (char)(0xF0u | (point >> 18));
      out[n++] = (char)(0x80u | ((point >> 12) & 0x3Fu));
      out[n++] = (char)(0x80u | ((point >> 6) & 0x3Fu));
      out[n++] = (char)(0x80u | (point & 0x3Fu));
    }
  }
  return n;
}

/* `s` as NUL-terminated UTF-8 into `out`, which has room for `s->length * 3
 * + 1` bytes, answering the bytes written before the terminator. */
static size_t nts_write_cstring(const NtsString *s, char *out) {
  size_t n = nts_write_utf8(s, out, true);
  out[n] = '\0';
  return n;
}

NtsString *nts_value_inspect(NtsValue value) {
  if (nts_value_tag(value) == NTS_TAG_BIGINT) {
    return nts_bigint_text(
        nts_bigint_unbox((const NtsBigIntBox *)nts_value_reference(value)),
        true);
  }
  if (nts_value_tag(value) == NTS_TAG_NUMBER) {
    double x = nts_value_number(value);
    if (x == 0.0 && 1.0 / x < 0.0) {
      return nts_string_from_utf8("-0", 2);
    }
  }
  /* `util.inspect` prints an object by its own properties (`{ a: 1 }`) and a
   * function as `[Function: f]`, neither of which is what `String()` answers.
   * The lowering admits only the tags whose two texts agree, and this says so
   * rather than lending an object `String()`'s text. */
  uint32_t tag = nts_value_tag(value);
  if (tag == NTS_TAG_OBJECT || tag == NTS_TAG_FUNCTION) {
    fprintf(stderr, NTS_REFUSED "inspecting an object or a function, which "
                                "util.inspect prints by its properties\n");
    abort();
  }
  return nts_value_to_string(value);
}

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>

/* Windows opens stdout and stderr in text mode, which writes each `\n` as
 * `\r\n`; node writes `\n` on every platform, so a line must be the same
 * bytes on Windows as on Linux. Binary mode before `main`, for every program.
 * A program with no console -- a GUI one nothing redirected -- has no
 * descriptor to set (`_fileno` answers a negative one, and `_setmode` of it
 * ends the process through the CRT's invalid-parameter handler). */
__attribute__((constructor)) static void nts_stdio_binary(void) {
  int descriptors[] = {_fileno(stdout), _fileno(stderr)};
  for (size_t at = 0; at < sizeof descriptors / sizeof *descriptors; at++) {
    if (descriptors[at] >= 0) {
      _setmode(descriptors[at], _O_BINARY);
    }
  }
}
#endif

/* The node facade reports libuv's negative error numbers. On POSIX these
 * are -errno; Windows gives them a stable numbering independent of the CRT.
 * Numbers: libuv 1.52.1 include/uv/errno.h, bundled by node 24.20.0
 * (third_party/node/deps/uv/include/uv/errno.h).
 * Keep this cold translation here so every standard-stream caller uses the
 * same FILE, encoder and flush rather than linking a second writer. */
static double nts_stdio_error(int error) {
  if (error == 0)
    error = EIO;
#ifdef _WIN32
  switch (error) {
  case EACCES:
    return -4092;
  case EAGAIN:
    return -4088;
  case EBADF:
    return -4083;
  case EFAULT:
    return -4074;
  case EFBIG:
    return -4036;
  case EINTR:
    return -4072;
  case EINVAL:
    return -4071;
  case EIO:
    return -4070;
  case ENOMEM:
    return -4057;
  case ENOSPC:
    return -4055;
  case ENXIO:
    return -4033;
  case EPIPE:
    return -4047;
  default:
    return -4094; /* UV_UNKNOWN */
  }
#else
  return -(double)(error != 0 ? error : EIO);
#endif
}

static double nts_stdio_bytes(FILE *stream, const void *bytes, size_t length) {
  const unsigned char *at = bytes;
  while (length != 0) {
    errno = 0;
    size_t written = fwrite(at, 1, length, stream);
    at += written;
    length -= written;
    if (length != 0) {
      if (errno == EINTR) {
        clearerr(stream);
        continue;
      }
      return nts_stdio_error(errno);
    }
  }
  return 0;
}

static double nts_stdio_write(const NtsString *line, bool to_stderr,
                              bool newline) {
  FILE *stream = to_stderr ? stderr : stdout;
  /* Every call flushes its own stream before returning. */
  double result;
  /* ASCII as it is stored, U+0000 included: the common line costs a scan and
   * one write. Anything else is transcoded, on the stack when it is short. */
  if ((line->flags & NTS_TWO_BYTE) == 0) {
    const unsigned char *bytes = NTS_ELEMENTS(line, unsigned char);
    unsigned char high = 0;
    for (uint32_t at = 0; at < line->length; at++) {
      high |= bytes[at];
    }
    if ((high & 0x80u) == 0) {
      result = nts_stdio_bytes(stream, bytes, line->length);
      goto finish;
    }
  }
  if ((size_t)line->length > SIZE_MAX / 3u) {
    if (!newline)
      return nts_stdio_error(ENOMEM);
    fprintf(stderr, "nts: out of memory\n");
    abort();
  }
  char small[1024];
  size_t most = (size_t)line->length * 3u;
  char *out = most <= sizeof small ? small : (char *)malloc(most);
  if (!out) {
    if (!newline)
      return nts_stdio_error(ENOMEM);
    fprintf(stderr, "nts: out of memory\n");
    abort();
  }
  result = nts_stdio_bytes(stream, out, nts_write_utf8(line, out, false));
  if (out != small) {
    free(out);
  }
finish:
  if (result == 0 && newline && fputc('\n', stream) == EOF) {
    result = nts_stdio_error(errno);
  }
  if (fflush(stream) != 0 && result == 0) {
    result = nts_stdio_error(errno);
  }
  return result;
}

void nts_console_write(const NtsString *line, bool to_stderr) {
  (void)nts_stdio_write(line, to_stderr, true);
}

double nts_write_stdout(const NtsString *text) {
  return nts_stdio_write(text, false, false);
}

double nts_write_stderr(const NtsString *text) {
  return nts_stdio_write(text, true, false);
}

static bool nts_stdio_is_tty(int descriptor) {
#ifdef _WIN32
  /* A character device can be NUL rather than a console. Match the native
   * descriptor check, rather than treating every CRT character device as a
   * terminal. */
  HANDLE handle = (HANDLE)_get_osfhandle(descriptor);
  DWORD mode;
  return handle != INVALID_HANDLE_VALUE &&
         GetFileType(handle) == FILE_TYPE_CHAR && GetConsoleMode(handle, &mode);
#else
  return isatty(descriptor) != 0;
#endif
}

bool nts_stdout_is_tty(void) { return nts_stdio_is_tty(1); }

bool nts_stderr_is_tty(void) { return nts_stdio_is_tty(2); }

/* Whether a one-byte string's storage is already its C string: every byte
 * ASCII, and none of them zero. Branch-free over the bytes, so the compiler
 * vectorises it: `(b - 1) | b` has its top bit set exactly for 0 and for
 * 0x80 and above. */
static bool nts_lendable_ascii(const unsigned char *bytes, uint32_t length) {
  unsigned char bad = 0;
  for (uint32_t at = 0; at < length; at++) {
    bad |= (unsigned char)((unsigned char)(bytes[at] - 1u) | bytes[at]);
  }
  return (bad & 0x80u) == 0;
}

/* `s` as a fresh `malloc`ed C string: the conversion both of the functions
 * below share. */
static char *nts_cstring_copy(const NtsString *s) {
  /* Three bytes per unit is the most any unit needs: a BMP code point is at
   * most three, and a supplementary one is four bytes for two units. */
  if ((size_t)s->length > (SIZE_MAX - 1u) / 3u) {
    fprintf(stderr, "nts: out of memory\n");
    abort();
  }
  char *out = (char *)malloc((size_t)s->length * 3u + 1u);
  if (!out) {
    fprintf(stderr, "nts: out of memory\n");
    abort();
  }
  nts_write_cstring(s, out);
  return out;
}

const char *nts_string_to_cstring(const NtsString *s) {
  if (s == NULL) {
    return NULL;
  }
  /* Lent in place: a one-byte string's storage ends in a zero -- every
   * string is built through `nts_str_raw`, and both backends' literals carry
   * one -- so ASCII with no U+0000 is already the C string, and the call
   * costs a scan instead of an allocation. */
  if ((s->flags & NTS_TWO_BYTE) == 0) {
    const unsigned char *bytes = NTS_ELEMENTS(s, unsigned char);
    if (nts_lendable_ascii(bytes, s->length)) {
      return (const char *)bytes;
    }
  }
  return nts_cstring_copy(s);
}

char *nts_string_to_owned_cstring(const NtsString *s) {
  if (s == NULL) {
    return NULL;
  }
  /* ASCII is copied as it is stored, terminator included; anything else is
   * converted as a lent string that is not ASCII is. */
  if ((s->flags & NTS_TWO_BYTE) == 0) {
    const unsigned char *bytes = NTS_ELEMENTS(s, unsigned char);
    if (nts_lendable_ascii(bytes, s->length)) {
      char *out = (char *)malloc((size_t)s->length + 1u);
      if (!out) {
        fprintf(stderr, "nts: out of memory\n");
        abort();
      }
      memcpy(out, bytes, (size_t)s->length + 1u);
      return out;
    }
  }
  return nts_cstring_copy(s);
}

char **nts_strings_to_cstrings(const NtsArray *array) {
  if (array == NULL) {
    return NULL;
  }
  uint32_t count = array->header.length;
  NtsString *const *items = NTS_ITEMS(array, NtsString *);
  /* One block: the table, its terminator, then every string's bytes. The
   * bound per string is the one `nts_string_to_cstring` allocates. */
  size_t table = ((size_t)count + 1u) * sizeof(char *);
  size_t bytes = table;
  for (uint32_t at = 0; at < count; at++) {
    const NtsString *s = items[at];
    if (s == NULL) {
      fprintf(stderr,
              "nts: a string array with a hole at index %u cannot cross to C "
              "as a NULL-terminated `char **`, which would end it there\n",
              (unsigned)at);
      abort();
    }
    size_t most = (size_t)s->length * 3u + 1u;
    if ((size_t)s->length > (SIZE_MAX - 1u) / 3u || bytes > SIZE_MAX - most) {
      fprintf(stderr, "nts: out of memory\n");
      abort();
    }
    bytes += most;
  }
  char *block = (char *)malloc(bytes);
  if (!block) {
    fprintf(stderr, "nts: out of memory\n");
    abort();
  }
  char **out = (char **)(void *)block;
  char *cursor = block + table;
  for (uint32_t at = 0; at < count; at++) {
    out[at] = cursor;
    cursor += nts_write_cstring(items[at], cursor) + 1u;
  }
  out[count] = NULL;
  return out;
}

void nts_cstrings_release(char **c) { free((void *)c); }

void nts_view_unlend(const NtsView *view) { (void)view; }
void nts_string_unlend(const NtsString *string) { (void)string; }

void *nts_array_handles(const NtsArray *array) {
  if (array == NULL) {
    return NULL;
  }
  void **items = NTS_ITEMS(array, void *);
  for (uint32_t at = 0; at < array->header.length; at++) {
    if (items[at] == NULL) {
      fprintf(stderr,
              "nts: an array of objects with nothing at index %u cannot cross "
              "to C, which would read the NULL as an object\n",
              (unsigned)at);
      abort();
    }
  }
  return items;
}

void nts_array_unlend(const NtsArray *array) { (void)array; }

NtsArray *nts_array_from_handles(void *const *items, uint32_t count,
                                 const NtsDescriptor *descriptor) {
  if (items == NULL && count > 0) {
    fprintf(stderr,
            "nts: the platform passed no array where it said there were %u "
            "objects\n",
            (unsigned)count);
    abort();
  }
  NtsArray *out = nts_array_allocate(descriptor, count);
  void *(*retain)(void *) = descriptor->foreign_slots[0].ops->retain;
  void **into = NTS_ITEMS(out, void *);
  for (uint32_t at = 0; at < count; at++) {
    if (items[at] == NULL) {
      fprintf(stderr,
              "nts: the platform passed a null element at index %u in an "
              "array of objects\n",
              (unsigned)at);
      abort();
    }
    into[at] = retain(items[at]);
  }
  return out;
}

void nts_boxed_unlend(const void *box) { (void)box; }

/* One descriptor for every boxed record: the box holds no reference -- a
 * GLib boxed record is plain C data, and a record whose fields held a
 * `GObject *` would be the first reason to revisit this `cyclic` of 0 -- so
 * the collector never looks inside one, and `nts_free_storage` gives the
 * record back through the box's own `free`. */
static const NtsDescriptor nts_desc_boxed = {NTS_KIND_BOXED,
                                             (uint32_t)sizeof(NtsBoxed),
                                             0u,
                                             0u,
                                             0,
                                             0,
                                             "boxed record",
                                             0u,
                                             0,
                                             NTS_ARRAY_UNKNOWN,
                                             0u,
                                             NULL,
                                             NULL,
                                             NULL,
                                             NULL,
                                             NULL};

NtsHeader *nts_boxed_new(void *boxed, void (*free)(void *boxed, size_t data),
                         size_t data) {
  if (free == NULL) {
    fprintf(stderr, "nts: a boxed record with no function to free it\n");
    abort();
  }
  if (boxed == NULL) {
    return NULL;
  }
  NtsBoxed *box = (NtsBoxed *)nts_object_new(&nts_desc_boxed);
  box->boxed = boxed;
  box->free = free;
  box->data = data;
  return (NtsHeader *)box;
}

/* # A region's handle: what compiled code holds
 *
 * A counted box on the heap holding one region, so that reference counting
 * places the reset: the compiler holds the box wherever something read out of
 * the call's result is still used (`nts_region_hold`), and the release after
 * the last hold -- on every path, an exit or a raise included -- is the box's
 * death, which resets the region. */
#ifdef NTS_PROVIDER_RC
static void nts_region_box_free(void *boxed, size_t data) {
  (void)data;
  nts_region_reset((NtsRegion *)boxed);
}

NtsHeader *nts_region_begin(void) {
  /* Never inside another region's call. The box would be made, and later die,
   * in that region's accounting window; the compiler opens no region inside a
   * region's clone, whose allocations go to the outer region already. */
  if (nts_env->region) {
    fprintf(stderr, "nts: a region's handle was begun inside another "
                    "region's call\n");
    abort();
  }
  NtsBoxed *box = (NtsBoxed *)nts_object_new(&nts_desc_boxed);
  box->boxed = nts_region_open();
  box->free = nts_region_box_free;
  box->data = 0;
  return (NtsHeader *)box;
}

void nts_region_end_call(NtsHeader *box) {
  nts_region_suspend((NtsRegion *)((NtsBoxed *)box)->boxed);
}

void nts_region_keep(NtsHeader *box, NtsHeader *value) {
  if (!value) {
    return;
  }
  NtsRegion *region = (NtsRegion *)((NtsBoxed *)box)->boxed;
  if (region->kept_len == region->kept_cap) {
    uint32_t grown = region->kept_cap ? region->kept_cap * 2u : 4u;
    NtsHeader **moved = (NtsHeader **)realloc((void *)region->kept,
                                              grown * sizeof(NtsHeader *));
    if (!moved) {
      fprintf(stderr, "nts: out of memory keeping a region's argument\n");
      abort();
    }
    region->kept = moved;
    region->kept_cap = grown;
  }
  nts_retain(value);
  region->kept[region->kept_len++] = value;
}
#else
NtsHeader *nts_region_begin(void) { return NULL; }
void nts_region_end_call(NtsHeader *box) { (void)box; }
void nts_region_keep(NtsHeader *box, NtsHeader *value) {
  (void)box;
  (void)value;
}
#endif

/* Nothing, and that is the point: a use of the box that the backends render as
 * nothing, so its release cannot come before it. */
void nts_region_hold(const NtsHeader *box) { (void)box; }

NtsArray *nts_strings_from_cstrings(const char *const *c, bool required) {
  if (c == NULL) {
    if (required) {
      fprintf(stderr, "nts: a C function declared to return an array of "
                      "strings returned NULL\n");
      abort();
    }
    return NULL;
  }
  uint32_t count = 0;
  while (c[count] != NULL) {
    if (count == UINT32_MAX) {
      fprintf(stderr, "nts: out of memory\n");
      abort();
    }
    count++;
  }
  NtsArray *array = nts_array_new(&nts_desc_ref, count);
  for (uint32_t at = 0; at < count; at++) {
    NTS_ITEMS(array, NtsString *)[at] = nts_string_from_cstring(c[at]);
  }
  return array;
}

/* A lent answer is the string's own storage, and anything else was
 * allocated: the source is what tells the two apart. */
void nts_cstring_release(const NtsString *s, const char *c) {
  if (s != NULL && c == (const char *)NTS_ELEMENTS(s, unsigned char)) {
    return;
  }
  free((void *)c);
}

/* The index of the first zero unit, or `length` when there is none. */
static uint32_t nts_first_zero_unit(const NtsString *s) {
  for (uint32_t at = 0; at < s->length; at++) {
    if (nts_unit(s, at) == 0u) {
      return at;
    }
  }
  return s->length;
}

const uint16_t *nts_string_to_utf16(const NtsString *s) {
  if (s == NULL) {
    return NULL;
  }
  uint32_t zero = nts_first_zero_unit(s);
  if (zero != s->length) {
    fprintf(stderr,
            "nts: a string containing U+0000 at index %u cannot cross to C "
            "as a NUL-terminated UTF-16 string\n",
            (unsigned)zero);
    abort();
  }
  if (s->flags & NTS_TWO_BYTE) {
    return NTS_ELEMENTS(s, uint16_t);
  }
  uint16_t *out = (uint16_t *)malloc(((size_t)s->length + 1u) * 2u);
  if (!out) {
    fprintf(stderr, "nts: out of memory\n");
    abort();
  }
  const unsigned char *bytes = NTS_ELEMENTS(s, unsigned char);
  for (uint32_t at = 0; at < s->length; at++) {
    out[at] = bytes[at];
  }
  out[s->length] = 0;
  return out;
}

void nts_utf16_release(const NtsString *s, const uint16_t *units) {
  if (s != NULL && units == NTS_ELEMENTS(s, uint16_t)) {
    return;
  }
  free((void *)units);
}

/* A `StringView` parameter: the string the compiled program lent, read where
 * it is stored. No copy and no scan, so it is exact by construction -- the
 * units are the string's, whatever they hold. */
NtsStringView nts_string_view(const NtsBorrowedString *string) {
  const NtsString *s = (const NtsString *)string;
  if (s == NULL) {
    return (NtsStringView){NULL, 0, 0};
  }
  uint32_t flags = 0;
  if (s->flags & NTS_TWO_BYTE) {
    flags |= NTS_STRING_VIEW_WIDE;
  }
  if (s->reserved == NTS_IMMORTAL) {
    flags |= NTS_STRING_VIEW_IMMORTAL;
  }
  return (NtsStringView){NTS_ELEMENTS(s, const unsigned char), s->length,
                         flags};
}

NtsString *nts_string_from_cstring(const char *c) {
  if (c == NULL) {
    return NULL;
  }
  return nts_string_from_utf8(c, strlen(c));
}

NtsString *nts_string_from_required_cstring(const char *c) {
  if (c == NULL) {
    fprintf(stderr, "nts: a native function declared to return a `string` "
                    "returned NULL; declare it `string | null`\n");
    abort();
  }
  return nts_string_from_utf8(c, strlen(c));
}

NtsString *nts_string_from_view(const NtsStringView *view) {
  if (view == NULL) {
    return NULL;
  }
  if (view->flags & NTS_STRING_VIEW_WIDE) {
    return nts_str_alloc((const uint16_t *)view->units, view->length);
  }
  NtsString *out = nts_str_raw(view->length, 0);
  if (view->length) {
    memcpy(NTS_ELEMENTS(out, unsigned char), view->units, view->length);
  }
  return out;
}

NtsString *nts_string_from_required_view(const NtsStringView *view) {
  if (view == NULL) {
    fprintf(stderr, "nts: a native function declared to return a "
                    "`StringView` returned NULL; declare it `StringView | "
                    "null`\n");
    abort();
  }
  return nts_string_from_view(view);
}

void *nts_closure_lend(NtsHeader *closure) {
  nts_retain(closure);
  return closure;
}

void nts_closure_unlend(void *context) { nts_release((NtsHeader *)context); }

/* Owner thread only, as the pair above: a bridge runs where C calls it, and
 * the library calling it back is on the loop that lent it. */
static size_t nts_owed_callbacks;

void *nts_closure_lend_once(NtsHeader *closure) {
  nts_owed_callbacks++;
  return nts_closure_lend(closure);
}

void nts_closure_unlend_once(void *context) {
  nts_owed_callbacks--;
  nts_closure_unlend(context);
}

size_t nts_closures_owed(void) { return nts_owed_callbacks; }

void (*nts_closure_notify(void))(void *) { return nts_closure_unlend; }

/* The code units `trim` removes.
 *
 * The specification's `WhiteSpace` and `LineTerminator` together, which is not
 * "what `isspace` says": it includes NBSP, the BOM, and the Unicode space
 * separators, and excludes nothing an ASCII test would have caught. Written out
 * because the set is small, closed, and worth being able to read.
 */
static bool nts_str_is_space(uint32_t unit) {
  switch (unit) {
  case 0x0009: /* TAB */
  case 0x000A: /* LF  */
  case 0x000B: /* VT  */
  case 0x000C: /* FF  */
  case 0x000D: /* CR  */
  case 0x0020: /* SP  */
  case 0x00A0: /* NBSP */
  case 0x1680:
  case 0x2028: /* LS */
  case 0x2029: /* PS */
  case 0x202F:
  case 0x205F:
  case 0x3000:
  case 0xFEFF: /* ZWNBSP, the byte order mark */
    return true;
  default:
    return unit >= 0x2000u && unit <= 0x200Au;
  }
}

/* StringIntegerLiteral, with magnitude retained only through 2^127. Past that
 * every native BigInt is smaller in magnitude. Continue validating all code
 * units after overflow: a huge integer followed by a dot is still invalid.
 * No string copy or arbitrary-precision allocation is needed for ordering. */
typedef struct {
  unsigned __int128 magnitude;
  bool negative;
  bool past;
} NtsIntegerString;

static bool nts_str_integer(const NtsString *s, NtsIntegerString *out) {
  if (s == NULL) {
    return false;
  }
  uint32_t from = 0;
  uint32_t to = s->length;
  while (from < to && nts_str_is_space(nts_unit(s, from))) {
    from++;
  }
  while (to > from && nts_str_is_space(nts_unit(s, to - 1))) {
    to--;
  }
  *out = (NtsIntegerString){0, false, false};
  if (from == to) {
    return true;
  }

  bool signed_decimal = false;
  uint16_t unit = nts_unit(s, from);
  if (unit == '+' || unit == '-') {
    signed_decimal = true;
    out->negative = unit == '-';
    from++;
  }
  uint32_t base = 10;
  if (!signed_decimal && to - from >= 2 && nts_unit(s, from) == '0') {
    switch (nts_unit(s, from + 1)) {
    case 'x':
    case 'X':
      base = 16;
      break;
    case 'o':
    case 'O':
      base = 8;
      break;
    case 'b':
    case 'B':
      base = 2;
      break;
    default:
      break;
    }
    if (base != 10) {
      from += 2;
    }
  }
  if (from == to) {
    return false;
  }

  const unsigned __int128 limit = (unsigned __int128)1 << 127;
  for (; from < to; from++) {
    unit = nts_unit(s, from);
    uint32_t digit;
    if (unit >= '0' && unit <= '9') {
      digit = (uint32_t)(unit - '0');
    } else if (unit >= 'a' && unit <= 'f') {
      digit = (uint32_t)(unit - 'a') + 10u;
    } else if (unit >= 'A' && unit <= 'F') {
      digit = (uint32_t)(unit - 'A') + 10u;
    } else {
      return false;
    }
    if (digit >= base) {
      return false;
    }
    if (!out->past) {
      if (out->magnitude > (limit - digit) / base) {
        out->past = true;
      } else {
        out->magnitude = out->magnitude * base + digit;
      }
    }
  }
  out->negative = out->negative && (out->past || out->magnitude != 0);
  return true;
}

double nts_bigint_compare_string(__int128 value, const NtsString *text) {
  NtsIntegerString parsed;
  if (!nts_str_integer(text, &parsed)) {
    return (double)NAN;
  }
  bool negative = value < 0;
  if (negative != parsed.negative) {
    return negative ? -1.0 : 1.0;
  }
  if (parsed.past) {
    return negative ? 1.0 : -1.0;
  }
  /* Unsigned negation also covers the asymmetric -2^127 endpoint. */
  unsigned __int128 magnitude =
      negative ? (unsigned __int128)0 - (unsigned __int128)value
               : (unsigned __int128)value;
  int order = (magnitude > parsed.magnitude) - (magnitude < parsed.magnitude);
  return (double)(negative ? -order : order);
}

/* `trim`, `trimStart` and `trimEnd`, which differ only in which ends they
 * move. One walk each way and then a slice, so a string with nothing to trim
 * still allocates a copy -- which is what every other string operation here
 * does, strings being immutable. */
static NtsString *nts_str_trimmed(const NtsString *s, bool start, bool end) {
  uint32_t from = 0;
  uint32_t to = s->length;
  if (start) {
    while (from < to && nts_str_is_space(nts_unit(s, from))) {
      from++;
    }
  }
  if (end) {
    while (to > from && nts_str_is_space(nts_unit(s, to - 1))) {
      to--;
    }
  }
  return nts_str_slice(s, (double)from, (double)to);
}

/* `Number(s)`, which the specification calls StringToNumber.
 *
 * Not a C parser on the whole string, which is the obvious implementation and
 * the wrong one. C's accepts spellings JavaScript does not -- `inf`, `nan` and
 * a hexadecimal *float* with a `p` exponent -- and JavaScript accepts some C's
 * does not, `0b`, `0o`. So the grammar is checked here and the value of a span
 * it admits as a decimal literal comes from `nts_decimal_value`, correctly
 * rounded, which a hand-rolled accumulate-and-scale is not.
 *
 * Whitespace is `nts_str_is_space`, the same predicate `trim` uses, because
 * StrWhiteSpace and TrimString's are the same set. An empty or all-space string
 * is +0 rather than NaN -- `Number("")` is 0 and `Number(" ")` is 0, which is
 * the case people are surprised by and the one node agrees with.
 *
 * Anything outside ASCII is NaN: no numeric literal has a code unit above 0x7F.
 * A narrow string's bytes are read where they are; a wide one's are copied,
 * and a single unit above 0x7F settles it before the copy finishes.
 */
static bool nts_number_span_is_decimal(const char *text, size_t length) {
  size_t at = 0;
  if (at < length && (text[at] == '+' || text[at] == '-')) {
    at++;
  }
  size_t before = at;
  while (at < length && text[at] >= '0' && text[at] <= '9') {
    at++;
  }
  size_t integral = at - before;
  size_t fractional = 0;
  if (at < length && text[at] == '.') {
    at++;
    size_t start = at;
    while (at < length && text[at] >= '0' && text[at] <= '9') {
      at++;
    }
    fractional = at - start;
  }
  /* `.` alone, `+.` and `-` are not literals. One digit somewhere is the whole
   * requirement, and it may be on either side of the point: `1.`, `.5` and `1`
   * are all numbers and `.` is not. */
  if (integral == 0 && fractional == 0) {
    return false;
  }
  if (at < length && (text[at] == 'e' || text[at] == 'E')) {
    at++;
    if (at < length && (text[at] == '+' || text[at] == '-')) {
      at++;
    }
    size_t start = at;
    while (at < length && text[at] >= '0' && text[at] <= '9') {
      at++;
    }
    if (at == start) {
      return false;
    }
  }
  return at == length;
}

/* A radix literal: `0x`, `0o`, `0b` and their capitals.
 *
 * Unsigned by grammar -- `-0x10` is NaN in JavaScript, not -16 -- so the sign
 * is not consumed before this is asked. Accumulated in `double` rather than an
 * integer type because the specification's answer for a literal past 2^53 is
 * the rounded double, and an integer accumulator would wrap instead. */
static bool nts_number_radix(const char *text, size_t length, double *out) {
  if (length < 3 || text[0] != '0') {
    return false;
  }
  double radix;
  switch (text[1]) {
  case 'x':
  case 'X':
    radix = 16.0;
    break;
  case 'o':
  case 'O':
    radix = 8.0;
    break;
  case 'b':
  case 'B':
    radix = 2.0;
    break;
  default:
    return false;
  }
  double value = 0.0;
  for (size_t at = 2; at < length; at++) {
    char unit = text[at];
    double digit;
    if (unit >= '0' && unit <= '9') {
      digit = (double)(unit - '0');
    } else if (unit >= 'a' && unit <= 'f') {
      digit = (double)(unit - 'a') + 10.0;
    } else if (unit >= 'A' && unit <= 'F') {
      digit = (double)(unit - 'A') + 10.0;
    } else {
      return false;
    }
    if (digit >= radix) {
      return false;
    }
    value = value * radix + digit;
  }
  *out = value;
  return true;
}

/* The double nearest a decimal literal the grammar here has already admitted --
 * `[+-]digits[.digits][e[+-]digits]`, a digit on one side of the point at
 * least, every byte ASCII -- through ffc (fast_float): correctly rounded, and
 * the C library's locale has no say. Out of range is still an answer, ±Infinity
 * or ±0 as the specification asks, which ffc writes before it says so. A span
 * it does not read to the end is not one this admitted, and is NaN. */
static double nts_decimal_value(const char *text, size_t length) {
  ffc_parse_options options = ffc_parse_options_default();
  options.format = FFC_PRESET_GENERAL | FFC_FORMAT_FLAG_NO_INFNAN |
                   FFC_FORMAT_FLAG_ALLOW_LEADING_PLUS;
  double value = (double)NAN;
  const ffc_result read =
      ffc_from_chars_double_options(text, text + length, &value, options);
  if (read.ptr != text + length || read.outcome == FFC_OUTCOME_INVALID_INPUT) {
    return (double)NAN;
  }
  return value;
}

/* StringToNumber on a trimmed, non-empty span of ASCII-or-not bytes:
 * `Infinity` with an optional sign, a radix literal (unsigned by grammar), a
 * decimal literal, or NaN. */
static double nts_number_literal(const char *text, size_t length) {
  const char *body = text;
  size_t remaining = length;
  bool negative = false;
  if (body[0] == '+' || body[0] == '-') {
    negative = body[0] == '-';
    body++;
    remaining--;
  }
  /* `Infinity` with an optional sign, and nothing else spelled with letters. */
  if (remaining == 8 && memcmp(body, "Infinity", 8) == 0) {
    return negative ? -(double)INFINITY : (double)INFINITY;
  }
  double answer;
  if (nts_number_radix(text, length, &answer)) {
    return answer;
  }
  if (nts_number_span_is_decimal(text, length)) {
    return nts_decimal_value(text, length);
  }
  return (double)NAN;
}

/* `Number(v)` on an erased value: ECMAScript ToNumber over the tags a value can
 * carry.
 *
 * Four of the five are the specification verbatim -- a number is itself, a
 * boolean is 1 or 0, `null` is +0, `undefined` is NaN -- and a string is
 * StringToNumber, which is `nts_str_to_number` above rather than a second
 * parser.
 *
 * A **reference** answers NaN, and that is the one arm that is not the whole
 * rule. ToNumber of an object is ToPrimitive first, which runs `valueOf` and
 * `toString` off a prototype chain: `Number([])` is 0 and `Number([5])` is 5,
 * neither of which this can produce. So the lowering only emits this call where
 * the checker's type or a builtin argument's tag guard admits no object. The
 * builtin guard throws for Symbol/BigInt before this call. The arm is here
 * because a tag switch with a hole is worse than one with an answer that cannot
 * be reached. NaN is also what the specification gives for a plain `{}`, so the
 * unreachable case is at least not a surprising number. */
double nts_value_to_number(NtsValue value) {
  switch (nts_value_tag(value)) {
  case NTS_TAG_NUMBER:
    return nts_value_number(value);
  case NTS_TAG_BOOLEAN:
    return nts_value_boolean(value) ? 1.0 : 0.0;
  case NTS_TAG_STRING:
    return nts_str_to_number((const NtsString *)nts_value_reference(value));
  case NTS_TAG_NULL:
    return 0.0;
  case NTS_TAG_BIGINT:
    fputs(NTS_REFUSED "an implicit conversion of a bigint to a number, which "
                      "is a TypeError\n",
          stderr);
    abort();
  default:
    return (double)NAN;
  }
}

double nts_value_to_number_explicit(NtsValue value) {
  if (nts_value_tag(value) == NTS_TAG_BIGINT) {
    return (double)nts_bigint_unbox(
        (const NtsBigIntBox *)nts_value_reference(value));
  }
  return nts_value_to_number(value);
}

/* `parseFloat(string)`.
 *
 * Not `strtod` on the whole string, and not `Number(s)` either. Three
 * differences, each of which is a wrong answer rather than a rounding:
 *
 *   parseFloat("0x10")   is 0   -- it parses "0" and stops at 'x'; strtod reads
 *                                  a hexadecimal float and answers 16
 *   parseFloat("inf")    is NaN -- strtod accepts "inf" and "nan", the language
 *                                  accepts only "Infinity"
 *   parseFloat("12abc")  is 12  -- Number("12abc") is NaN
 *
 * So the longest prefix the grammar admits is measured here and `strtod` is
 * given only that. It is the same split `nts_parse_int` makes for the same
 * reason: stopping where the text stops being a number is the whole of what
 * these two do that a conversion does not.
 *
 * The digits themselves are handed to `strtod` rather than accumulated, because
 * correctly rounding a decimal string to the nearest double is exactly what it
 * is for, and doing it by multiplication loses the last bit. */
/* The four URI builtins, as two functions with a set each.
 *
 * `encodeURI` and `encodeURIComponent` differ only in which characters they
 * leave alone, and `decodeURI` and `decodeURIComponent` only in which escapes
 * they leave *escaped*. Writing them as four would be four copies of the UTF-8
 * half, which is the part with the edges in it.
 *
 * # Why these cannot be `strtod`'s kind of shortcut
 *
 * The escaped form is UTF-8 and the string is UTF-16, so both directions
 * transcode, and both are specified to **throw `URIError`** on input the other
 * direction could not have produced. That is the whole difficulty:
 * `decodeURIComponent("%E0%A4%A")` is a `URIError` and not a best effort, and
 * `nts_string_from_utf8` substitutes `U+FFFD` for malformed input, so it cannot
 * be reused here.
 *
 * A runtime function here cannot throw, so these answer `NULL` and the lowering
 * emits the `URIError` -- the same split `nts_string_repeat` uses for its
 * `RangeError`.
 *
 * `component` is a `double` rather than an `int` because that is the one
 * argument shape the backends already carry for a runtime call --
 * `nts_parse_int(s, radix)` is the same pair -- and a second convention for a
 * flag would be a signature table entry to get wrong in two backends. */

/* One hex digit's value, or -1. Deliberately not `isxdigit`: that is
 * locale-dependent in principle and takes an `int` that a `uint16_t` would
 * widen into the negative range on a signed char platform. */
static int nts_uri_hex(uint16_t unit) {
  if (unit >= '0' && unit <= '9') {
    return (int)(unit - '0');
  }
  if (unit >= 'A' && unit <= 'F') {
    return (int)(unit - 'A') + 10;
  }
  if (unit >= 'a' && unit <= 'f') {
    return (int)(unit - 'a') + 10;
  }
  return -1;
}

/* `uriReserved` plus `#`, which is the set `decodeURI` leaves escaped and
 * `encodeURI` leaves alone. `decodeURIComponent` and `encodeURIComponent` use
 * the empty set and the smaller set respectively, which is the whole of the
 * difference between the pairs. */
static const char NTS_URI_RESERVED[] = ";/?:@&=+$,#";

/* `uriUnescaped`: the alphanumerics and `uriMark`. */
static int nts_uri_unescaped(uint32_t point) {
  if ((point >= 'A' && point <= 'Z') || (point >= 'a' && point <= 'z') ||
      (point >= '0' && point <= '9')) {
    return 1;
  }
  return point < 0x80u && strchr("-_.!~*'()", (int)point) != NULL;
}

/* A string of UTF-16 units, narrow where every one of them fits in a byte.
 *
 * The narrow form is not an optimisation that can be skipped: `nts_unit` reads
 * one or two bytes according to the flag, so a string built wide and compared
 * against a literal built narrow is a different object with the same
 * characters. */
static NtsString *nts_uri_string(const uint16_t *units, uint32_t length) {
  int wide = 0;
  for (uint32_t at = 0; at < length; at++) {
    if (units[at] > 0xFFu) {
      wide = 1;
      break;
    }
  }
  NtsString *out = nts_str_build(NULL, length, wide);
  if (wide) {
    uint16_t *into = NTS_ELEMENTS(out, uint16_t);
    for (uint32_t at = 0; at < length; at++) {
      into[at] = units[at];
    }
    into[length] = 0;
  } else {
    unsigned char *into = NTS_ELEMENTS(out, unsigned char);
    for (uint32_t at = 0; at < length; at++) {
      into[at] = (unsigned char)units[at];
    }
    into[length] = 0;
  }
  return out;
}

/* `decodeURI` and `decodeURIComponent`. `NULL` is a `URIError`.
 *
 * `component` decides whether a reserved character that arrives escaped stays
 * escaped: `decodeURI("%2F")` is `"%2F"` and `decodeURIComponent("%2F")` is
 * `"/"`. That is not a nicety -- `decodeURI` exists to leave a URI's structure
 * intact, so decoding its separators would change what the string means. */
NtsString *nts_decode_uri(const NtsString *s, double component) {
  if (!s) {
    return NULL;
  }
  uint32_t units = s->length;
  /* At most one output unit per input unit: an escape is three units in and at
   * most two out, and everything else is one for one. */
  uint16_t *out = (uint16_t *)malloc(((size_t)units + 1u) * sizeof(uint16_t));
  if (!out) {
    return NULL;
  }
  uint32_t written = 0;
  uint32_t at = 0;
  while (at < units) {
    uint16_t unit = nts_unit(s, at);
    if (unit != '%') {
      out[written++] = unit;
      at++;
      continue;
    }
    uint32_t start = at;
    if (at + 2u >= units) {
      free(out);
      return NULL;
    }
    int high = nts_uri_hex(nts_unit(s, at + 1u));
    int low = nts_uri_hex(nts_unit(s, at + 2u));
    if (high < 0 || low < 0) {
      free(out);
      return NULL;
    }
    uint32_t byte = (uint32_t)(high * 16 + low);
    at += 3u;
    if (byte < 0x80u) {
      if (component == 0.0 && byte < 0x80u &&
          strchr(NTS_URI_RESERVED, (int)byte) != NULL) {
        /* Kept as written, which means the three units it arrived as. */
        out[written++] = nts_unit(s, start);
        out[written++] = nts_unit(s, start + 1u);
        out[written++] = nts_unit(s, start + 2u);
      } else {
        out[written++] = (uint16_t)byte;
      }
      continue;
    }
    /* A continuation byte where a lead was wanted, or a lead claiming more than
     * four bytes. Both are input no encoder produced. */
    uint32_t extra;
    uint32_t point;
    if ((byte & 0xE0u) == 0xC0u) {
      extra = 1;
      point = byte & 0x1Fu;
    } else if ((byte & 0xF0u) == 0xE0u) {
      extra = 2;
      point = byte & 0x0Fu;
    } else if ((byte & 0xF8u) == 0xF0u) {
      extra = 3;
      point = byte & 0x07u;
    } else {
      free(out);
      return NULL;
    }
    for (uint32_t more = 0; more < extra; more++) {
      if (at + 2u >= units || nts_unit(s, at) != '%') {
        free(out);
        return NULL;
      }
      int h = nts_uri_hex(nts_unit(s, at + 1u));
      int l = nts_uri_hex(nts_unit(s, at + 2u));
      if (h < 0 || l < 0) {
        free(out);
        return NULL;
      }
      uint32_t next = (uint32_t)(h * 16 + l);
      if ((next & 0xC0u) != 0x80u) {
        free(out);
        return NULL;
      }
      point = (point << 6) | (next & 0x3Fu);
      at += 3u;
    }
    /* **Overlong, surrogate and out-of-range are all errors**, and checking
     * them is not pedantry: an overlong encoding is a second spelling of a
     * character, which is how a check on the decoded text gets bypassed. The
     * specification's `Decode` rejects each by name. */
    uint32_t least = extra == 1 ? 0x80u : (extra == 2 ? 0x800u : 0x10000u);
    if (point < least || point > 0x10FFFFu ||
        (point >= 0xD800u && point <= 0xDFFFu)) {
      free(out);
      return NULL;
    }
    if (point > 0xFFFFu) {
      point -= 0x10000u;
      out[written++] = (uint16_t)(0xD800u + (point >> 10));
      out[written++] = (uint16_t)(0xDC00u + (point & 0x3FFu));
    } else {
      out[written++] = (uint16_t)point;
    }
  }
  NtsString *built = nts_uri_string(out, written);
  free(out);
  return built;
}

/* `encodeURI` and `encodeURIComponent`. `NULL` is a `URIError`, which here
 * means an unpaired surrogate: there is no UTF-8 for half a character. */
NtsString *nts_encode_uri(const NtsString *s, double component) {
  if (!s) {
    return NULL;
  }
  uint32_t units = s->length;
  /* Three output units per byte, four bytes per code point, and a code point
   * is at least one input unit. */
  uint16_t *out =
      (uint16_t *)malloc(((size_t)units * 12u + 1u) * sizeof(uint16_t));
  if (!out) {
    return NULL;
  }
  static const char digits[] = "0123456789ABCDEF";
  uint32_t written = 0;
  uint32_t at = 0;
  while (at < units) {
    uint32_t point = nts_unit(s, at);
    at++;
    if (point >= 0xD800u && point <= 0xDBFFu) {
      if (at >= units) {
        free(out);
        return NULL;
      }
      uint32_t trail = nts_unit(s, at);
      if (trail < 0xDC00u || trail > 0xDFFFu) {
        free(out);
        return NULL;
      }
      point = 0x10000u + ((point - 0xD800u) << 10) + (trail - 0xDC00u);
      at++;
    } else if (point >= 0xDC00u && point <= 0xDFFFu) {
      /* A trail with no lead in front of it. */
      free(out);
      return NULL;
    }
    if (nts_uri_unescaped(point) ||
        (component == 0.0 && point < 0x80u &&
         strchr(NTS_URI_RESERVED, (int)point) != NULL)) {
      out[written++] = (uint16_t)point;
      continue;
    }
    unsigned char bytes[4];
    uint32_t count;
    if (point < 0x80u) {
      bytes[0] = (unsigned char)point;
      count = 1;
    } else if (point < 0x800u) {
      bytes[0] = (unsigned char)(0xC0u | (point >> 6));
      bytes[1] = (unsigned char)(0x80u | (point & 0x3Fu));
      count = 2;
    } else if (point < 0x10000u) {
      bytes[0] = (unsigned char)(0xE0u | (point >> 12));
      bytes[1] = (unsigned char)(0x80u | ((point >> 6) & 0x3Fu));
      bytes[2] = (unsigned char)(0x80u | (point & 0x3Fu));
      count = 3;
    } else {
      bytes[0] = (unsigned char)(0xF0u | (point >> 18));
      bytes[1] = (unsigned char)(0x80u | ((point >> 12) & 0x3Fu));
      bytes[2] = (unsigned char)(0x80u | ((point >> 6) & 0x3Fu));
      bytes[3] = (unsigned char)(0x80u | (point & 0x3Fu));
      count = 4;
    }
    for (uint32_t byte = 0; byte < count; byte++) {
      out[written++] = '%';
      out[written++] = (uint16_t)digits[bytes[byte] >> 4];
      out[written++] = (uint16_t)digits[bytes[byte] & 0x0Fu];
    }
  }
  NtsString *built = nts_uri_string(out, written);
  free(out);
  return built;
}

double nts_parse_float(const NtsString *s) {
  if (!s) {
    return (double)NAN;
  }
  uint32_t units = s->length;
  uint32_t at = 0;
  /* `StrWhiteSpaceChar`, the same set `nts_parse_int` skips. */
  while (at < units) {
    uint16_t unit = nts_unit(s, at);
    if (unit != 0x20 && unit != 0x09 && unit != 0x0a && unit != 0x0d &&
        unit != 0x0b && unit != 0x0c && unit != 0xa0 && unit != 0xfeff) {
      break;
    }
    at++;
  }
  uint32_t start = at;
  bool negative = false;
  if (at < units && (nts_unit(s, at) == '+' || nts_unit(s, at) == '-')) {
    negative = nts_unit(s, at) == '-';
    at++;
  }
  /* `Infinity`, spelled out. Checked before the digits because it shares no
   * prefix with them and because "Infinity" is the only word form admitted. */
  static const char infinity[] = "Infinity";
  uint32_t spelled = 0;
  while (spelled < 8u && at + spelled < units &&
         nts_unit(s, at + spelled) == (uint16_t)infinity[spelled]) {
    spelled++;
  }
  if (spelled == 8u) {
    return negative ? -(double)INFINITY : (double)INFINITY;
  }

  uint32_t digits = at;
  while (at < units && nts_unit(s, at) >= '0' && nts_unit(s, at) <= '9') {
    at++;
  }
  bool any = at > digits;
  if (at < units && nts_unit(s, at) == '.') {
    at++;
    while (at < units && nts_unit(s, at) >= '0' && nts_unit(s, at) <= '9') {
      at++;
      any = true;
    }
  }
  if (!any) {
    return (double)NAN;
  }
  /* An exponent counts only if it has at least one digit after it. `"1e"` is
   * 1 and not NaN, so the scan backs up rather than failing. */
  if (at < units && (nts_unit(s, at) == 'e' || nts_unit(s, at) == 'E')) {
    uint32_t after = at + 1u;
    if (after < units &&
        (nts_unit(s, after) == '+' || nts_unit(s, after) == '-')) {
      after++;
    }
    uint32_t exponent = after;
    while (after < units && nts_unit(s, after) >= '0' &&
           nts_unit(s, after) <= '9') {
      after++;
    }
    if (after > exponent) {
      at = after;
    }
  }

  /* The admitted prefix as bytes. Every unit in it is ASCII by construction --
   * a digit, a sign, a dot or an `e` -- so one byte each is exact and no
   * encoding step is needed: a narrow string's are read where they are. */
  uint32_t length = at - start;
  if ((s->flags & NTS_TWO_BYTE) == 0) {
    return nts_decimal_value(NTS_ELEMENTS(s, const char) + start, length);
  }
  char stack[64];
  char *text = stack;
  if (length + 1u > sizeof stack) {
    text = (char *)malloc((size_t)length + 1u);
    if (!text) {
      return (double)NAN;
    }
  }
  for (uint32_t i = 0; i < length; i++) {
    text[i] = (char)nts_unit(s, start + i);
  }
  text[length] = '\0';
  double value = nts_decimal_value(text, length);
  if (text != stack) {
    free(text);
  }
  return value;
}

double nts_parse_int(const NtsString *s, double radix) {
  if (!s) {
    return (double)NAN;
  }
  uint32_t units = s->length;
  uint32_t at = 0;
  /* The specification's `StrWhiteSpaceChar`, which is what `trimStart` uses. */
  while (at < units) {
    uint16_t unit = nts_unit(s, at);
    if (unit != 0x20 && unit != 0x09 && unit != 0x0a && unit != 0x0d &&
        unit != 0x0b && unit != 0x0c && unit != 0xa0 && unit != 0xfeff) {
      break;
    }
    at++;
  }
  bool negative = false;
  if (at < units && (nts_unit(s, at) == '+' || nts_unit(s, at) == '-')) {
    negative = nts_unit(s, at) == '-';
    at++;
  }
  int32_t base = (int32_t)radix;
  if (radix != radix || base == 0) {
    base = 0;
  }
  if (base != 0 && (base < 2 || base > 36)) {
    return (double)NAN;
  }
  if ((base == 0 || base == 16) && at + 1 < units && nts_unit(s, at) == '0' &&
      (nts_unit(s, at + 1) == 'x' || nts_unit(s, at + 1) == 'X')) {
    at += 2;
    base = 16;
  }
  if (base == 0) {
    base = 10;
  }
  double value = 0.0;
  uint32_t digits = 0;
  while (at < units) {
    uint16_t unit = nts_unit(s, at);
    int32_t digit;
    if (unit >= '0' && unit <= '9') {
      digit = (int32_t)(unit - '0');
    } else if (unit >= 'a' && unit <= 'z') {
      digit = (int32_t)(unit - 'a') + 10;
    } else if (unit >= 'A' && unit <= 'Z') {
      digit = (int32_t)(unit - 'A') + 10;
    } else {
      break;
    }
    if (digit >= base) {
      break;
    }
    value = value * (double)base + (double)digit;
    digits++;
    at++;
  }
  if (digits == 0) {
    return (double)NAN;
  }
  return negative ? -value : value;
}

double nts_str_to_number(const NtsString *s) {
  if (s == NULL) {
    return 0.0;
  }
  uint32_t from = 0;
  uint32_t to = s->length;
  while (from < to && nts_str_is_space(nts_unit(s, from))) {
    from++;
  }
  while (to > from && nts_str_is_space(nts_unit(s, to - 1))) {
    to--;
  }
  if (from == to) {
    return 0.0;
  }

  size_t length = (size_t)(to - from);
  /* A narrow string's units are its bytes, read where they are. A unit above
   * 0x7F is no part of any literal, and the grammar below refuses it as any
   * other stray character. */
  if ((s->flags & NTS_TWO_BYTE) == 0) {
    return nts_number_literal(NTS_ELEMENTS(s, const char) + from, length);
  }
  /* A wide one is copied to bytes. Long enough for every literal a program
   * writes and short enough to sit in a frame; past it a heap copy, since the
   * value is decided by the leading digits and the exponent and neither
   * survives truncation. `malloc` directly rather than `nts_alloc`: this is
   * scratch that never becomes an object. Anything above 0x7F settles it. */
  char inline_buffer[256];
  char *text = inline_buffer;
  char *owned = NULL;
  if (length > sizeof inline_buffer) {
    owned = (char *)malloc(length);
    if (owned == NULL) {
      return (double)NAN;
    }
    text = owned;
  }
  for (size_t at = 0; at < length; at++) {
    uint32_t unit = nts_unit(s, from + (uint32_t)at);
    if (unit > 0x7Fu) {
      free(owned);
      return (double)NAN;
    }
    text[at] = (char)unit;
  }
  double answer = nts_number_literal(text, length);
  free(owned);
  return answer;
}

NtsString *nts_str_trim(const NtsString *s) {
  return nts_str_trimmed(s, true, true);
}

NtsString *nts_str_trim_start(const NtsString *s) {
  return nts_str_trimmed(s, true, false);
}

NtsString *nts_str_trim_end(const NtsString *s) {
  return nts_str_trimmed(s, false, true);
}

/* `split`, with a string separator.
 *
 * Two passes, because an array is allocated at its final length: one to count
 * the pieces and one to cut them. The alternative is pushing into a growing
 * array, which reallocates and then has to be trimmed.
 *
 * Three answers here are the specification's rather than the obvious ones, and
 * node was asked for each:
 *
 *   "".split(",")   is [""]   -- one empty piece
 *   "".split("")    is []     -- *no* pieces, which is the one special case
 *   "a\u{1F600}".split("") is three, not two: an empty separator cuts between
 *                              code *units*, so a surrogate pair comes apart.
 *
 * The last is why this counts units rather than code points, deliberately,
 * where `for...of` over the same string counts points.
 */
NtsArray *nts_str_split(const NtsString *s, const NtsString *sep) {
  if (sep->length == 0) {
    NtsArray *out = nts_array_new(&nts_desc_ref, (double)s->length);
    for (uint32_t at = 0; at < s->length; at++) {
      NTS_ITEMS(out, NtsHeader *)
      [at] = nts_str_slice(s, (double)at, (double)(at + 1));
    }
    return out;
  }

  uint32_t pieces = 1;
  if (sep->length <= s->length) {
    for (uint32_t at = 0; at + sep->length <= s->length;) {
      double found = nts_str_find(s, sep, at, 0);
      if (found < 0.0) {
        break;
      }
      pieces++;
      at = (uint32_t)found + sep->length;
    }
  }

  NtsArray *out = nts_array_new(&nts_desc_ref, (double)pieces);
  uint32_t written = 0;
  uint32_t from = 0;
  while (written + 1 < pieces) {
    double found = nts_str_find(s, sep, from, 0);
    uint32_t cut = (uint32_t)found;
    NTS_ITEMS(out, NtsHeader *)
    [written++] = nts_str_slice(s, (double)from, (double)cut);
    from = cut + sep->length;
  }
  NTS_ITEMS(out, NtsHeader *)
  [written] = nts_str_slice(s, (double)from, (double)s->length);
  return out;
}

/* `replace` and `replaceAll`, with a string pattern.
 *
 * The replacement is not copied literally. `$` introduces four substitutions,
 * and every one of these answers was transcribed from node rather than reasoned
 * about:
 *
 *     "a-b".replace("-", "$$")     is "a$b"
 *     "a-b".replace("-", "[$&]")   is "a[-]b"    the match itself
 *     "a-b".replace("-", "[$`]")   is "a[a]b"    everything before it
 *     "a-b".replace("-", "[$']")   is "a[b]b"    everything after it
 *     "a-b".replace("-", "$x")     is "a$xb"     anything else stays literal
 *
 * `$1` through `$99` are group references. A *string* pattern has no groups, so
 * they fall into the literal case with everything else, and a trailing `$` at
 * the very end of the replacement is literal too.
 *
 * `$`` and `$'` are why this measures before it allocates instead of
 * computing one length up front: both expand to a slice of the subject whose
 * size depends on *where* the match was, so two matches of the same pattern can
 * contribute different amounts.
 *
 * The empty pattern is the awkward one, and node settled both halves:
 *
 *     "abc".replace("", "+")       is "+abc"     one match, at the front
 *     "abc".replaceAll("", "-")    is "-a-b-c-"  four, including both ends
 */

/* The next match at or after `from`, or -1. An empty pattern matches at every
 * position *including* the end, which is what puts a separator on both ends of
 * `"abc".replaceAll("", "-")`. */
static double nts_str_match_from(const NtsString *s, const NtsString *pattern,
                                 uint32_t from) {
  if (pattern->length == 0) {
    return from <= s->length ? (double)from : -1.0;
  }
  return nts_str_find(s, pattern, from, 0);
}

/* Copy `s[from..to)` to `out[at]`, returning where the next unit goes.
 *
 * `out` is narrow only when every input was, so the widths either match -- one
 * `memcpy` -- or the destination is wide and the source is not, which is the
 * one case that has to widen as it goes. */
static uint32_t nts_str_paste(NtsString *out, uint32_t at, const NtsString *s,
                              uint32_t from, uint32_t to) {
  uint32_t length = to > from ? to - from : 0u;
  if (length == 0) {
    return at;
  }
  if (out->flags & NTS_TWO_BYTE) {
    uint16_t *into = NTS_ELEMENTS(out, uint16_t) + at;
    if (s->flags & NTS_TWO_BYTE) {
      memcpy(into, NTS_ELEMENTS(s, const uint16_t) + from,
             (size_t)length * sizeof(uint16_t));
    } else {
      const unsigned char *bytes = NTS_ELEMENTS(s, const unsigned char) + from;
      for (uint32_t i = 0; i < length; i++) {
        into[i] = bytes[i];
      }
    }
  } else {
    memcpy(NTS_ELEMENTS(out, unsigned char) + at,
           NTS_ELEMENTS(s, const unsigned char) + from, length);
  }
  return at + length;
}

/* Expand one replacement for a match of `matched` units at `at`.
 *
 * With `out` null this measures and writes nothing, which is the first of the
 * two passes; with `out` set it writes and returns the same count. One function
 * for both so the two can never disagree about what `$'` means. */
static uint32_t nts_str_expand(const NtsString *rep, const NtsString *s,
                               uint32_t at, uint32_t matched, NtsString *out,
                               uint32_t cursor) {
  uint32_t written = 0;
  for (uint32_t i = 0; i < rep->length;) {
    if (nts_unit(rep, i) != '$' || i + 1 >= rep->length) {
      if (out) {
        cursor = nts_str_paste(out, cursor, rep, i, i + 1);
      }
      written++;
      i++;
      continue;
    }
    uint16_t next = nts_unit(rep, i + 1);
    uint32_t from = 0;
    uint32_t to = 0;
    switch (next) {
    case '$': /* an escaped dollar, which stands for one of itself */
      if (out) {
        cursor = nts_str_paste(out, cursor, rep, i, i + 1);
      }
      written++;
      i += 2;
      continue;
    case '&':
      from = at;
      to = at + matched;
      break;
    case '`':
      from = 0;
      to = at;
      break;
    case '\'':
      from = at + matched;
      to = s->length;
      break;
    default: /* `$x` is two literal characters, and so is a `$` before a digit
              */
      if (out) {
        cursor = nts_str_paste(out, cursor, rep, i, i + 2);
      }
      written += 2;
      i += 2;
      continue;
    }
    if (out) {
      cursor = nts_str_paste(out, cursor, s, from, to);
    }
    written += to - from;
    i += 2;
  }
  return written;
}

NtsString *nts_str_replace_general(const NtsString *s, const NtsString *pattern,
                                   const NtsString *replacement, bool all) {
  /* An empty pattern advances by one so the walk terminates; a non-empty one
   * resumes past the match, which is what keeps `"aaa".replaceAll("aa", "b")`
   * to a single replacement, as node has it. */
  uint32_t step = pattern->length ? pattern->length : 1u;

  /* First pass: the exact length, since `$`` and `$'` make it depend on
   * every match position. */
  uint32_t total = 0;
  uint32_t last = 0;
  uint32_t at = 0;
  uint32_t matches = 0;
  for (;;) {
    double found = nts_str_match_from(s, pattern, at);
    if (found < 0.0) {
      break;
    }
    uint32_t m = (uint32_t)found;
    total += m - last;
    total += nts_str_expand(replacement, s, m, pattern->length, NULL, 0);
    last = m + pattern->length;
    at = m + step;
    matches++;
    if (!all) {
      break;
    }
  }
  if (matches == 0) {
    /* Nothing matched, so the answer *is* the subject, and it is handed back
     * retained rather than copied. Safe because a string is immutable and the
     * count is what decides its lifetime: the caller owns one reference either
     * way and cannot tell which object it got. A `replace` that finds nothing
     * is common enough to be worth not copying for. */
    nts_retain((NtsHeader *)s);
    return (NtsString *)s;
  }
  total += s->length - last;

  int wide = ((s->flags | replacement->flags) & NTS_TWO_BYTE) != 0;
  NtsString *out = nts_str_raw(total, wide);

  /* Second pass, following exactly the walk the first one took. */
  uint32_t cursor = 0;
  uint32_t written = 0;
  last = 0;
  at = 0;
  while (written < matches) {
    double found = nts_str_match_from(s, pattern, at);
    uint32_t m = (uint32_t)found;
    cursor = nts_str_paste(out, cursor, s, last, m);
    cursor += nts_str_expand(replacement, s, m, pattern->length, out, cursor);
    last = m + pattern->length;
    at = m + step;
    written++;
  }
  nts_str_paste(out, cursor, s, last, s->length);
  return out;
}

NtsString *nts_str_replace(const NtsString *s, const NtsString *pattern,
                           const NtsString *replacement) {
  return nts_str_replace_general(s, pattern, replacement, false);
}

NtsString *nts_str_replace_all(const NtsString *s, const NtsString *pattern,
                               const NtsString *replacement) {
  return nts_str_replace_general(s, pattern, replacement, true);
}

/* Equality is by value, not by identity: `"a" + "b" === "ab"` is true in
 * JavaScript, and the two are different allocations. */
bool nts_string_eq(const NtsString *a, const NtsString *b) {
  if (a == b) {
    return true;
  }
  /* **A null is the absence, and the absence equals no string.**
   *
   * A nullable string slot holds `NULL` for `undefined`, so
   * `table["missing"] === "1"` arrives here as `(NULL, "1")` and this
   * dereferenced it -- `nts_string_eq` in `module.init`, SIGSEGV, with `http`'s
   * whole addon failing to load.
   *
   * The `a == b` above already answers `true` for two absences, which is what
   * `undefined === undefined` is, so only the mixed case is left and it is
   * `false` by the language. Reached the moment a program looked up a key that
   * is not there and compared the result, which `Record<string, string |
   * undefined>` invites -- and nothing had, because a dotted read on such a
   * type was refused and the bracketed form was rare. */
  if (a == 0 || b == 0) {
    return false;
  }
  if (a->length != b->length) {
    return false;
  }
  int a_wide = (a->flags & NTS_TWO_BYTE) != 0;
  int b_wide = (b->flags & NTS_TWO_BYTE) != 0;
  if (a_wide == b_wide) {
    size_t width = a_wide ? 2u : 1u;
    return memcmp(NTS_ELEMENTS(a, const unsigned char),
                  NTS_ELEMENTS(b, const unsigned char),
                  (size_t)a->length * width) == 0;
  }
  /* One of each: compare code unit by code unit rather than widening, so
   * equality never allocates. */
  const NtsString *narrow = a_wide ? b : a;
  const NtsString *wide = a_wide ? a : b;
  const unsigned char *narrow_units = NTS_ELEMENTS(narrow, unsigned char);
  const uint16_t *wide_units = NTS_ELEMENTS(wide, uint16_t);
  for (uint32_t i = 0; i < a->length; i++) {
    if ((uint16_t)narrow_units[i] != wide_units[i]) {
      return false;
    }
  }
  return true;
}

int nts_string_cmp(const NtsString *a, const NtsString *b) {
  if (a == b) {
    return 0;
  }
  uint32_t shared = a->length < b->length ? a->length : b->length;
  int a_wide = (a->flags & NTS_TWO_BYTE) != 0;
  int b_wide = (b->flags & NTS_TWO_BYTE) != 0;
  /* Code unit by code unit, and never on the storage: the two sides may be
   * different widths, and a byte is not a `uint16_t`. Widening one side to
   * compare would allocate, and a comparison must not. */
  for (uint32_t i = 0; i < shared; i++) {
    uint16_t left = a_wide ? NTS_ELEMENTS(a, uint16_t)[i]
                           : (uint16_t)NTS_ELEMENTS(a, unsigned char)[i];
    uint16_t right = b_wide ? NTS_ELEMENTS(b, uint16_t)[i]
                            : (uint16_t)NTS_ELEMENTS(b, unsigned char)[i];
    if (left != right) {
      return left < right ? -1 : 1;
    }
  }
  /* Every shared unit agreed, so a prefix sorts before its extension and two
   * strings of the same length are equal. */
  if (a->length == b->length) {
    return 0;
  }
  return a->length < b->length ? -1 : 1;
}

/* --- Map and Set (one table) ----------------------------------------------
 *
 * JavaScript's `Map` and `Set` iterate in insertion order, which is observable
 * and therefore not negotiable: `for (const k of map.keys())` yields what was
 * inserted first, and a plain open-addressed table yields whatever the hash
 * decided. So this is the compact-dict shape -- a dense, insertion-ordered
 * array of entries, plus a sparse index of slots pointing into it.
 *
 *   index[]   slots, a power of two.  EMPTY, DELETED, or an entry number.
 *   keys[]    entries, in insertion order.  A removed one is a hole.
 *   values[]  the same length, or null for a Set.
 *
 * Iteration walks `keys` and skips holes: contiguous, in order, one array.
 * Lookup hashes into `index` and follows a linear probe. Deletion punches a
 * hole and marks the slot DELETED, so the entry numbers everything else holds
 * stay valid; the holes are compacted away when the table next grows.
 *
 * # Why one structure for both
 *
 * A Set is a Map that stores no values, and `values` being null is the whole
 * of the difference. Interleaving `{key, value}` pairs would have been better
 * for `entries()` and would have cost a Set sixteen bytes per element for a
 * slot it can never read -- and `has`, which is the most common operation on
 * both, only ever touches keys. Parallel arrays make the Set free and keep the
 * scan dense for the operation that matters.
 *
 * # Why the key kind is a field
 *
 * Keys are stored as `NtsValue`, which is what an erased value already is, so
 * `get` hands back the slot with no conversion: `map.get(k)` is typed `V |
 * undefined`, an absent key reads as `NTS_TAG_UNDEFINED`, and those are the
 * same sixteen bytes. What a uniform table would otherwise cost is a tag
 * dispatch on every probe.
 *
 * It does not, because the *static* key type decides the hash and the
 * comparison once, at construction, and `kind` records which. A
 * `Map<string, V>` compares strings in its probe loop and never looks at a
 * tag. Only a genuinely heterogeneous key type pays for being one.
 */

/* A removed entry.
 *
 * Not `undefined`, because `map.set(undefined, 1)` is legal JavaScript and the
 * hole has to be a value no key can be. This tag is produced nowhere else and
 * leaves the runtime nowhere: `NTS_TAG_IS_MANAGED` is false for it, so the
 * collector walks straight past a hole without being taught about holes. */
#define NTS_TAG_HOLE 0xFFFFFFFFu

#define NTS_MAP_EMPTY 0ull
#define NTS_MAP_DELETED (~0ull)

/* Load factor 1/2, so a probe chain stays short. */
#define NTS_MAP_SLOTS_FOR(entries) ((entries) * 2u)

static bool nts_map_is_hole(NtsValue key) {
  return nts_value_tag(key) == NTS_TAG_HOLE;
}

/* BEGIN GENERATED NATIVE STRING HASH */
/* Generated by compiler/codegen/common/src/string_hash.rs.
 * Regenerate: cargo run -p nts-codegen-common --example string-hash-runtime
 * Hash UTF-16 units; the low 32 bits of a 64-bit avalanche.
 * Narrow and wide strings with the same text are === (nts_string_eq), so
 * they must hash alike. Hashing units, not bytes, guarantees this.
 * Also used for numeric/reference key mixing: keep that contract. */
static uint32_t nts_hash_mix(uint64_t h) {
  h ^= h >> 33;
  h *= 0xff51afd7ed558ccdULL;
  h ^= h >> 33;
  h *= 0xc4ceb9fe1a85ec53ULL;
  h ^= h >> 33;
  return (uint32_t)h;
}

static uint32_t nts_hash_narrow_units(const unsigned char *units,
                                      uint32_t length) {
  uint64_t h = 0xcbf29ce484222325ULL;
  for (uint32_t i = 0; i < length; i++) {
    h ^= (uint64_t)units[i];
    h *= 0x00000100000001b3ULL;
  }
  return nts_hash_mix(h);
}

static uint32_t nts_hash_wide_units(const uint16_t *units, uint32_t length) {
  uint64_t h = 0xcbf29ce484222325ULL;
  for (uint32_t i = 0; i < length; i++) {
    h ^= (uint64_t)units[i];
    h *= 0x00000100000001b3ULL;
  }
  return nts_hash_mix(h);
}
/* END GENERATED NATIVE STRING HASH */

/* Hash code units rather than storage bytes, so narrow and wide equal strings
 * have equal hashes. The generated primitives and literal emission share one
 * algorithm definition in codegen/common. */
static uint32_t nts_hash_units(const NtsString *s) {
  if (s->flags & NTS_TWO_BYTE) {
    return nts_hash_wide_units(NTS_ELEMENTS(s, uint16_t), s->length);
  }
  return nts_hash_narrow_units(NTS_ELEMENTS(s, unsigned char), s->length);
}

/* A string's hash, computed once and kept on the string, which it settles
 * (`NTS_HASHED`): a grown one gives up its room, so no append writes into it.
 *
 * Compiled literals carry a precomputed hash. An older or runtime-created
 * immortal without one is hashed on demand, without writing to storage that
 * may be read-only.
 *
 * Under `NTS_POISON` (`NTS_POISON=1` asks the differential for that build) a
 * kept hash is checked against the text every time it is read. A write that
 * changed a string and left its hash would otherwise show only as a key that
 * is not found -- an answer, not a crash. */
static uint32_t nts_hash_string(const NtsString *s) {
  if ((s->flags & NTS_HASHED) != 0) {
#if defined(NTS_POISON) && NTS_POISON
    if (NTS_STRING_HASH(s) != nts_hash_units(s)) {
      fprintf(stderr, NTS_REFUSED "a string's kept hash is not its text's\n");
      abort();
    }
#endif
    return NTS_STRING_HASH(s);
  }
  uint32_t hash = nts_hash_units(s);
  if (s->reserved != NTS_IMMORTAL) {
    NtsString *kept = (NtsString *)s;
    NTS_STRING_HASH(kept) = hash;
    kept->flags = (kept->flags & ~NTS_GROWN) | NTS_HASHED;
  }
  return hash;
}

/* SameValueZero's two exceptions, both of them here rather than in the
 * comparison: `-0` and `+0` are one key, and every `NaN` is one key. Hashing
 * them together is what lets the comparison stay a plain `==`. */
static uint32_t nts_hash_number(double number) {
  if (number != number) {
    return nts_hash_mix(0x7ff8000000000000ULL);
  }
  if (number == 0.0) {
    number = 0.0;
  }
  uint64_t bits;
  memcpy(&bits, &number, sizeof bits);
  return nts_hash_mix(bits);
}

uint64_t (*nts_objc_key_hash)(const void *object);
bool (*nts_objc_key_equal)(const void *a, const void *b);

/* The CF host installs both hooks from a constructor, before `main`, and only
 * a program built for Apple's platforms links the host or makes a table of
 * this kind. A table made without them is a program this runtime was not
 * built for, which is said, rather than answered with a call through NULL. */
static void nts_objc_keys_required(void) {
  if (!nts_objc_key_hash || !nts_objc_key_equal) {
    fputs("nts: a table of Objective-C objects, in a program with no "
          "Objective-C host to hash and compare them\n",
          stderr);
    abort();
  }
}

/* The object an Objective-C key holds: its family's tag, checked, so a key
 * that arrives boxed -- the promise path still boxes a handle -- aborts saying
 * so rather than hashing the box's header. */
static inline const void *nts_objc_key_object(NtsValue key) {
  return nts_value_handle(key, NTS_TAG_HANDLE_OBJC);
}

static inline __attribute__((always_inline)) uint32_t
nts_hash_key(NtsValue key, uint32_t kind) {
  switch (kind) {
  case NTS_KEY_STRING:
    return nts_hash_string((const NtsString *)nts_value_reference(key));
  case NTS_KEY_NUMBER:
    return nts_hash_number(nts_value_number(key));
  case NTS_KEY_REFERENCE:
    return nts_hash_mix((uint64_t)(uintptr_t)nts_value_reference(key));
  case NTS_KEY_OBJC:
    nts_objc_keys_required();
    return nts_hash_mix(nts_objc_key_hash(nts_objc_key_object(key)));
  default:
    break;
  }
  /* Heterogeneous keys. The tag joins the hash so that the number 3 and the
   * string "3" -- which are different keys -- do not collide by construction.
   */
  switch (nts_value_tag(key)) {
  case NTS_TAG_STRING:
    return nts_hash_string((const NtsString *)nts_value_reference(key)) ^ 3u;
  case NTS_TAG_NUMBER:
    return nts_hash_number(nts_value_number(key)) ^ 2u;
  case NTS_TAG_BIGINT: {
    unsigned __int128 bits = (unsigned __int128)nts_bigint_unbox(
        (const NtsBigIntBox *)nts_value_reference(key));
    return nts_hash_mix((uint64_t)bits) ^
           nts_hash_mix((uint64_t)(bits >> 64u)) ^ NTS_TAG_BIGINT;
  }
  case NTS_TAG_BOOLEAN:
    return nts_hash_mix(nts_value_boolean(key) ? 1u : 0u) ^ 1u;
  case NTS_TAG_UNDEFINED:
    return nts_hash_mix(0x9e3779b97f4a7c15ULL);
  /* A different constant from `undefined`'s, because they are different keys:
   * `new Map([[null, 1], [undefined, 2]])` has size 2. */
  case NTS_TAG_NULL:
    return nts_hash_mix(0xc2b2ae3d27d4eb4fULL);
  default:
    return nts_hash_mix((uint64_t)(uintptr_t)nts_value_reference(key)) ^ 4u;
  }
}

/* SameValueZero. `==` on doubles already answers `+0 === -0` with true, and
 * the only thing it gets wrong for this purpose is NaN, which is unequal to
 * itself and which a Map treats as one key. */
static bool nts_same_value_zero(double a, double b) {
  return a == b || (a != a && b != b);
}

static inline __attribute__((always_inline)) bool
nts_key_eq(NtsValue a, NtsValue b, uint32_t kind) {
  switch (kind) {
  case NTS_KEY_STRING:
    return nts_string_eq((const NtsString *)nts_value_reference(a),
                         (const NtsString *)nts_value_reference(b));
  case NTS_KEY_NUMBER:
    return nts_same_value_zero(nts_value_number(a), nts_value_number(b));
  case NTS_KEY_REFERENCE:
    return nts_value_reference(a) == nts_value_reference(b);
  case NTS_KEY_OBJC: {
    const void *left = nts_objc_key_object(a);
    const void *right = nts_objc_key_object(b);
    /* Identity is equality, even for a class whose `-isEqual:` says an
     * object is not equal to itself: a key must find the entry it made. */
    if (left == right) {
      return true;
    }
    nts_objc_keys_required();
    return nts_objc_key_equal(left, right);
  }
  default:
    break;
  }
  if (nts_value_tag(a) != nts_value_tag(b)) {
    return false;
  }
  switch (nts_value_tag(a)) {
  case NTS_TAG_STRING:
    return nts_string_eq((const NtsString *)nts_value_reference(a),
                         (const NtsString *)nts_value_reference(b));
  case NTS_TAG_NUMBER:
    return nts_same_value_zero(nts_value_number(a), nts_value_number(b));
  case NTS_TAG_BIGINT:
    return nts_bigint_unbox((const NtsBigIntBox *)nts_value_reference(a)) ==
           nts_bigint_unbox((const NtsBigIntBox *)nts_value_reference(b));
  case NTS_TAG_BOOLEAN:
    return nts_value_boolean(a) == nts_value_boolean(b);
  case NTS_TAG_UNDEFINED:
  case NTS_TAG_NULL:
    return true;
  default:
    return nts_value_reference(a) == nts_value_reference(b);
  }
}

/* Cyclic: a map can hold the object that holds it, which is an ordinary cycle
 * and one the collector has to be able to see. The erased count is 1 in the
 * same sense an array's is -- "the elements are `NtsValue`s" -- and where they
 * are is a walk rather than a fixed offset, so `nts_each_reference` has a case
 * for this kind. */
static const NtsDescriptor nts_desc_map = {NTS_KIND_MAP,
                                           (uint32_t)sizeof(NtsMap),
                                           0u,
                                           1u,
                                           0,
                                           0,
                                           "Map",
                                           1u,
                                           0,
                                           NTS_ARRAY_UNKNOWN,
                                           0u,
                                           NULL,
                                           nts_map_to_string,
                                           NULL,
                                           NULL,
                                           NULL};

/* A table: an object used as a dictionary (`Record<string, T>`, an index
 * signature, `Object.create(null)`). The same storage as a `Map` and a
 * different type, and `Object.prototype.toString` is where the difference shows
 * (`hir::ManagedType::Table`): `"[object Object]"` here and `"[object Map]"`
 * there. So it has its own descriptor, which is all a value carries at run
 * time to say which it is. */
static const NtsDescriptor nts_desc_table = {NTS_KIND_MAP,
                                             (uint32_t)sizeof(NtsMap),
                                             0u,
                                             1u,
                                             0,
                                             0,
                                             "Object",
                                             1u,
                                             0,
                                             NTS_ARRAY_UNKNOWN,
                                             0u,
                                             NULL,
                                             nts_object_to_string,
                                             NULL,
                                             NULL,
                                             NULL};

static NtsMap *nts_map_alloc(const NtsDescriptor *descriptor, uint32_t kind,
                             bool holds_values) {
  NtsMap *map = (NtsMap *)nts_alloc(sizeof(NtsMap));
  map->header.descriptor = descriptor;
  map->header.reserved = nts_fresh_count();
  map->header.flags = 0;
  map->header.length = 0;
  nts_note_allocation();
  map->used = 0;
  map->capacity = 0;
  map->slots = 0;
  map->kind = kind;
  map->holds_values = holds_values;
  map->holds = 0;
  map->generation = 0;
  map->index = 0;
  map->keys = 0;
  /* The arrays are allocated on the first insertion rather than here, so that
   * a map nothing is ever put into costs one header. */
  map->values = 0;
  map->hashes = 0;
  return map;
}

/* Dates.
 *
 * A date is a double and a header. Every accessor JavaScript defines is
 * arithmetic on that double, so there is nothing else to store -- and the
 * descriptor says no references, which keeps it out of the cycle collector for
 * the same reason a string is out of it.
 *
 * The whole of the specification's `Date` that this compiler provides is
 * construction from a number and reading the number back. `Date.now()` and
 * `new Date()` are refused at the lowering, because they read a clock this
 * runtime does not have and because no differential could check them: node
 * would answer with its instant and we with ours. */
static const NtsDescriptor nts_desc_date = {NTS_KIND_OBJECT,
                                            (uint32_t)sizeof(NtsDate),
                                            0u,
                                            0u,
                                            0,
                                            0,
                                            "Date",
                                            0u,
                                            0,
                                            NTS_ARRAY_UNKNOWN,
                                            0u,
                                            NULL,
                                            NULL,
                                            NULL,
                                            NULL,
                                            NULL};

/* The specification's `TimeClip`: truncate toward zero, and reject a magnitude
 * beyond 100,000,000 days either side of the epoch.
 *
 * Both halves are observable. `new Date(1.5).getTime()` is 1, and
 * `new Date(8.64e15 + 1).getTime()` is NaN rather than a large number. */
static double nts_time_clip(double ms) {
  if (!(ms >= -8.64e15 && ms <= 8.64e15)) {
    return (double)NAN;
  }
  const double whole = ms < 0 ? -floor(-ms) : floor(ms);
  /* `+0` and not `-0`. The specification routes through
   * `ToIntegerOrInfinity`, which maps `-0` to `+0`, and node agrees:
   * `Object.is(new Date(-0).getTime(), -0)` is false. Truncation alone leaves
   * the sign, and `1 / t` is the only thing that can tell -- which is exactly
   * the sort of difference that never shows until something divides by it. */
  return whole == 0.0 ? 0.0 : whole;
}

NtsDate *nts_date_new(double ms) {
  NtsDate *date = (NtsDate *)nts_alloc(sizeof(NtsDate));
  date->header.descriptor = &nts_desc_date;
  date->header.reserved = nts_fresh_count();
  date->header.flags = 0;
  date->header.length = 0;
  date->ms = nts_time_clip(ms);
  nts_note_allocation();
  return date;
}

double nts_date_value(const NtsDate *date) {
  return date ? date->ms : (double)NAN;
}

/* `ArrayBuffer`.
 *
 * No references, so nothing to trace and no cycle to take part in -- the same
 * shape as a date, over bytes instead of a double. Its own kind so that
 * `nts_free_storage` gives the block back; an object's kind would have leaked
 * every byte, which is precisely the bug `nts_free_storage` exists because of.
 *
 * `size` is the struct alone. The block is counted separately, where it is
 * taken and where it is given back, for the same reason a grown array's is. */
static const NtsDescriptor nts_desc_buffer = {NTS_KIND_BUFFER,
                                              (uint32_t)sizeof(NtsBuffer),
                                              0u,
                                              0u,
                                              0,
                                              0,
                                              "ArrayBuffer",
                                              0u,
                                              0,
                                              NTS_ARRAY_UNKNOWN,
                                              0u,
                                              NULL,
                                              nts_buffer_to_string,
                                              NULL,
                                              NULL,
                                              NULL};

/* A byte count, from a double the lowering has already made legal.
 *
 * `(size_t)value` is undefined for a negative, a NaN, or anything past the
 * type's range, and undefined here is not academic: `new ArrayBuffer(-0.5)` is
 * a legal empty buffer in the language, and casting it directly asked for
 * 9,223,372,036,854,775,808 bytes and aborted. The lowering guards what the
 * language *refuses* -- `-1.5` is a `RangeError` -- and what is left for this
 * to do is make the conversion of everything it allows defined.
 *
 * `!(value >= 1.0)` rather than `value < 1.0` so that NaN takes the zero
 * branch instead of falling through it. */
double nts_to_index(double value) {
  /* `!(value >= 1.0)` rather than `value < 1.0` so that NaN takes the zero
     branch instead of falling through it. Everything in `(-1, 1)` is zero
     after truncation, including `-0.5` and `-0.0`. */
  if (!(value >= 1.0)) {
    return 0.0;
  }
  return trunc(value);
}

static size_t nts_buffer_index(double value) {
  /* One rule, one place: the size and the comparison must agree about what a
     length *is*, and they disagreed once already. */
  return (size_t)nts_to_index(value);
}

/* One place, so the two constructors cannot disagree about what a buffer is.
 *
 * `reserved` is what the block holds and `length` is what the buffer says it
 * has; they differ only for a resizable buffer that has not been grown to its
 * maximum. Zeroed, because a fresh `ArrayBuffer` reads as zeroes and a caller
 * must never see what the allocator last put there. */
static NtsBuffer *nts_buffer_make(size_t length, size_t reserved,
                                  bool resizable) {
  /* The bytes first, so that a failure has nothing to undo. Allocating the
     struct first and bailing out afterwards leaks it and leaves `bytes_held`
     counting a buffer nobody can reach -- and `nts_live_bytes` reporting a
     program that failed cleanly as one that leaked.

     One byte for an empty buffer, so that the bytes pointer is null if and
     only if the buffer is detached. A zero-length `calloc` may return null,
     and a `new ArrayBuffer(0)` that reported itself detached would be wrong
     about the one state every accessor branches on. */
  unsigned char *bytes =
      (unsigned char *)nts_side_zeroed(reserved ? reserved : 1u);
  if (!bytes) {
    /* Null rather than abort, because node answers this with a `RangeError`
       and the lowering turns the null into one. A length the *language*
       refuses never arrives here; this is a length the language allows and
       the machine does not, which node reports as "Array buffer allocation
       failed" -- a different sentence from "Invalid array buffer length", on
       purpose. */
    return 0;
  }
  NtsBuffer *buffer = (NtsBuffer *)nts_alloc(sizeof(NtsBuffer));
  buffer->header.descriptor = &nts_desc_buffer;
  buffer->header.reserved = nts_fresh_count();
  buffer->header.flags = 0;
  buffer->header.length = 0;
  buffer->length = length;
  buffer->reserved_bytes = reserved;
  buffer->resizable = resizable;
  buffer->bytes = bytes;
  nts_env->bytes_held += reserved;
  nts_note_allocation();
  /* The block, counted the way a grown array's is: taken here, given back in
   * `nts_free_storage`. */
  nts_note_allocation();
  return buffer;
}

NtsBuffer *nts_buffer_new(double byte_length) {
  size_t length = nts_buffer_index(byte_length);
  return nts_buffer_make(length, length, false);
}

NtsBuffer *nts_buffer_new_resizable(double byte_length,
                                    double max_byte_length) {
  /* The maximum is reserved now. See the note on `NtsBuffer`: it is what makes
   * the block's address stable, so a view never re-reads where the bytes are
   * and `resize` is an assignment. */
  return nts_buffer_make(nts_buffer_index(byte_length),
                         nts_buffer_index(max_byte_length), true);
}

double nts_buffer_byte_length(const NtsBuffer *buffer) {
  if (!buffer || !buffer->bytes) {
    return 0;
  }
  return (double)buffer->length;
}

double nts_buffer_max_byte_length(const NtsBuffer *buffer) {
  if (!buffer || !buffer->bytes) {
    return 0;
  }
  /* A fixed buffer answers with its own length, which is what the
   * specification says rather than a convenience: `maxByteLength` on a
   * non-resizable buffer is its `byteLength`. */
  return (double)buffer->reserved_bytes;
}

bool nts_buffer_resizable(const NtsBuffer *buffer) {
  return buffer && buffer->bytes && buffer->resizable;
}

bool nts_buffer_detached(const NtsBuffer *buffer) {
  return !buffer || !buffer->bytes;
}

NtsBuffer *nts_buffer_slice(const NtsBuffer *buffer, double from, double to) {
  /* `nts_str_clamp` is what every relative-index endpoint in this file uses,
     and a buffer's are the same rule: negative counts from the end. */
  uint32_t length = (uint32_t)nts_buffer_byte_length(buffer);
  uint32_t start = nts_str_clamp(from, length, 1);
  uint32_t end = nts_str_clamp(to, length, 1);
  size_t count = end > start ? (size_t)(end - start) : 0u;
  NtsBuffer *slice = nts_buffer_make(count, count, false);
  if (slice && count && buffer && buffer->bytes) {
    memcpy(slice->bytes, buffer->bytes + (size_t)start, count);
  }
  return slice;
}

void nts_buffer_resize(NtsBuffer *buffer, double byte_length) {
  if (!buffer || !buffer->bytes) {
    return;
  }
  size_t length = nts_buffer_index(byte_length);
  /* Growth exposes bytes nobody wrote, and the specification says they are
   * zero. They were zero when the block was reserved, but a previous `resize`
   * down and up again would otherwise show what the shrunk region held. */
  if (length > buffer->length) {
    memset(buffer->bytes + buffer->length, 0, length - buffer->length);
  }
  buffer->length = length;
}

/* `DataView`.
 *
 * One reference -- the buffer -- so unlike `ArrayBuffer` this has an offset
 * table and takes part in reference counting. Not cyclic: a buffer holds no
 * references at all, so a view can never lead back to itself.
 *
 * `NTS_KIND_OBJECT` rather than a kind of its own, because a view owns no
 * separate block: the bytes belong to the buffer, and freeing a view frees the
 * struct and releases its reference. That is exactly what an object does. */
static const uint32_t nts_dataview_offsets[] = {
    (uint32_t)offsetof(NtsDataView, buffer),
};

static const NtsDescriptor nts_desc_dataview = {NTS_KIND_OBJECT,
                                                (uint32_t)sizeof(NtsDataView),
                                                1u,
                                                0u,
                                                nts_dataview_offsets,
                                                0,
                                                "DataView",
                                                0u,
                                                0,
                                                NTS_ARRAY_UNKNOWN,
                                                0u,
                                                NULL,
                                                nts_dataview_to_string,
                                                NULL,
                                                NULL,
                                                NULL};

static NtsDataView *nts_dataview_make(NtsBuffer *buffer, double byte_offset,
                                      double byte_length, bool tracks) {
  NtsDataView *view = (NtsDataView *)nts_object_new(&nts_desc_dataview);
  if (!view) {
    return 0;
  }
  view->buffer = buffer;
  nts_retain((NtsHeader *)buffer);
  view->offset = nts_buffer_index(byte_offset);
  view->length = tracks ? 0u : nts_buffer_index(byte_length);
  view->tracks = tracks;
  return view;
}

NtsDataView *nts_dataview_over(NtsBuffer *buffer, double byte_offset) {
  return nts_dataview_make(buffer, byte_offset, 0.0, true);
}

NtsDataView *nts_dataview_part(NtsBuffer *buffer, double byte_offset,
                               double byte_length) {
  return nts_dataview_make(buffer, byte_offset, byte_length, false);
}

NtsBuffer *nts_dataview_buffer(const NtsDataView *view) {
  nts_retain((NtsHeader *)view->buffer);
  return view->buffer;
}

double nts_dataview_byte_offset(const NtsDataView *view) {
  return (double)view->offset;
}

/* Computed rather than stored.
 *
 * A tracking view over a buffer that has shrunk is shorter than it was, and a
 * view over a detached one is empty -- a stored length would be right until the
 * first `resize` and wrong afterwards, which a program without resizable
 * buffers never reaches. */
double nts_dataview_byte_length(const NtsDataView *view) {
  const NtsBuffer *buffer = view->buffer;
  if (!buffer->bytes) {
    return 0.0;
  }
  if (!view->tracks) {
    /* **A fixed-length `DataView` can go out of bounds too, and node does not
       answer 0 for one -- it throws.** Measured rather than assumed: over a
       buffer shrunk below the view's extent, `dv.byteLength` is a `TypeError`
       where the typed-array equivalent is `0`. The two rules differ and the
       stored length was wrong for both.

       This runtime has no throw that reaches a handler in the compiled program
       -- a `throw` lowers to a jump inside one function -- so the honest answer
       is to decline rather than to invent a number. Returning 0 would still
       disagree with node and would do it silently; this shows up as a declined
       case, which is what "we do not implement this" looks like. */
    if (view->offset + view->length > buffer->length) {
      fprintf(stderr,
              NTS_REFUSED "byteLength of a fixed-length DataView whose buffer "
                          "has shrunk below it -- node throws a TypeError "
                          "here, and this runtime has no throw that reaches a "
                          "handler\n");
      abort();
    }
    return (double)view->length;
  }
  if (view->offset >= buffer->length) {
    return 0.0;
  }
  return (double)(buffer->length - view->offset);
}

/* One access, at an offset the lowering has already bounds-checked.
 *
 * Null for a detached buffer rather than a fault: the lowering checks the
 * *length*, which is zero once detached, so an access to a detached view is a
 * `RangeError` before it arrives here. This is the second answer to the same
 * question and it is here because the first one being wrong should not be
 * undefined behaviour. */
static unsigned char *nts_dataview_at(const NtsDataView *view, double at) {
  const NtsBuffer *buffer = view->buffer;
  if (!buffer->bytes) {
    return 0;
  }
  return buffer->bytes + view->offset + nts_buffer_index(at);
}

/* Assembled a byte at a time rather than by casting a pointer.
 *
 * A `DataView` access is legal at any offset -- `getFloat64(1)` is an ordinary
 * read in the language -- and a cast to `double *` at an odd address is
 * undefined in C and a fault on some machines. Byte assembly is correct at
 * every alignment and is what makes the unaligned case not a special case. */
static uint64_t nts_dataview_read(const unsigned char *from, unsigned width,
                                  bool little_endian) {
  uint64_t value = 0;
  unsigned i;
  for (i = 0; i < width; i++) {
    unsigned shift = little_endian ? i : (width - 1u - i);
    value |= (uint64_t)from[i] << (shift * 8u);
  }
  return value;
}

static void nts_dataview_write(unsigned char *into, unsigned width,
                               uint64_t value, bool little_endian) {
  unsigned i;
  for (i = 0; i < width; i++) {
    unsigned shift = little_endian ? i : (width - 1u - i);
    into[i] = (unsigned char)((value >> (shift * 8u)) & 0xffu);
  }
}

/* The one-byte pair, spelled out rather than macro-generated, because their
 * signatures differ: no byte order for a single byte. */
#define NTS_DATAVIEW_GET1(NAME, TYPE)                                          \
  double nts_dataview_get_##NAME(const NtsDataView *view, double at) {         \
    const unsigned char *from = nts_dataview_at(view, at);                     \
    return from ? (double)(TYPE) * from : 0.0;                                 \
  }

#define NTS_DATAVIEW_SET1(NAME)                                                \
  void nts_dataview_set_##NAME(NtsDataView *view, double at, double value) {   \
    unsigned char *into = nts_dataview_at(view, at);                           \
    if (into) {                                                                \
      *into = (unsigned char)nts_to_int32(value);                              \
    }                                                                          \
  }

NTS_DATAVIEW_GET1(int8, int8_t)
NTS_DATAVIEW_GET1(uint8, uint8_t)
NTS_DATAVIEW_SET1(int8)
NTS_DATAVIEW_SET1(uint8)

#define NTS_DATAVIEW_GET(NAME, WIDTH, TYPE)                                    \
  double nts_dataview_get_##NAME(const NtsDataView *view, double at,           \
                                 bool little_endian) {                         \
    const unsigned char *from = nts_dataview_at(view, at);                     \
    if (!from) {                                                               \
      return 0.0;                                                              \
    }                                                                          \
    return (double)(TYPE)nts_dataview_read(from, WIDTH, little_endian);        \
  }

NTS_DATAVIEW_GET(int16, 2u, int16_t)
NTS_DATAVIEW_GET(uint16, 2u, uint16_t)
NTS_DATAVIEW_GET(int32, 4u, int32_t)
NTS_DATAVIEW_GET(uint32, 4u, uint32_t)

/* The floats are not casts. The bits *are* the value, so they are copied
 * through `memcpy` -- type punning through a union or a pointer cast is
 * undefined, and a NaN read out of four bytes has a payload that a conversion
 * would canonicalise away. */
double nts_dataview_get_float32(const NtsDataView *view, double at,
                                bool little_endian) {
  const unsigned char *from = nts_dataview_at(view, at);
  float value;
  uint32_t bits;
  if (!from) {
    return 0.0;
  }
  bits = (uint32_t)nts_dataview_read(from, 4u, little_endian);
  memcpy(&value, &bits, sizeof value);
  return (double)value;
}

double nts_dataview_get_float64(const NtsDataView *view, double at,
                                bool little_endian) {
  const unsigned char *from = nts_dataview_at(view, at);
  double value;
  uint64_t bits;
  if (!from) {
    return 0.0;
  }
  bits = nts_dataview_read(from, 8u, little_endian);
  memcpy(&value, &bits, sizeof value);
  return value;
}

#define NTS_DATAVIEW_SET(NAME, WIDTH)                                          \
  void nts_dataview_set_##NAME(NtsDataView *view, double at, double value,     \
                               bool little_endian) {                           \
    unsigned char *into = nts_dataview_at(view, at);                           \
    if (!into) {                                                               \
      return;                                                                  \
    }                                                                          \
    nts_dataview_write(into, WIDTH, (uint64_t)(uint32_t)nts_to_int32(value),   \
                       little_endian);                                         \
  }

NTS_DATAVIEW_SET(int16, 2u)
NTS_DATAVIEW_SET(uint16, 2u)
NTS_DATAVIEW_SET(int32, 4u)
NTS_DATAVIEW_SET(uint32, 4u)

void nts_dataview_set_float32(NtsDataView *view, double at, double value,
                              bool little_endian) {
  unsigned char *into = nts_dataview_at(view, at);
  float narrowed = (float)value;
  uint32_t bits;
  if (!into) {
    return;
  }
  memcpy(&bits, &narrowed, sizeof bits);
  nts_dataview_write(into, 4u, bits, little_endian);
}

void nts_dataview_set_float64(NtsDataView *view, double at, double value,
                              bool little_endian) {
  unsigned char *into = nts_dataview_at(view, at);
  uint64_t bits;
  if (!into) {
    return;
  }
  memcpy(&bits, &value, sizeof bits);
  nts_dataview_write(into, 8u, bits, little_endian);
}

__int128 nts_dataview_get_bigint64(const NtsDataView *view, double at,
                                   bool little_endian) {
  const unsigned char *from = nts_dataview_at(view, at);
  if (!from) {
    return 0;
  }
  /* Through `int64_t` so the sign extends into the high half; the unsigned
     read below goes through `uint64_t` so it does not. That cast is the whole
     of the difference between the two accessors. */
  return (__int128)(int64_t)nts_dataview_read(from, 8u, little_endian);
}

__int128 nts_dataview_get_biguint64(const NtsDataView *view, double at,
                                    bool little_endian) {
  const unsigned char *from = nts_dataview_at(view, at);
  if (!from) {
    return 0;
  }
  return (__int128)(unsigned __int128)nts_dataview_read(from, 8u,
                                                        little_endian);
}

void nts_dataview_set_bigint64(NtsDataView *view, double at, __int128 value,
                               bool little_endian) {
  unsigned char *into = nts_dataview_at(view, at);
  if (into) {
    /* The low 64 bits, which is `BigInt.asIntN(64, v)` for the signed view and
       `asUintN` for the unsigned one -- the same bits either way. */
    nts_dataview_write(into, 8u, (uint64_t)value, little_endian);
  }
}

void nts_dataview_set_biguint64(NtsDataView *view, double at, __int128 value,
                                bool little_endian) {
  unsigned char *into = nts_dataview_at(view, at);
  if (into) {
    nts_dataview_write(into, 8u, (uint64_t)value, little_endian);
  }
}

NtsBuffer *nts_buffer_transfer(NtsBuffer *buffer, double byte_length,
                               bool fixed) {
  size_t length = nts_buffer_index(byte_length);
  /* The old maximum carries over only from a resizable buffer to a resizable
   * one. A fixed buffer's reserved bytes are its length, and `transfer(n)` of
   * one is a fixed buffer of n bytes: reserving the old length there gave a
   * buffer reporting n bytes over a smaller block. */
  const bool resizable = !fixed && buffer && buffer->resizable;
  /* Past the maximum a resizable buffer keeps: null, which the caller raises
   * as the `RangeError` the language gives. */
  if (resizable && length > buffer->reserved_bytes) {
    return 0;
  }
  NtsBuffer *moved = nts_buffer_make(
      length, resizable ? buffer->reserved_bytes : length, resizable);
  if (moved && buffer && buffer->bytes) {
    size_t carried = buffer->length < length ? buffer->length : length;
    memcpy(moved->bytes, buffer->bytes, carried);
    /* Detached, which is the observable point of a transfer. The block goes
     * back now rather than at death: a transferred buffer may be held for a
     * long time by something that only ever asks whether it is detached. */
    nts_env->bytes_held -= buffer->reserved_bytes;
    nts_env->reclaimed++;
    nts_side_free(buffer->bytes, "a buffer's bytes");
    buffer->bytes = 0;
    buffer->length = 0;
    buffer->reserved_bytes = 0;
    buffer->resizable = false;
  }
  return moved;
}

/* Typed-array views.
 *
 * A view holds its *buffer* rather than a raw pointer, and reads the bytes
 * through it on every access. That costs one load and buys the two things a
 * raw pointer cannot have: detachment is observable, because `transfer` frees
 * the block and leaves null; and a tracking view follows `resize`, because the
 * length is computed from the buffer it can still see.
 *
 * One reference each way is enough. The view owns the buffer; the buffer knows
 * nothing about its views, which is why a buffer can be viewed at several
 * widths at once without keeping a list. */
static const NtsDescriptor nts_desc_view = {
    NTS_KIND_OBJECT, (uint32_t)sizeof(NtsView), 1u, 1u,
    /* One reference, at offset zero: the buffer. Cyclic because a view is an
       ordinary managed object and a program may put one in a cycle. */
    (const uint32_t[]){(uint32_t)offsetof(NtsView, buffer)}, 0, "TypedArray",
    0u, 0, NTS_ARRAY_UNKNOWN, 0u, NULL, nts_view_to_string, NULL, NULL, NULL};

/* Beside the descriptor it compares against, rather than with the other
 * `nts_is_*` helpers: a file-scope `static const` has no forward declaration
 * here, so the test has to sit below the thing it tests for. */
/* `ArrayBuffer.isView(x)`.
 *
 * True for every typed array *and* for a `DataView`, which is the one place
 * those two are one answer -- `instanceof` separates them and this does not.
 * So it is two descriptor comparisons rather than a kind test: `nts_desc_view`
 * covers the nine typed arrays, which share a struct and differ in how their
 * bytes are read, and `nts_desc_dataview` is the tenth thing the predicate is
 * true of.
 *
 * Not `nts_is_view_kind` with a wildcard, because there is no kind that means
 * "any" and inventing one would put a value in the `kind` field that no view
 * has. */
bool nts_value_is_view(NtsValue value) {
  if (!NTS_TAG_IS_MANAGED(nts_value_tag(value))) {
    return false;
  }
  const NtsHeader *object = nts_value_reference(value);
  if (object == NULL) {
    return false;
  }
  return object->descriptor == &nts_desc_view ||
         object->descriptor == &nts_desc_dataview;
}

/* `value instanceof DataView`.
 *
 * A `DataView` is not a class here for the reason a typed array is not: it has
 * one struct and one descriptor, so there is no per-class layout for the class
 * search to find, and the runtime answers it instead. Unlike a view it needs no
 * kind beside the descriptor -- there is only one `DataView`. */
/* `value instanceof Date`.
 *
 * The same descriptor comparison, and a `Date` is a class here no more than a
 * `DataView` is: one struct, one descriptor, and its whole contents are the
 * time value the specification names. */
/* `value instanceof Map` and `instanceof Set`.
 *
 * One struct serves both -- a Set is a Map that holds no values -- so the
 * descriptor alone cannot tell them apart and `holds_values` is the whole of
 * the difference. Written as one predicate and its negation rather than two
 * independent tests, because two could drift into both answering true, which is
 * a wrong answer rather than a refusal.
 *
 * The JVM lane's `NtsMap` had exactly that bug until tonight: `newMap` and
 * `newSet` both returned a bare `NtsMap` and dropped the kind they were handed,
 * so a Set was a Map and nothing had ever asked which. */
static bool nts_is_map_like(NtsValue value, bool holds_values) {
  if (!NTS_TAG_IS_MANAGED(nts_value_tag(value))) {
    return false;
  }
  const NtsHeader *object = nts_value_reference(value);
  /* The map's own descriptor and not the kind: a table (`nts_desc_table`)
   * shares a map's storage and kind and is not one, so `Object.create(null)
   * instanceof Map` is false. */
  if (!object || object->descriptor != &nts_desc_map) {
    return false;
  }
  return ((const NtsMap *)object)->holds_values == holds_values;
}

bool nts_is_map(NtsValue value) { return nts_is_map_like(value, true); }

bool nts_is_set(NtsValue value) { return nts_is_map_like(value, false); }

bool nts_is_date(NtsValue value) {
  if (!NTS_TAG_IS_MANAGED(nts_value_tag(value))) {
    return false;
  }
  const NtsHeader *object = nts_value_reference(value);
  return object && object->descriptor == &nts_desc_date;
}

bool nts_is_data_view(NtsValue value) {
  if (!NTS_TAG_IS_MANAGED(nts_value_tag(value))) {
    return false;
  }
  const NtsHeader *object = nts_value_reference(value);
  return object && object->descriptor == &nts_desc_dataview;
}

bool nts_is_view_kind(NtsValue value, double kind) {
  if (!NTS_TAG_IS_MANAGED(nts_value_tag(value))) {
    return false;
  }
  const NtsHeader *object = nts_value_reference(value);
  if (!object || object->descriptor != &nts_desc_view) {
    return false;
  }
  return ((const NtsView *)object)->kind == (uint8_t)kind;
}

/* Bytes per element, from the kind. One place, so a width and a kind cannot
 * disagree about the same view. */
static uint8_t nts_element_width(uint8_t kind) {
  switch (kind) {
  case NTS_ELEMENT_I8:
  case NTS_ELEMENT_U8:
  case NTS_ELEMENT_U8_CLAMPED:
    return 1u;
  case NTS_ELEMENT_I16:
  case NTS_ELEMENT_U16:
    return 2u;
  case NTS_ELEMENT_I32:
  case NTS_ELEMENT_U32:
  case NTS_ELEMENT_F32:
    return 4u;
  default:
    return 8u;
  }
}

NtsView *nts_view_new(NtsBuffer *buffer, double byte_offset, double length,
                      double kind, bool tracking) {
  NtsView *view = (NtsView *)nts_alloc(sizeof(NtsView));
  view->header.descriptor = &nts_desc_view;
  view->header.reserved = nts_fresh_count();
  view->header.flags = 0;
  view->header.length = 0;
  view->buffer = buffer;
  nts_retain((NtsHeader *)buffer);
  view->byte_offset = nts_buffer_index(byte_offset);
  view->length_ = nts_buffer_index(length);
  view->kind = (uint8_t)nts_buffer_index(kind);
  view->width = nts_element_width(view->kind);
  view->tracking = tracking;
  nts_note_allocation();
  return view;
}

double nts_view_get(const NtsView *view, double index) {
  const unsigned char *bytes = nts_view_bytes(view);
  if (!bytes || !(index >= 0) || index >= nts_view_length(view)) {
    /* Out of range is `undefined` in the language, which a `double` cannot
       carry -- the lowering answers that where it has an absence to put it.
       NaN here is the arithmetic identity of "no element", and every caller
       inside this file has already bounded its index. */
    return (double)NAN;
  }
  const unsigned char *at = bytes + (size_t)index * view->width;
  switch (view->kind) {
  case NTS_ELEMENT_I8: {
    int8_t value;
    memcpy(&value, at, 1);
    return value;
  }
  case NTS_ELEMENT_U8:
  case NTS_ELEMENT_U8_CLAMPED:
    return *at;
  case NTS_ELEMENT_I16: {
    int16_t value;
    memcpy(&value, at, 2);
    return value;
  }
  case NTS_ELEMENT_U16: {
    uint16_t value;
    memcpy(&value, at, 2);
    return value;
  }
  case NTS_ELEMENT_I32: {
    int32_t value;
    memcpy(&value, at, 4);
    return value;
  }
  case NTS_ELEMENT_U32: {
    uint32_t value;
    memcpy(&value, at, 4);
    return value;
  }
  case NTS_ELEMENT_F32: {
    float value;
    memcpy(&value, at, 4);
    return value;
  }
  default: {
    double value;
    memcpy(&value, at, 8);
    return value;
  }
  }
}

void nts_view_put(NtsView *view, double index, double value) {
  unsigned char *bytes = nts_view_bytes(view);
  if (!bytes || !(index >= 0) || index >= nts_view_length(view)) {
    return;
  }
  unsigned char *at = bytes + (size_t)index * view->width;
  switch (view->kind) {
  case NTS_ELEMENT_I8: {
    int8_t narrowed = nts_to_int8(value);
    memcpy(at, &narrowed, 1);
    return;
  }
  case NTS_ELEMENT_U8: {
    uint8_t narrowed = nts_to_uint8(value);
    memcpy(at, &narrowed, 1);
    return;
  }
  case NTS_ELEMENT_U8_CLAMPED: {
    /* Clamping, and the rounding is half-to-even rather than half-up: 0.5 is
       0 and 1.5 is 2. `Math.round` agrees with this on every input except the
       exact halves, which is why a pool without halves in it cannot tell the
       two rules apart. */
    uint8_t narrowed;
    if (!(value > 0)) {
      narrowed = 0u; /* NaN and everything at or below zero. */
    } else if (value >= 255.0) {
      narrowed = 255u;
    } else {
      /* Written out rather than `nearbyint`, which rounds by the *current*
         floating-point mode -- correct today and silently wrong for anyone
         who changes it. The rule is fixed by the language, so it is spelled
         here. */
      double below = floor(value);
      double fraction = value - below;
      double whole;
      if (fraction < 0.5) {
        whole = below;
      } else if (fraction > 0.5) {
        whole = below + 1.0;
      } else {
        whole = fmod(below, 2.0) == 0.0 ? below : below + 1.0;
      }
      narrowed = (uint8_t)whole;
    }
    memcpy(at, &narrowed, 1);
    return;
  }
  case NTS_ELEMENT_I16: {
    int16_t narrowed = nts_to_int16(value);
    memcpy(at, &narrowed, 2);
    return;
  }
  case NTS_ELEMENT_U16: {
    uint16_t narrowed = nts_to_uint16(value);
    memcpy(at, &narrowed, 2);
    return;
  }
  case NTS_ELEMENT_I32: {
    int32_t narrowed = nts_to_int32(value);
    memcpy(at, &narrowed, 4);
    return;
  }
  case NTS_ELEMENT_U32: {
    uint32_t narrowed = nts_to_uint32(value);
    memcpy(at, &narrowed, 4);
    return;
  }
  case NTS_ELEMENT_F32: {
    float narrowed = (float)value;
    memcpy(at, &narrowed, 4);
    return;
  }
  default:
    memcpy(at, &value, 8);
    return;
  }
}

double nts_view_length(const NtsView *view) {
  if (!view || !view->buffer || !view->buffer->bytes) {
    return 0;
  }
  if (!view->tracking) {
    /* **A fixed-length view can go out of bounds, and an out-of-bounds view has
       length 0.** The stored length is what the view was cut to; whether it can
       still be read is a question about the buffer *now*.

       `new Uint8Array(buffer, 2, 2)` over a buffer shrunk to 3 bytes needs 4
       and has 3, so node answers 0 for its length and `undefined` for every
       element. Returning the stored length instead is the same failure the
       tracking branch below was written to avoid, on the other side of this
       `if`: right until the first resize and silently wrong afterwards.

       It is a **test, not a latch**. Grow the buffer back and the view is in
       bounds again -- measured in node, `cut.length` going 2, 0, 2 across
       `resize(0)` and `resize(8)` -- so this is computed on every read rather
       than recorded when the buffer shrinks. */
    size_t extent = view->byte_offset + view->length_ * (size_t)view->width;
    if (extent > view->buffer->length) {
      return 0;
    }
    return (double)view->length_;
  }
  /* Computed, so a view built without a length follows its buffer through
     `resize`. A stored length is right until the first resize and silently
     wrong afterwards, which is the failure a corpus finds twelve lines of. */
  size_t bytes = view->buffer->length;
  if (bytes <= view->byte_offset) {
    return 0;
  }
  return (double)((bytes - view->byte_offset) / view->width);
}

double nts_view_byte_length(const NtsView *view) {
  return nts_view_length(view) * (view ? (double)view->width : 0.0);
}

double nts_view_byte_offset(const NtsView *view) {
  /* Zero once detached, the way a detached buffer reports zero length: the
     specification answers rather than throwing, and `detached` is the question
     with the answer. */
  if (!view || !view->buffer || !view->buffer->bytes) {
    return 0;
  }
  return (double)view->byte_offset;
}

NtsBuffer *nts_view_buffer(const NtsView *view) {
  if (!view) {
    return 0;
  }
  nts_retain((NtsHeader *)view->buffer);
  return view->buffer;
}

unsigned char *nts_view_bytes(const NtsView *view) {
  if (!view || !view->buffer || !view->buffer->bytes) {
    return 0;
  }
  return view->buffer->bytes + view->byte_offset;
}

NtsView *nts_view_subarray(const NtsView *view, double from, double to) {
  uint32_t length = (uint32_t)nts_view_length(view);
  uint32_t start = nts_str_clamp(from, length, 1);
  uint32_t end = nts_str_clamp(to, length, 1);
  uint32_t count = end > start ? end - start : 0u;
  /* The same buffer, offset further in. No copy, and no tracking: a subarray
     has the length it was cut to, which is why `new Uint8Array(buffer)` and
     `view.subarray(0)` behave differently on a later `resize`. */
  /* The KIND, not the width. `nts_view_new` derives the width from the kind
     and the two agree only for a one-byte element, so passing the width made a
     `Uint16Array`'s subarray claim to be a `Uint8ClampedArray`.

     Narrower than it looks, which is why it hid: indexed access is emitted
     from the *HIR* element type, so `window[0]` still reads two bytes at the
     right offset. What the runtime kind decides is `byteLength`, and the
     element conversions `set` and `copyWithin` go through -- so a wrong kind
     is a wrong byte length and a wrong cross-width `set`, and every read looks
     fine. It survived because the only subarray anything took was of a
     `Uint8Array`, where 1 and 1 are the same number. */
  return nts_view_new(view->buffer,
                      (double)(view->byte_offset + (size_t)start * view->width),
                      (double)count, (double)view->kind, false);
}

NtsView *nts_view_slice(const NtsView *view, double from, double to) {
  uint32_t length = (uint32_t)nts_view_length(view);
  uint32_t start = nts_str_clamp(from, length, 1);
  uint32_t end = nts_str_clamp(to, length, 1);
  uint32_t count = end > start ? end - start : 0u;
  size_t bytes = (size_t)count * view->width;
  NtsBuffer *copy = nts_buffer_new((double)bytes);
  if (!copy) {
    return 0;
  }
  const unsigned char *source = nts_view_bytes(view);
  if (source && bytes) {
    memcpy(copy->bytes, source + (size_t)start * view->width, bytes);
  }
  NtsView *out =
      nts_view_new(copy, 0.0, (double)count, (double)view->kind, false);
  /* `nts_view_new` retained it, and this function is the only other owner. */
  nts_release((NtsHeader *)copy);
  return out;
}

NtsView *nts_view_from_bytes(const void *bytes, double length) {
  size_t count = (size_t)nts_buffer_index(length);
  if (bytes == NULL && count != 0) {
    fprintf(stderr,
            "nts: bytesFrom was given NULL and a length of %zu; "
            "a length with no bytes behind it is not an empty array\n",
            count);
    abort();
  }
  NtsBuffer *copy = nts_buffer_new((double)count);
  if (!copy) {
    return 0;
  }
  if (count) {
    memcpy(copy->bytes, bytes, count);
  }
  NtsView *out =
      nts_view_new(copy, 0.0, (double)count, (double)NTS_ELEMENT_U8, false);
  /* `nts_view_new` retained it, and this function is the only other owner. */
  nts_release((NtsHeader *)copy);
  return out;
}

NtsView *nts_view_from_elements(const void *elements, double count,
                                double kind) {
  size_t length = (size_t)nts_buffer_index(count);
  uint8_t element = (uint8_t)nts_buffer_index(kind);
  size_t bytes = length * nts_element_width(element);
  if (elements == NULL && length != 0) {
    fprintf(stderr,
            "nts: %zu elements were handed back at NULL; a count with no "
            "elements behind it is not an empty array\n",
            length);
    abort();
  }
  NtsBuffer *copy = nts_buffer_new((double)bytes);
  if (!copy) {
    return 0;
  }
  if (bytes) {
    memcpy(copy->bytes, elements, bytes);
  }
  NtsView *out = nts_view_new(copy, 0.0, (double)length, kind, false);
  /* `nts_view_new` retained it, and this function is the only other owner. */
  nts_release((NtsHeader *)copy);
  return out;
}

void nts_view_copy_within(NtsView *view, double target, double from,
                          double to) {
  unsigned char *bytes = nts_view_bytes(view);
  if (!bytes) {
    return;
  }
  uint32_t length = (uint32_t)nts_view_length(view);
  uint32_t at = nts_str_clamp(target, length, 1);
  uint32_t start = nts_str_clamp(from, length, 1);
  uint32_t end = nts_str_clamp(to, length, 1);
  uint32_t count = end > start ? end - start : 0u;
  if (count > length - at) {
    count = length - at;
  }
  /* `memmove`, not a loop. `copyWithin(2, 0, 5)` reads bytes it has already
     written, and a forward loop is right on every non-overlapping range --
     which is every range a test contains unless someone wrote the overlapping
     one down. */
  memmove(bytes + (size_t)at * view->width, bytes + (size_t)start * view->width,
          (size_t)count * view->width);
}

double nts_value_number_or(NtsValue value, double fallback) {
  switch (nts_value_tag(value)) {
  case NTS_TAG_UNDEFINED:
  case NTS_TAG_NULL:
    return fallback;
  case NTS_TAG_NUMBER:
    return nts_value_number(value);
  case NTS_TAG_BOOLEAN:
    return nts_value_boolean(value) ? 1.0 : 0.0;
  default:
    return (double)NAN;
  }
}

void nts_view_fill(NtsView *view, double value, double from, double to) {
  if (!nts_view_bytes(view)) {
    return;
  }
  uint32_t length = (uint32_t)nts_view_length(view);
  uint32_t start = nts_str_clamp(from, length, 1);
  uint32_t end = nts_str_clamp(to, length, 1);
  for (uint32_t at = start; at < end; at++) {
    nts_view_put(view, (double)at, value);
  }
}

void nts_view_set(NtsView *view, const NtsView *source, double offset) {
  unsigned char *bytes = nts_view_bytes(view);
  const unsigned char *from = nts_view_bytes(source);
  if (!bytes || !from) {
    return;
  }
  size_t at = nts_buffer_index(offset);
  size_t count = (size_t)nts_view_length(source);
  size_t room = (size_t)nts_view_length(view);
  if (at >= room) {
    return;
  }
  if (count > room - at) {
    count = room - at;
  }
  if (view->kind == source->kind) {
    /* The same kind is byte-identical, so this is a move -- and `memmove`
       rather than `memcpy` for the reason `copyWithin` needs it: two views of
       one kind over one buffer can overlap. */
    memmove(bytes + at * view->width, from, count * source->width);
    return;
  }
  /* Different kinds convert *values*: `u16.set(u8Of([9, 10]))` writes the
     numbers 9 and 10 as sixteen-bit elements, and `f32.set(i32Of([3, 4]))`
     writes 3.0 and 4.0 rather than reinterpreting four bytes. A byte copy is
     right only when the kinds are identical, and wrong invisibly when the
     widths happen to match.

     Over one buffer the source has to be snapshotted, because a wider
     destination overwrites elements the loop has not read yet -- the case a
     same-width test cannot construct at all. */
  const NtsView *reading = source;
  NtsView *snapshot = 0;
  if (view->buffer == source->buffer) {
    snapshot = nts_view_slice(source, 0.0, (double)count);
    if (!snapshot) {
      return;
    }
    reading = snapshot;
  }
  for (size_t index = 0; index < count; index++) {
    nts_view_put(view, (double)(at + index),
                 nts_view_get(reading, (double)index));
  }
  if (snapshot) {
    nts_release((NtsHeader *)snapshot);
  }
}

/* Symbols.
 *
 * A symbol is a header and a description pointer, and its identity is its
 * address. Everything JavaScript asks of symbols follows from that without
 * comparing anything else:
 *
 *   Symbol("a") === Symbol("a")          false -- two allocations
 *   Symbol.for("a") === Symbol.for("a")  true  -- one registry entry
 *
 * The description takes no part in either, which is why it can be null.
 *
 * `references` is 1 with an offset table naming the description, so the
 * collector walks it like any other object field. `cyclic` is 0 and that is a
 * statement rather than an omission: a symbol's only reference is a string,
 * and a string holds no references, so no symbol can reach itself. */
static const uint32_t nts_refs_symbol[] = {
    (uint32_t)offsetof(NtsSymbol, description)};
static const NtsDescriptor nts_desc_symbol = {NTS_KIND_SYMBOL,
                                              (uint32_t)sizeof(NtsSymbol),
                                              1u,
                                              0u,
                                              nts_refs_symbol,
                                              0,
                                              "Symbol",
                                              0u,
                                              0,
                                              NTS_ARRAY_UNKNOWN,
                                              0u,
                                              NULL,
                                              NULL,
                                              NULL,
                                              NULL,
                                              NULL};

/* The `Symbol.for` registry: keys to the symbols made for them.
 *
 * A strong reference on purpose, and the specification's own rule -- a
 * registered symbol is reachable from the registry for the life of the runtime,
 * which is exactly the difference between `Symbol.for("a")` and `Symbol("a")`.
 * So it is not a leak; it is the semantics. */

NtsSymbol *nts_symbol_new(NtsString *description) {
  NtsSymbol *symbol = (NtsSymbol *)nts_alloc(sizeof(NtsSymbol));
  symbol->header.descriptor = &nts_desc_symbol;
  symbol->header.reserved = nts_fresh_count();
  symbol->header.flags = 0;
  symbol->header.length = 0;
  symbol->description = description;
  if (description) {
    nts_retain((NtsHeader *)description);
  }
  nts_note_allocation();
  return symbol;
}

NtsSymbol *nts_symbol_for(NtsString *key) {
  if (!nts_env->symbol_registry) {
    nts_env->symbol_registry =
        nts_map_alloc(&nts_desc_map, NTS_KEY_STRING, true);
    /* The map header. Its key block is counted where it is allocated, in
     * `nts_map_rehash`, and is accounted for on the first insertion below. */
    nts_env->permanent++;
  }
  NtsValue slot = nts_value_of_reference((NtsHeader *)key, NTS_TAG_STRING);
  NtsValue found = nts_map_get(nts_env->symbol_registry, slot, NTS_KEY_STRING);
  if (nts_value_tag(found) == NTS_TAG_SYMBOL) {
    /* Owned already: `nts_map_get` retains what it hands back, which is this
     * file's convention throughout -- `nts_map_key_at` and `nts_map_value_at`
     * do the same, and `produces_owned` in `hir::own` says a call yields an
     * owned reference with no exception for helpers.
     *
     * **Retaining again here is a leak**, and I wrote one. The reasoning that
     * produced it was that the registry owns the cell so the caller must be
     * given a second reference -- true, and the second reference had already
     * been given. The tell was in the numbers: seventeen calls left the count
     * at twenty rather than at one. */
    return (NtsSymbol *)nts_value_reference(found);
  }
  size_t before = nts_live_count();
  NtsSymbol *symbol = nts_symbol_new(key);
  nts_map_set(nts_env->symbol_registry, slot,
              nts_value_of_reference((NtsHeader *)symbol, NTS_TAG_SYMBOL),
              NTS_KEY_STRING);
  /* Whatever that took: the symbol, the key the registry now holds, and the
   * table's block the first time it grows. Measured rather than enumerated,
   * because enumerating it would be a second copy of the map's own growth rule
   * and would be wrong the first time that rule changed. */
  nts_env->permanent += nts_live_count() - before;
  return symbol;
}

NtsString *nts_symbol_key_for(const NtsSymbol *symbol) {
  if (!symbol || !nts_env->symbol_registry) {
    return 0;
  }
  /* Walked rather than looked up, because the registry maps key to symbol and
   * this asks the other way. `Symbol.keyFor` is rare and a second index would
   * cost every `Symbol.for` a write to keep it. */
  /* `used` rather than `header.length`: the registry never deletes, so the two
   * are equal, and `used` is what indexes the entry array. */
  for (uint32_t at = 0; at < nts_env->symbol_registry->used; at++) {
    NtsValue value = nts_map_value_at(nts_env->symbol_registry, (int32_t)at);
    if (nts_value_tag(value) == NTS_TAG_SYMBOL &&
        (const NtsSymbol *)nts_value_reference(value) == symbol) {
      NtsValue key = nts_map_key_at(nts_env->symbol_registry, (int32_t)at);
      /* Owned already: `nts_map_key_at` retains before it returns. */
      return (NtsString *)nts_value_reference(key);
    }
  }
  return 0;
}

NtsString *nts_symbol_description(const NtsSymbol *symbol) {
  NtsString *description = symbol ? symbol->description : 0;
  /* Owned, like every other reference handed out of this file. The symbol holds
   * one and the caller is given another. */
  if (description) {
    nts_retain((NtsHeader *)description);
  }
  return description;
}

NtsString *nts_symbol_to_string(const NtsSymbol *symbol) {
  /* Four allocations and one survivor. `nts_string_from_utf8` and `nts_concat`
   * are both `NTS_ALLOCATES` and both *borrow* their arguments, so every
   * intermediate here is owned by this function and has to be given back --
   * and none of them was. Under the bump allocator that is invisible; under
   * reference counting it is **three objects per call**, which is what
   * `examples/string-of-a-symbol-in-an-erased-slot` measured as 84 held over 29
   * cases.
   *
   * Nothing had run it: the rc lane runs every example, and until that example
   * existed no example called `String()` on a symbol at all. A leak in a helper
   * no counted program reaches is a leak nobody can see.
   *
   * `head` is `open` itself when the symbol has no description -- `Symbol()`
   * prints as `Symbol()` -- so the release below is guarded on their being
   * different objects rather than written twice. */
  NtsString *open = nts_string_from_utf8("Symbol(", 7);
  NtsString *close = nts_string_from_utf8(")", 1);
  const NtsString *inside =
      symbol && symbol->description ? symbol->description : 0;
  NtsString *head = inside ? nts_concat(open, inside) : open;
  NtsString *whole = nts_concat(head, close);
  if (head != open) {
    nts_release((NtsHeader *)head);
  }
  nts_release((NtsHeader *)open);
  nts_release((NtsHeader *)close);
  return whole;
}

NtsString *nts_access_key_description(NtsValue key) {
  switch (nts_value_tag(key)) {
  case NTS_TAG_UNDEFINED:
  case NTS_TAG_NULL:
  case NTS_TAG_BOOLEAN:
  case NTS_TAG_NUMBER:
  case NTS_TAG_BIGINT:
  case NTS_TAG_STRING:
    return nts_value_to_string(key);
  case NTS_TAG_SYMBOL: {
    const NtsSymbol *symbol = (const NtsSymbol *)nts_value_reference(key);
    const NtsString *description = symbol ? symbol->description : NULL;
    if (!description || description->length <= 128u) {
      return nts_symbol_to_string(symbol);
    }
    /* Node v24.20.0 / V8 NoSideEffectsToMaybeString: count UTF-16 units,
     * including any lone surrogate at either cut, rather than UTF-8 bytes. */
    NtsString *first = nts_str_slice(description, 0, 56);
    NtsString *last = nts_str_slice(description, description->length - 56u,
                                    description->length);
    NtsString *middle = NTS_TEXT("...<omitted>...");
    NtsString *head = nts_concat(first, middle);
    NtsString *shortened = nts_concat(head, last);
    NtsSymbol abbreviated = *symbol;
    abbreviated.description = shortened;
    NtsString *out = nts_symbol_to_string(&abbreviated);
    nts_release((NtsHeader *)first);
    nts_release((NtsHeader *)last);
    nts_release((NtsHeader *)middle);
    nts_release((NtsHeader *)head);
    nts_release((NtsHeader *)shortened);
    return out;
  }
  default:
    /* A diagnostic must never call user code. An erased object key still
     * raises the catchable TypeError, with its description omitted. */
    return NULL;
  }
}

NtsMap *nts_map_new(double kind) {
  return nts_map_alloc(&nts_desc_map, (uint32_t)kind, true);
}
NtsMap *nts_set_new(double kind) {
  return nts_map_alloc(&nts_desc_map, (uint32_t)kind, false);
}
NtsMap *nts_table_new(double kind) {
  return nts_map_alloc(&nts_desc_table, (uint32_t)kind, true);
}

/* A key's hash, and the tag the table keeps for it.
 *
 * The tag is the hash with its top bit set, so it is never 0 -- 0 marks a hole
 * in the hash column and an empty index slot -- and it is computed beside the
 * slot rather than before it: the slot is `hash & mask`, which no mask below
 * 2^31 slots reads the top bit of, so tag and slot agree and the lookup's
 * address does not wait on a fix-up. `hash ? hash : 1` did, and cost
 * symbol-keyed-map a cycle a lookup. */
#define NTS_MAP_TAG(hash) ((hash) | 0x80000000u)

/* Whether `key` is of the sort the table's kind hashes and compares.
 *
 * The kind is chosen at the constructor from the table's static key type
 * (`key_kind_of` in lowering), and a view can widen that type: method
 * parameters are bivariant, so a `Map<string, number>` is a `Map<unknown,
 * unknown>`, and through that view a number may arrive as a key. A key the
 * kind cannot hash is one no entry can equal -- a narrow table holds only keys
 * that fit, and equal keys carry equal tags -- so a read answers "absent", and
 * a write widens the table first (`nts_map_widen`). The JVM's table does the
 * same (`NtsTable.eraseKeys`).
 *
 * An object key fits by any of the tags an object is erased with: a closure
 * is `FUNCTION` where the compiler knew and `OBJECT` where it did not
 * (`nts_tag_of_reference`), and identity is all a `REFERENCE` table reads. */
static inline __attribute__((always_inline)) bool
nts_map_fits(const NtsMap *map, NtsValue key) {
  uint32_t tag = nts_value_tag(key);
  switch (map->kind) {
  case NTS_KEY_STRING:
    return tag == NTS_TAG_STRING;
  case NTS_KEY_NUMBER:
    return tag == NTS_TAG_NUMBER;
  case NTS_KEY_REFERENCE:
    return tag >= NTS_TAG_FUNCTION && tag <= NTS_TAG_OBJECT;
  case NTS_KEY_OBJC:
    return tag == NTS_TAG_HANDLE_OBJC;
  default:
    return true;
  }
}

static void nts_map_reindex(NtsMap *map);

/* A table that a key of another sort is written to becomes erased: from here
 * on it hashes and compares every key by its tag, as a table created as
 * `Map<unknown, unknown>` does. An erased hash is not a narrow kind's -- it
 * mixes the tag in, so that 3 and "3" do not collide by construction -- so
 * every live entry's is taken again and the index rebuilt, once, the first
 * time a key that does not fit arrives.
 *
 * An Objective-C table is the exception, refused by name: its keys compare by
 * `-isEqual:`, which an erased table does not ask, so widening it would make
 * two equal strings two keys. */
static void nts_map_widen(NtsMap *map) {
  if (map->kind == NTS_KEY_OBJC) {
    fflush(stdout);
    fputs("nts: refused at run time: a key that is not an Objective-C "
          "object, written to a table of them\n",
          stderr);
    abort();
  }
  map->kind = NTS_KEY_ERASED;
  for (uint32_t at = 0; at < map->used; at++) {
    if (map->hashes[at] != 0) {
      map->hashes[at] =
          NTS_MAP_TAG(nts_hash_key(map->keys[at], NTS_KEY_ERASED));
    }
  }
  if (map->slots) {
    nts_map_reindex(map);
  }
}

/* The bytes a table's block holds, for its accounting. */
static size_t nts_map_block_bytes(uint32_t capacity, uint32_t slots,
                                  bool holds_values) {
  size_t column = (size_t)capacity * sizeof(NtsValue);
  return column + (holds_values ? column : 0u) +
         (size_t)slots * sizeof(uint64_t) + (size_t)capacity * sizeof(uint32_t);
}

/* Where `key` lives, or -1.
 *
 * `insert_at` receives the slot a fresh key would take: the first DELETED slot
 * on the chain if there was one, so that deleting and reinserting does not
 * make the table grow, and the terminating EMPTY otherwise. */
static inline __attribute__((always_inline)) int32_t
nts_map_find(const NtsMap *map, NtsValue key, uint32_t hash,
             uint32_t *insert_at, uint32_t kind) {
  /* An empty table, which has no index yet.
   *
   * No small-table scan: one was tried, below eight entries as the JVM's
   * table does, and made symbol-keyed-map 1.17x (C) and 1.28x (LLVM) slower
   * across three link layouts. A scan still hashes the key first while its
   * columns hold erased values, then compares up to eight hashes where the
   * index compares one. It pays where a key can be compared without hashing,
   * which typed key columns are for. */
  if (map->slots == 0) {
    if (insert_at) {
      *insert_at = 0;
    }
    return -1;
  }
  uint32_t mask = map->slots - 1u;
  uint32_t slot = hash & mask;
  uint32_t reuse = map->slots; /* none seen */
  for (uint32_t step = 0; step < map->slots; step++) {
    uint64_t entry = map->index[slot];
    if (entry == NTS_MAP_EMPTY) {
      if (insert_at) {
        *insert_at = reuse < map->slots ? reuse : slot;
      }
      return -1;
    }
    if (entry == NTS_MAP_DELETED) {
      if (reuse == map->slots) {
        reuse = slot;
      }
    } else if ((uint32_t)(entry >> 32) == NTS_MAP_TAG(hash)) {
      /* Only a key of the same hash is loaded at all. */
      uint32_t at = (uint32_t)entry - 1u;
      if (nts_key_eq(map->keys[at], key, kind)) {
        if (insert_at) {
          *insert_at = slot;
        }
        return (int32_t)at;
      }
    }
    slot = (slot + 1u) & mask;
  }
  if (insert_at) {
    *insert_at = reuse < map->slots ? reuse : 0;
  }
  return -1;
}

/* Grow the entry arrays and rebuild the index, keeping every entry where it is.
 *
 * # Why the holes are not dropped here
 *
 * They were, and it was wrong. A walk's whole state is an entry index, and
 * compaction renumbers entries -- so a `for (const v of s) { s.add(x); }` that
 * grew the table would leave the cursor pointing at a different entry than the
 * one it had reached, silently skipping or repeating elements.
 *
 * That is not a hypothetical shape. node visits an entry appended during a walk
 * (`x, k1, k2` for the loop in `nts_map_next`'s comment), so this is a pattern
 * the language defines rather than one nobody writes.
 *
 * Keeping the positions makes a cursor valid for as long as it exists, which is
 * what lets iteration be a number rather than an object with a registration
 * protocol. What it costs is that a hole is not reclaimed until `clear`: a
 * table inserted into and deleted from forever grows with its total insertions
 * rather than with what it holds. The fix when that matters is the one V8 uses
 * -- a list of live iterators, updated when the table compacts -- and it is a
 * real feature rather than a tweak to this function.
 */
static void nts_map_rehash(NtsMap *map) {
  /* A table's cursor is an `int32_t` entry index, and an entry keeps its
   * index for the table's life, so a table holds at most `NTS_MAX_LENGTH`
   * entries, holes included: the bound `hir::flow` states for
   * `nts_map_next`, and the one `index`'s `int32_t` slots needed already.
   * Past it, the allocation-failure path, as for an array or a string --
   * V8 stops a `Map` at 2^24 entries, so no program node runs reaches it. */
  if (map->used >= (uint32_t)NTS_MAX_LENGTH) {
    fprintf(stderr, "nts: a map cannot hold more than %u entries\n",
            (unsigned)NTS_MAX_LENGTH);
    abort();
  }
  /* On `used` rather than on the live count, because the holes are staying.
   * In 64 bits, and capped: doubling a `uint32_t` past 2^31 wraps. */
  uint64_t doubled = (uint64_t)map->used * 2u;
  uint32_t wanted = doubled > (uint64_t)NTS_MAX_LENGTH
                        ? (uint32_t)NTS_MAX_LENGTH
                        : (uint32_t)doubled;
  if (wanted < 8u) {
    wanted = 8u;
  }

  uint32_t slots = 8u;
  while (slots < NTS_MAP_SLOTS_FOR(wanted)) {
    slots *= 2u;
  }

  /* One block, sliced, rather than four.
   *
   * The arrays are allocated and freed together and always have been -- they
   * are the same table -- so nothing was buying separate `malloc`s except the
   * code being written that way. A table of seventeen entries grows three
   * times, and `tooling/memory/cases/map-and-set` counted 3 blocks a rehash
   * for a `Map` and 2 for a `Set`: seventeen allocations for two containers.
   *
   * `keys` first, so the block's base is what `free` is given. `NtsValue` is
   * sixteen bytes, so `values` and then the 8-byte `index` are aligned by
   * construction rather than by padding; the 4-byte `hashes` go last. */
  size_t key_bytes = (size_t)wanted * sizeof(NtsValue);
  size_t value_bytes = map->holds_values ? key_bytes : 0u;
  size_t index_bytes = (size_t)slots * sizeof(uint64_t);
  size_t hash_bytes = (size_t)wanted * sizeof(uint32_t);
  unsigned char *block = (unsigned char *)nts_side_alloc(
      key_bytes + value_bytes + index_bytes + hash_bytes);
  if (!block) {
    fprintf(stderr, "nts: out of memory growing a map\n");
    abort();
  }
  NtsValue *keys = (NtsValue *)(void *)block;
  NtsValue *values =
      map->holds_values ? (NtsValue *)(void *)(block + key_bytes) : 0;
  uint64_t *index = (uint64_t *)(void *)(block + key_bytes + value_bytes);
  uint32_t *hashes =
      (uint32_t *)(void *)(block + key_bytes + value_bytes + index_bytes);
  /* Counted, which they were not.
   *
   * `nts_note_allocation` says "objects, arrays, strings and maps all come
   * through it", and a map's *header* did while the blocks holding its actual
   * contents did not -- so `tooling/memory`'s allocation column showed `1` for
   * a table of any size, and could not have shown otherwise. */
  nts_note_allocation();

  /* Every entry at the index it already had, holes included, with its hash. */
  uint32_t out = map->used;
  for (uint32_t at = 0; at < out; at++) {
    keys[at] = map->keys[at];
    if (values) {
      values[at] = map->values[at];
    }
    hashes[at] = map->hashes[at];
  }

  nts_env->bytes_held += nts_map_block_bytes(wanted, slots, map->holds_values);
  if (map->keys) {
    nts_env->bytes_held -=
        nts_map_block_bytes(map->capacity, map->slots, map->holds_values);
    /* Paired with the one above, or `nts_live_count` -- which is
     * `allocated - reclaimed` -- would read every grown table as a leak. */
    nts_env->reclaimed++;
    /* `keys` is the block: the other columns point into it. */
    nts_side_free(map->keys, "a table");
  }
  map->keys = keys;
  map->values = values;
  map->index = index;
  map->hashes = hashes;
  map->capacity = wanted;
  map->slots = slots;
  map->used = out;
  nts_map_reindex(map);
}

/* The index rebuilt from the hashes the entries kept -- no key is hashed
 * again -- and from the live entries only: a hole's hash is 0, and nothing
 * should find its way back to one. */
static void nts_map_reindex(NtsMap *map) {
  uint64_t *index = map->index;
  uint32_t mask = map->slots - 1u;
  for (uint32_t slot = 0; slot < map->slots; slot++) {
    index[slot] = NTS_MAP_EMPTY;
  }
  for (uint32_t at = 0; at < map->used; at++) {
    uint32_t hash = map->hashes[at];
    if (hash == 0) {
      continue;
    }
    uint32_t slot = hash & mask;
    while (index[slot] != NTS_MAP_EMPTY) {
      slot = (slot + 1u) & mask;
    }
    index[slot] = ((uint64_t)hash << 32) | (at + 1u);
  }
  /* Every slot moved, so every entry taken before is stale. */
  map->generation++;
}

/* `map.get(k)`, and `undefined` when there is no such key.
 *
 * The slot is returned whole. A map may legitimately hold `undefined` as a
 * value, so this cannot distinguish "absent" from "present and undefined" --
 * and neither can JavaScript's, which is why `has` exists. */
/* What a table hands back is the *caller's*, so a reference in it is retained.
 *
 * A parameter is borrowed and a call's result is owned, and an erased value is
 * counted like any other -- the compiler releases what `get` returned when the
 * temporary dies. Returning the slot unchanged handed out a count nobody had
 * taken, so reading one key five times released the value five times while the
 * table still held it.
 *
 * The same for the two cursor reads below: a `for...of` over a table reads a
 * key and a value per step and gives each back at the end of the step. */
/* `get`, `has`, `set` and `add` are inlined, and `nts_map_rehash` is not.
 *
 * That split is the whole of it. A lookup is a hash, a masked index and a probe
 * that almost always hits on the first slot -- twenty or so instructions, with
 * `nts_map_find` and `nts_hash_key` already folded into them -- so out of line
 * the call was a third of the cost of the thing it called. Growing is a
 * `malloc`, a copy and a reinsert of every entry, it happens log n times, and
 * it stays where it is: `nts_map_rehash` is 15.6% of the benchmark as a call
 * and would be far more as a copy at every `set`.
 *
 * `benches/cases/map-and-set` walked down as each went in: 6.82us with none of
 * them, 6.12 with `get` and `has`, 5.53 with `set`, 5.35 with `add`. That is
 * 1.35x bun to 1.01x, and 0.72x `std::unordered_map` to 0.56x. */
/* # Two halves to every keyed call
 *
 * A call whose kind is the table's has its static type's promise that the key
 * fits, and runs the `_as` body with that kind: a constant once inlined, so
 * what is left is one compare of `map->kind` and the one hash and comparison
 * the kind names. A call whose kind is not -- a view widened the key type --
 * takes the `_unpromised` half, out of line: it asks the key
 * (`nts_map_fits`), and runs the same body with the table's own kind.
 *
 * Measured before it was built, with each benchmark's kind forced constant in
 * the runtime: map-and-set 0.90x, the word counts 0.89-0.95x, str-map-keys
 * 0.89x, symbol-keyed-map 0.94x (C and LLVM, 2026-10-23). */
static inline __attribute__((always_inline)) NtsValue
nts_map_get_as(const NtsMap *map, NtsValue key, uint32_t kind) {
  int32_t at = nts_map_find(map, key, nts_hash_key(key, kind), 0, kind);
  if (at < 0 || !map->values) {
    return nts_value_of_undefined();
  }
  nts_value_retain(map->values[at]);
  return map->values[at];
}

static NTS_NOINLINE NtsValue nts_map_get_unpromised(const NtsMap *map,
                                                    NtsValue key) {
  if (!nts_map_fits(map, key)) {
    return nts_value_of_undefined();
  }
  return nts_map_get_as(map, key, map->kind);
}

__attribute__((always_inline)) NtsValue nts_map_get(const NtsMap *map,
                                                    NtsValue key,
                                                    uint32_t kind) {
  if (__builtin_expect(map->kind != kind, 0)) {
    return nts_map_get_unpromised(map, key);
  }
  return nts_map_get_as(map, key, kind);
}

static NTS_NOINLINE bool nts_map_has_unpromised(const NtsMap *map,
                                                NtsValue key) {
  return nts_map_fits(map, key) &&
         nts_map_find(map, key, nts_hash_key(key, map->kind), 0, map->kind) >=
             0;
}

__attribute__((always_inline)) bool nts_map_has(const NtsMap *map, NtsValue key,
                                                uint32_t kind) {
  if (__builtin_expect(map->kind != kind, 0)) {
    return nts_map_has_unpromised(map, key);
  }
  return nts_map_find(map, key, nts_hash_key(key, kind), 0, kind) >= 0;
}

int32_t nts_table_membership(NtsValue receiver, NtsValue key) {
  if (!NTS_TAG_IS_MANAGED(nts_value_tag(receiver))) {
    return -1;
  }
  const NtsHeader *object = nts_value_reference(receiver);
  if (!object || object->descriptor != &nts_desc_table) {
    return -1;
  }
  return nts_map_has((const NtsMap *)object, key, NTS_KEY_ERASED) ? 1 : 0;
}

/* `map.set(k, v)` / `set.add(v)`, returning the collection, which is what both
 * evaluate to in JavaScript. */
/* `Map.prototype.set` step 6: "If key is -0, set key to +0."
 *
 * The normalization is at *insertion*, not at comparison, and the difference
 * is observable -- `m.set(-0, 1)` then `[...m.keys()][0]` is `+0` in node, so
 * storing the key as written would be wrong even though every lookup would
 * still find it. Transcribed from the oracle rather than reasoned about: the
 * first version kept the key it was given and node disagreed. */
static NtsValue nts_map_normalize(NtsValue key) {
  if (nts_value_tag(key) == NTS_TAG_NUMBER && nts_value_number(key) == 0.0) {
    return nts_value_of_number(0.0);
  }
  return key;
}

/* Hand back the table that was passed in, *borrowed*. `nts_array_same`'s twin,
 * and under the same convention for the same reason.
 *
 * The retain this used to do was covering a real crash: `stringKeys` released
 * the same `NtsMap` four times, once for the map and once for each `set` that
 * returned it. It had been that way since `Map` landed, and every gate reported
 * `examples/map-and-set` as agreeing on every case, because the driver
 * segfaulted before flushing a single line and "agreed" did not ask whether
 * anything had been checked.
 *
 * The count is balanced at the caller now -- see `nts_array_same` -- which is
 * the end of it a `set` in a loop can be free at. */
static NtsMap *nts_map_same(NtsMap *map) { return map; }

/* A present key's new value. The key stays as it was -- `set` replaces the
 * value and not the key, which is observable for `-0` against `+0`. */
static inline __attribute__((always_inline)) void
nts_map_overwrite(NtsMap *map, int32_t at, NtsValue value) {
  if (map->values) {
    if (NTS_TAG_IS_POINTER(nts_value_tag(value))) {
      map->holds |= NTS_MAP_HOLDS_VALUES;
    }
    nts_value_retain(value);
    nts_value_release(map->values[at]);
    map->values[at] = value;
  }
}

/* A fresh key of `hash` at `slot`, the one `nts_map_find` said it would take,
 * in a table with room for one more entry. */
static inline __attribute__((always_inline)) void
nts_map_insert_at(NtsMap *map, NtsValue key, NtsValue value, uint32_t slot,
                  uint32_t hash) {
  nts_value_retain(key);
  if (map->values) {
    nts_value_retain(value);
    map->values[map->used] = value;
  }
  map->keys[map->used] = key;
  map->holds |=
      (NTS_TAG_IS_POINTER(nts_value_tag(key)) ? NTS_MAP_HOLDS_KEYS : 0u) |
      (map->values && NTS_TAG_IS_POINTER(nts_value_tag(value))
           ? NTS_MAP_HOLDS_VALUES
           : 0u);
  map->hashes[map->used] = NTS_MAP_TAG(hash);
  map->index[slot] = ((uint64_t)NTS_MAP_TAG(hash) << 32) | (map->used + 1u);
  map->used++;
  map->header.length++;
  map->generation++;
}

/* A key a table of `kind` stores: -0 as +0, which only a number can be. */
static inline __attribute__((always_inline)) NtsValue
nts_map_stored(NtsValue key, uint32_t kind) {
  return kind == NTS_KEY_NUMBER || kind == NTS_KEY_ERASED
             ? nts_map_normalize(key)
             : key;
}

static inline __attribute__((always_inline)) NtsMap *
nts_map_set_as(NtsMap *map, NtsValue key, NtsValue value, uint32_t kind) {
  key = nts_map_stored(key, kind);
  uint32_t hash = nts_hash_key(key, kind);
  uint32_t slot = 0;
  int32_t at = nts_map_find(map, key, hash, &slot, kind);
  if (at >= 0) {
    nts_map_overwrite(map, at, value);
    return nts_map_same(map);
  }
  if (map->used == map->capacity) {
    nts_map_rehash(map);
    nts_map_find(map, key, hash, &slot, kind);
  }
  nts_map_insert_at(map, key, value, slot, hash);
  return nts_map_same(map);
}

static NTS_NOINLINE NtsMap *nts_map_set_unpromised(NtsMap *map, NtsValue key,
                                                   NtsValue value) {
  if (!nts_map_fits(map, key)) {
    nts_map_widen(map);
  }
  return nts_map_set_as(map, key, value, map->kind);
}

__attribute__((always_inline)) NtsMap *
nts_map_set(NtsMap *map, NtsValue key, NtsValue value, uint32_t kind) {
  if (__builtin_expect(map->kind != kind, 0)) {
    return nts_map_set_unpromised(map, key, value);
  }
  return nts_map_set_as(map, key, value, kind);
}

/* The entry `nts_map_entry` answers: the generation it was taken at, and a
 * slot. An entry lives between two operations the compiler proved write
 * nothing, so a generation wrapping 2^32 structural writes under one is not a
 * case that arises. */
static inline uint64_t nts_map_entry_of(const NtsMap *map, uint32_t slot) {
  return ((uint64_t)map->generation << 32) | slot;
}

/* Whether `entry` still names a slot of `map`: taken at this generation, and
 * the index allocated -- an empty table's entry names no slot. */
static inline bool nts_map_entry_current(const NtsMap *map, uint64_t entry) {
  return (uint32_t)(entry >> 32) == map->generation &&
         (uint32_t)entry < map->slots;
}

__attribute__((always_inline)) uint64_t nts_map_entry(const NtsMap *map,
                                                      NtsValue key,
                                                      uint32_t kind) {
  /* Without the promise, no slot: past the index, which no entry is current
   * at, and the read and the write through it take their own unpromised
   * halves, which ask the key. */
  if (__builtin_expect(map->kind != kind, 0)) {
    return nts_map_entry_of(map, map->slots);
  }
  uint32_t slot = 0;
  nts_map_find(map, key, nts_hash_key(key, kind), &slot, kind);
  return nts_map_entry_of(map, slot);
}

/* `nts_map_get` through an entry, retaining what it hands back as that does. A
 * current entry's slot holds the key's entry or says it has none: only a
 * structural write changes the index, and every one moves the generation. */
__attribute__((always_inline)) NtsValue nts_map_entry_get(const NtsMap *map,
                                                          uint64_t entry,
                                                          NtsValue key,
                                                          uint32_t kind) {
  if (__builtin_expect(map->kind != kind, 0)) {
    return nts_map_get_unpromised(map, key);
  }
  if (!nts_map_entry_current(map, entry)) {
    return nts_map_get_as(map, key, kind);
  }
  uint64_t held = map->index[(uint32_t)entry];
  if (held == NTS_MAP_EMPTY || held == NTS_MAP_DELETED || !map->values) {
    return nts_value_of_undefined();
  }
  uint32_t at = (uint32_t)held - 1u;
  nts_value_retain(map->values[at]);
  return map->values[at];
}

/* `nts_map_set` through an entry: the value overwritten in place, or a fresh
 * key stored at the slot the lookup found, with no second hash or probe. A
 * stale entry, or a table that must grow first, takes `nts_map_set` itself. */
__attribute__((always_inline)) NtsMap *
nts_map_entry_set(NtsMap *map, uint64_t entry, NtsValue key, NtsValue value,
                  uint32_t kind) {
  if (__builtin_expect(map->kind != kind, 0)) {
    return nts_map_set_unpromised(map, key, value);
  }
  if (!nts_map_entry_current(map, entry)) {
    return nts_map_set_as(map, key, value, kind);
  }
  uint32_t slot = (uint32_t)entry;
  uint64_t held = map->index[slot];
  if (held != NTS_MAP_EMPTY && held != NTS_MAP_DELETED) {
    nts_map_overwrite(map, (int32_t)((uint32_t)held - 1u), value);
    return nts_map_same(map);
  }
  if (map->used == map->capacity) {
    return nts_map_set_as(map, key, value, kind);
  }
  /* A fresh key, so its hash is taken again: the entry has room for the slot
   * and not for it, and the insertion is the rarer half of an update. */
  key = nts_map_stored(key, kind);
  nts_map_insert_at(map, key, value, slot, nts_hash_key(key, kind));
  return nts_map_same(map);
}

bool nts_map_delete(NtsMap *map, NtsValue key, uint32_t kind) {
  if (map->kind != kind) {
    if (!nts_map_fits(map, key)) {
      return false;
    }
    kind = map->kind;
  }
  uint32_t hash = nts_hash_key(key, kind);
  uint32_t slot = 0;
  int32_t at = nts_map_find(map, key, hash, &slot, kind);
  if (at < 0) {
    return false;
  }
  nts_value_release(map->keys[at]);
  map->keys[at].tag = NTS_TAG_HOLE;
  map->keys[at].as.reference = 0;
  if (map->values) {
    nts_value_release(map->values[at]);
    map->values[at] = nts_value_of_undefined();
  }
  map->hashes[at] = 0;
  /* DELETED rather than EMPTY: a key further along the probe chain was placed
   * past this slot and would become unreachable if the chain ended here. */
  map->index[slot] = NTS_MAP_DELETED;
  map->header.length--;
  map->generation++;
  return true;
}

void nts_map_clear(NtsMap *map) {
  for (uint32_t at = 0; at < map->used; at++) {
    if (nts_map_is_hole(map->keys[at])) {
      continue;
    }
    nts_value_release(map->keys[at]);
    /* Marked as a hole and *cleared*, not just released. The collector walks
     * these arrays as far as `used`, so a slot still naming a released object
     * is a reference it would follow into freed memory. */
    map->keys[at].tag = NTS_TAG_HOLE;
    map->keys[at].as.reference = 0;
    map->hashes[at] = 0;
    if (map->values) {
      nts_value_release(map->values[at]);
      map->values[at] = nts_value_of_undefined();
    }
  }
  for (uint32_t slot = 0; slot < map->slots; slot++) {
    map->index[slot] = NTS_MAP_EMPTY;
  }
  /* `used` is deliberately *not* reset.
   *
   * A walk's whole state is an entry index, and the contract beside
   * `nts_map_next` is that an entry appended during one is visited. Resetting
   * `used` puts the next insertion at slot zero, which a cursor already past it
   * never reaches: walking `[1, 2]`, clearing after the first element and
   * adding `3` must yield `[1, 3]` and yielded `[1]`.
   *
   * The cost is that a clear does not give the storage back, so a
   * clear-and-refill loop grows. That is the price of the minimal repair and it
   * is worth naming: reclaiming the dead prefix needs a logical base the
   * cursors are relative to, which is a design rather than a line. */
  map->header.length = 0;
  map->generation++;
}

__attribute__((always_inline)) NtsMap *nts_set_add(NtsMap *map, NtsValue key,
                                                   uint32_t kind) {
  return nts_map_set(map, key, nts_value_of_undefined(), kind);
}

/* Walking a table, and walking text.
 *
 * # Why a cursor and not an iterator object
 *
 * JavaScript's iteration over a `Map` is defined against the live table rather
 * than against a snapshot of it, and both halves of that are observable. node:
 *
 *     const g = new Map([["x", 1]]);
 *     for (const [k] of g) { ...; g.set("k" + n, 1); }   // visits x, k1, k2
 *
 *     const d = new Map([["p",1],["q",2],["r",3]]);
 *     for (const [k] of d) { if (k === "p") d.delete("q"); }   // visits p, r
 *
 * An entry appended while the loop runs *is* reached, and one deleted ahead of
 * the cursor is *not*. An iterator holding a copy of the entries would get both
 * wrong, and holding a length would get the first wrong. Re-reading `used` and
 * the hole tag on every step gets both right for free, so the whole of the
 * state is one integer -- which means the loop carries a number, allocates
 * nothing, and specializes like any other counter.
 */

/* The next live entry at or after `from`, or -1 when there is none.
 *
 * `used` is read on every call rather than once, which is what makes an entry
 * appended during the walk visible to it. */
int32_t nts_map_next(const NtsMap *map, int32_t from) {
  if (from < 0) {
    return -1;
  }
  for (uint32_t at = (uint32_t)from; at < map->used; at++) {
    if (map->hashes[at] != 0) {
      return (int32_t)at;
    }
  }
  return -1;
}

/* Read an entry the cursor has already landed on.
 *
 * No bounds test: `nts_map_next` returned this index and the only thing that
 * could invalidate it is a rehash, which cannot happen between the two -- the
 * loop body runs after the read, not between it and the step. An out-of-range
 * index would be a compiler bug rather than a program's, so it is not a check
 * this pays for on every element. */
/* The key and the value at `at`, **borrowed**: what a walk inside this file
 * reads, to hand to something that keeps its own count -- `nts_map_set`, or
 * an array slot retained where it is written.
 *
 * `nts_map_key_at` and `nts_map_value_at` are the program's readers, and hand
 * back a count the caller owns. Read here, they retained once more than
 * anything released: `nts_map_copy`, `nts_map_extend` and `nts_map_keys_str`
 * each kept one count of every key (and value) they walked, which reference
 * counting reports as objects never given back --
 * `tests/programs/a-function-that-can-fall-off-its-end` under `rc`, the first
 * program to enumerate keys it had built. Literal keys hid it: they are
 * immortal, and a retain of one does nothing. */
static inline NtsValue nts_map_key_borrowed(const NtsMap *map, int32_t at) {
  return map->keys[(uint32_t)at];
}

static inline NtsValue nts_map_value_borrowed(const NtsMap *map, int32_t at) {
  return map->values ? map->values[(uint32_t)at] : nts_value_of_undefined();
}

/* `{ ...table }`, and every other copy of a string-keyed table.
 *
 * Insertion order, because that is what a copy of a JavaScript object is: the
 * walk visits live entries in the order they were written, and `nts_map_set`
 * appends. `{ ...obj, k: v }` therefore puts `k` where node puts it -- last if
 * it is new, in place if it is not -- which is the difference a differential
 * over generated queries found once already and no pinned test covers.
 *
 * The new table takes the source's `kind`, so the hash and comparison it was
 * built with are the ones it keeps. Guessing one would find nothing, which is
 * the failure that looks like an empty table rather than like a bug.
 *
 * Values are retained by `nts_map_set`; the source keeps its own counts. */
NtsMap *nts_map_copy(const NtsMap *map) {
  /* The source's type with its contents: a table's copy is a table. */
  NtsMap *out =
      nts_map_alloc(map->header.descriptor, map->kind, map->holds_values);
  /* Every key fits the kind the source was built with -- a table holds only
   * keys that do -- and the copy is built with the same one. */
  for (int32_t at = nts_map_next(map, 0); at >= 0;
       at = nts_map_next(map, at + 1)) {
    nts_map_set(out, nts_map_key_borrowed(map, at),
                nts_map_value_borrowed(map, at), map->kind);
  }
  return out;
}

NtsMap *nts_map_extend(NtsMap *target, const NtsMap *source) {
  /* The source's kind is what its keys are known to fit; a target built for
   * another asks each of them. */
  for (int32_t at = nts_map_next(source, 0); at >= 0;
       at = nts_map_next(source, at + 1)) {
    nts_map_set(target, nts_map_key_borrowed(source, at),
                nts_map_value_borrowed(source, at), source->kind);
  }
  return target;
}

/* `Object.keys(table)`, as the array of keys in insertion order.
 *
 * Strings only, which is what the caller has: a table reaches here from an
 * index signature, and `hir::lower` admits only a string key for one. A
 * general map's keys are `NtsValue`s and `Object.keys` of one is `[]` anyway,
 * since a `Map`'s entries are not own properties.
 *
 * Each key is retained: the array owns what it holds, and the table it came
 * from is still holding its own count. */
/* Whether a key is an *array index* in the specification's sense, which is what
 * decides where it goes in `Object.keys`.
 *
 * `ToString(ToUint32(P)) === P` and `ToUint32(P) != 2^32 - 1`, spelled out: all
 * digits, no leading zero unless the whole string is `"0"`, and below
 * 4294967295. So `"0"` and `"101"` are indices; `"01"`, `"1.0"`, `"-1"` and
 * `""` are ordinary string keys. */
static bool nts_array_index_key(const NtsString *key, uint32_t *out) {
  uint32_t units = key->length;
  if (units == 0 || units > 10) {
    return false;
  }
  if (units > 1 && nts_unit(key, 0) == (uint16_t)'0') {
    return false;
  }
  uint64_t value = 0;
  for (uint32_t at = 0; at < units; at++) {
    uint16_t unit = nts_unit(key, at);
    if (unit < (uint16_t)'0' || unit > (uint16_t)'9') {
      return false;
    }
    value = value * 10u + (uint64_t)(unit - (uint16_t)'0');
  }
  if (value >= 4294967295u) {
    return false;
  }
  *out = (uint32_t)value;
  return true;
}

NtsArray *nts_map_keys_str(const NtsMap *map) {
  NtsArray *out = nts_array_new(&nts_desc_ref, (double)map->header.length);
  uint32_t written = 0;
  /* Two passes, because JavaScript's own-property order is not insertion
     order: every key that is an array index comes first, **ascending**, and the
     rest follow in insertion order.

     This walked once and wrote each key as it came, and its comment said
     "`Object.keys(table)`, as the array of keys in insertion order" -- which
     described the function accurately and left out that the language's order is
     something else. `http`'s status table is `{ 100: "Continue", 101: ... }`,
     every key an index, so any enumeration of it was wrong unless the insertion
     happened to be ascending. */
  uint32_t indices = 0;
  for (int32_t at = nts_map_next(map, 0); at >= 0;
       at = nts_map_next(map, at + 1)) {
    NtsHeader *key = nts_value_reference(nts_map_key_borrowed(map, at));
    uint32_t slot = 0;
    if (!nts_array_index_key((const NtsString *)key, &slot)) {
      continue;
    }
    nts_retain(key);
    NTS_ITEMS(out, NtsHeader *)[written] = key;
    written++;
    indices++;
  }
  /* Insertion sort over the index keys alone. They are few in every table this
     compiles -- a status table is the large case at sixty -- and the value is
     re-derived rather than carried, because parsing ten digits is cheaper than
     an allocation to hold them. */
  for (uint32_t i = 1; i < indices; i++) {
    NtsHeader *held = NTS_ITEMS(out, NtsHeader *)[i];
    uint32_t value = 0;
    (void)nts_array_index_key((const NtsString *)held, &value);
    uint32_t j = i;
    while (j > 0) {
      uint32_t before = 0;
      (void)nts_array_index_key(
          (const NtsString *)NTS_ITEMS(out, NtsHeader *)[j - 1], &before);
      if (before <= value) {
        break;
      }
      NTS_ITEMS(out, NtsHeader *)[j] = NTS_ITEMS(out, NtsHeader *)[j - 1];
      j--;
    }
    NTS_ITEMS(out, NtsHeader *)[j] = held;
  }
  for (int32_t at = nts_map_next(map, 0); at >= 0;
       at = nts_map_next(map, at + 1)) {
    NtsHeader *key = nts_value_reference(nts_map_key_borrowed(map, at));
    uint32_t slot = 0;
    if (nts_array_index_key((const NtsString *)key, &slot)) {
      continue;
    }
    nts_retain(key);
    NTS_ITEMS(out, NtsHeader *)[written] = key;
    written++;
  }
  return out;
}

/* The live entries of `source` -- a table's keys or values, `used` written,
 * holes where `keys` says so -- into `out` at its own element kind. The table
 * holds every entry as an `NtsValue`; the destination is whatever the compiler
 * allocated for the element type, which is the table's own type or erased, so
 * each case reads the payload the tag already is. The kind is one for the
 * whole copy, so it is chosen once and each case is a loop of its own. */
static void nts_map_fill(const NtsMap *map, const NtsValue *source,
                         NtsArray *out) {
  const NtsDescriptor *descriptor = out->header.descriptor;
  const NtsValue *keys = map->keys;
  const uint32_t used = map->used;
  uint32_t written = 0;
  switch (descriptor->element) {
  case NTS_ARRAY_VALUE:
    for (uint32_t at = 0; at < used; at++) {
      if (!nts_map_is_hole(keys[at])) {
        nts_value_retain(source[at]);
        NTS_ITEMS(out, NtsValue)[written++] = source[at];
      }
    }
    break;
  case NTS_ARRAY_REFERENCE:
    for (uint32_t at = 0; at < used; at++) {
      if (!nts_map_is_hole(keys[at])) {
        NtsHeader *reference = NTS_TAG_IS_MANAGED(nts_value_tag(source[at]))
                                   ? nts_value_reference(source[at])
                                   : NULL;
        nts_retain(reference);
        NTS_ITEMS(out, NtsHeader *)[written++] = reference;
      }
    }
    break;
  case NTS_ARRAY_FLOAT:
    if (descriptor->size == sizeof(float)) {
      for (uint32_t at = 0; at < used; at++) {
        if (!nts_map_is_hole(keys[at])) {
          NTS_ITEMS(out, float)
          [written++] = (float)nts_value_number(source[at]);
        }
      }
    } else {
      for (uint32_t at = 0; at < used; at++) {
        if (!nts_map_is_hole(keys[at])) {
          NTS_ITEMS(out, double)[written++] = nts_value_number(source[at]);
        }
      }
    }
    break;
  case NTS_ARRAY_BOOL:
    for (uint32_t at = 0; at < used; at++) {
      if (!nts_map_is_hole(keys[at])) {
        NTS_ITEMS(out, bool)[written++] = nts_value_boolean(source[at]);
      }
    }
    break;
  case NTS_ARRAY_BIGINT:
    for (uint32_t at = 0; at < used; at++) {
      if (!nts_map_is_hole(keys[at])) {
        NTS_ITEMS(out, __int128)
        [written++] = nts_bigint_unbox(
            (const NtsBigIntBox *)nts_value_reference(source[at]));
      }
    }
    break;
  default:
    /* A defect, not a refusal: the compiler emits this copy only where the
     * array's element type is the table's own, and no table stores an
     * integer-narrowed or foreign element. */
    fprintf(stderr,
            "nts: a table copied into `%s`, an array of element kind %u, "
            "which no table stores\n",
            descriptor->name ? descriptor->name : "?", descriptor->element);
    abort();
  }
  /* The caller sized `out` at the live count, and every live entry is one
   * slot: a count that disagrees is a contract broken on one side or the
   * other, and the slots past it would read as zeros. One comparison a call. */
  if (written != out->header.length) {
    fprintf(stderr,
            "nts: a table of %u live entries copied into an array of %u\n",
            written, out->header.length);
    abort();
  }
}

void nts_map_keys_into(const NtsMap *map, NtsArray *out) {
  nts_map_fill(map, map->keys, out);
}

void nts_map_values_into(const NtsMap *map, NtsArray *out) {
  nts_map_fill(map, map->values ? map->values : map->keys, out);
}

NtsValue nts_map_key_at(const NtsMap *map, int32_t at) {
  nts_value_retain(map->keys[(uint32_t)at]);
  return map->keys[(uint32_t)at];
}

NtsValue nts_map_value_at(const NtsMap *map, int32_t at) {
  if (!map->values) {
    return nts_value_of_undefined();
  }
  nts_value_retain(map->values[(uint32_t)at]);
  return map->values[(uint32_t)at];
}

/* How many code units the code point at `at` occupies.
 *
 * A string iterates by code *point*: node yields three items for
 * `"a\u{1F600}b"`, of one, two and one units, where `length` is four. Stepping
 * by one unit would yield the halves of a surrogate pair as two separate
 * strings, each of them a lone surrogate, which is not what any program means.
 *
 * A high surrogate not followed by a low one is one unit wide and yields
 * itself, which is what JavaScript does with unpaired surrogates rather than
 * an error. */
double nts_str_point_width(const NtsString *s, double at) {
  if (!(at >= 0.0) || at + 1.0 >= (double)s->length) {
    return 1.0;
  }
  if ((s->flags & NTS_TWO_BYTE) == 0) {
    /* One byte per unit cannot hold a surrogate at all. */
    return 1.0;
  }
  const uint16_t *units = NTS_ELEMENTS(s, uint16_t);
  uint32_t index = (uint32_t)at;
  uint16_t high = units[index];
  uint16_t low = units[index + 1];
  bool paired =
      high >= 0xD800u && high <= 0xDBFFu && low >= 0xDC00u && low <= 0xDFFFu;
  return paired ? 2.0 : 1.0;
}

/* --- Tasks, the host seam, and the checkpoint ------------------------------
 *
 * See docs/language/async.md. The short version: the runtime owns the two
 * queues and the checkpoint because their ordering is observable, and the host
 * owns the loop because it is the platform's. The vtable is what makes a
 * deterministic test host possible, which is why it is a vtable rather than a
 * compile-time choice.
 */

void nts_host_install(const NtsHost *host) {
  nts_env->host = *host;
  nts_env->host_installed = true;
}

static void nts_require_host(const char *what) {
  if (!nts_env->host_installed) {
    fprintf(stderr, "nts: %s before a host was installed\n", what);
    abort();
  }
}

/* A growable ring of tasks.
 *
 * A ring rather than a list because the drain is FIFO and the whole point is
 * that it stays FIFO: reaction order is what the specification pins. */

static void nts_queue_push(NtsQueue *queue, NtsTask task) {
  if (queue->len == queue->capacity) {
    uint32_t capacity = queue->capacity ? queue->capacity * 2u : 16u;
    NtsTask *items = (NtsTask *)malloc((size_t)capacity * sizeof(NtsTask));
    if (!items) {
      fprintf(stderr, "nts: out of memory growing a task queue\n");
      abort();
    }
    /* Unrolled into the new order, so the ring starts at zero again. */
    for (uint32_t i = 0; i < queue->len; i++) {
      items[i] = queue->items[(queue->head + i) % queue->capacity];
    }
    free(queue->items);
    queue->items = items;
    queue->head = 0;
    queue->capacity = capacity;
  }
  queue->items[(queue->head + queue->len) % queue->capacity] = task;
  queue->len++;
}

static bool nts_queue_shift(NtsQueue *queue, NtsTask *out) {
  if (queue->len == 0) {
    return false;
  }
  *out = queue->items[queue->head];
  queue->head = (queue->head + 1u) % queue->capacity;
  queue->len--;
  return true;
}

void nts_enqueue_microtask(NtsTask task) {
  /* A host that owns checkpointing owns the queue with it, so there is one
   * ordering rather than two interleaved. */
  if (nts_env->host_installed && nts_env->host.enqueue_microtask) {
    nts_env->host.enqueue_microtask(nts_env->host.state, task);
    return;
  }
  nts_queue_push(&nts_env->microtask_queue, task);
}

void nts_enqueue_tick(NtsTask task) {
  nts_queue_push(&nts_env->tick_queue, task);
}

bool nts_has_pending_work(void) {
  return nts_env->microtask_queue.len != 0 || nts_env->tick_queue.len != 0;
}

/* The checkpoint.
 *
 *     do {
 *         while (tick = ticks.shift())  tick()
 *         drain microtasks until empty
 *     } while (ticks is not empty)
 *
 * Two queues, because `process.nextTick`'s runs ahead of the microtask queue
 * and a tick enqueued *by* a microtask runs in a second pass of the same
 * checkpoint rather than in the next macrotask. A profile that never enqueues
 * a tick makes the inner loop a no-op and this is exactly the ECMAScript
 * checkpoint -- it generalizes rather than special-cases, which is why it is
 * here from the start rather than retrofitted around programs that would then
 * change order.
 *
 * The drain runs to fixpoint, so a program can starve the host loop. That is
 * the specified behaviour and the alternative reorders observable output;
 * starvation is a program bug rather than a scheduling policy.
 *
 * Named for what a stack trace should call it. */
/* A collection where the program has gone quiet.
 *
 * Candidates are otherwise only examined when the buffer fills -- ten thousand
 * roots -- so a program that ends before that ends holding every dead cycle it
 * made. A hundred async calls held four hundred promises that one forced pass
 * reclaimed to nothing, which from the outside is indistinguishable from a
 * leak.
 *
 * The end of a checkpoint is the natural place: both queues are empty by
 * construction when it runs, so the program is between jobs and holding nothing
 * it is in the middle of. It costs one comparison when nothing is buffered,
 * which is the common case, and 50,000 async calls went from 14ms holding 44
 * objects to 9ms holding none -- faster, because memory reused promptly beats
 * memory that grows.
 *
 * It could not go in until `Promise.all` stopped freeing its result array three
 * times. Running the collector disturbs the allocator, and freed memory nobody
 * has reused still holds the right numbers: the bug was invisible until
 * something else wanted the same bytes.
 *
 * Not a replacement for the threshold. A program that never reaches a
 * checkpoint -- no promises, no timers -- still relies on the buffer filling,
 * and one that makes cycles far faster than it checkpoints still wants the
 * bound the threshold gives it. */
/* A node as a candidate root, the way a release makes an object one. */
static void nts_holder_root(NtsHeader *node) {
  nts_paint(node, NTS_PURPLE);
  nts_buffer_root(node);
}

static void nts_collect_at_checkpoint(void) {
  if (nts_env->collecting || nts_env->draining) {
    return;
  }
  /* And a foreign object that let go of something on its own side -- a window
   * destroyed, dropping its child -- which released nothing of ours, so its
   * cycle is looked at only if someone asks. */
  for (uint32_t family = 0; family < NTS_FAMILIES; family++) {
    if (nts_holders[family] != NULL) {
      nts_holders[family]->fallen(nts_holder_root);
    }
  }
  if (nts_env->roots_len == 0) {
    return;
  }
  nts_collect_cycles();
}

/* A promise that rejected with nothing listening, remembered until the
   checkpoint can decide. Retained: the program may hold no other reference to
   it, and the report needs its reason. */
static void nts_rejection_candidate(NtsPromise *promise) {
  if (nts_env->rejected_len == nts_env->rejected_cap) {
    uint32_t want = nts_env->rejected_cap == 0 ? 4 : nts_env->rejected_cap * 2;
    NtsPromise **grown =
        realloc(nts_env->rejected, (size_t)want * sizeof *grown);
    if (grown == 0) {
      fprintf(stderr, "nts: out of memory recording a rejected promise\n");
      abort();
    }
    nts_env->rejected = grown;
    nts_env->rejected_cap = want;
  }
  nts_retain((NtsHeader *)promise);
  nts_env->rejected[nts_env->rejected_len++] = promise;
}

/* **The half `nts_process_ticks_and_rejections` was named for and did not do.**
 *
 * Node's `processTicksAndRejections` drains the queues and then reports every
 * rejection still unhandled; this runtime borrowed the name and only ever
 * drained. The cost was the worst shape a defect has: an `async` entry point
 * that threw printed nothing and exited **0**, so every failing async program
 * read as a clean run. It was found by a WinRT fixture whose missing line
 * looked like a missing feature.
 *
 * After the drain, because that is the rule: a handler attached during the turn
 * -- `p.catch(...)` on the next line, an `await` in a task the queue held --
 * handles the rejection, and one attached later does not.
 *
 * `nts_uncaught` is the reporter rather than a sentence of its own: node ends
 * an unhandled rejection exactly as it ends an uncaught throw, an embedder that
 * wants the value gets it through the same path, and the exit status is 1 for
 * the same reason. The detail is NULL, which is a real limitation and not an
 * oversight -- the runtime cannot find `message` by name, since a descriptor
 * records where an object's references are and not what they are called, so the
 * line reads `nts: uncaught Error` where node prints the message too. Closing
 * it means the compiler passing the field it already knows how to find
 * (`message_field`), which is a change to every rejection's emitted code and so
 * its own decision. */
static void nts_report_unhandled_rejections(void) {
  uint32_t at = 0;
  while (at < nts_env->rejected_len) {
    NtsPromise *promise = nts_env->rejected[at++];
    if (promise->state == NTS_PROMISE_REJECTED && !promise->handled) {
      /* The list is not cleared first: `nts_uncaught` does not return, and an
         embedder that survives it will see the same promise again only if it
         rejects again. */
      nts_uncaught(nts_promise_reason(promise), 0);
    }
    nts_release((NtsHeader *)promise);
  }
  nts_env->rejected_len = 0;
}

/* What a checkpoint does after its drain, whoever drained: this runtime
   (`nts_process_ticks_and_rejections`) or a host that owns the queue
   (`nts_host_checkpoint_end`). `previous` is whether a checkpoint was already
   running when this one began. */
static void nts_finish_checkpoint(bool previous) {
  nts_collect_at_checkpoint();
  nts_env->checkpoint_active = previous;
  /* Only the outermost checkpoint reports. A nested one -- a capability that
     re-enters compiled code and checkpoints inside its own work -- has not
     finished the turn, so a handler still to be attached would be called
     unhandled. */
  if (!previous) {
    nts_report_unhandled_rejections();
  }
}

static void nts_process_ticks_and_rejections(void) {
  bool previous = nts_env->checkpoint_active;
  nts_env->checkpoint_active = true;
  NtsTask task;
  do {
    while (nts_queue_shift(&nts_env->tick_queue, &task)) {
      task.run(task.state);
    }
    while (nts_queue_shift(&nts_env->microtask_queue, &task)) {
      task.run(task.state);
    }
  } while (nts_env->tick_queue.len != 0);
  nts_finish_checkpoint(previous);
}

/* What glibc keeps at the top of its heap when memory is given back.
 *
 * Its default is 128 KB: past that, the free top of the heap goes back to the
 * system, and the next allocation faults the same pages in again. A program
 * that builds and drops a large string each time round paid that every time
 * round -- `json-stringify-typed` took 98,763 page faults a run, and 582 with
 * this kept. Sixteen megabytes is the order of a young generation, which is
 * what node and the JVM keep for the same reason; memory nobody touches again
 * is address space, not residence.
 *
 * The block size glibc stops serving from that heap is set with it, and has
 * to be: setting either one freezes glibc's own adjustment of the other, which
 * otherwise raises the size after a large block is freed so that the next one
 * comes from the heap. Frozen at its 128 KB default, every large block would
 * be a fresh mapping and fault again. 32 MB is the ceiling that adjustment
 * would have reached on a 64-bit build anyway.
 *
 * glibc only: the other allocators nts runs on do not give the top of the
 * heap back eagerly, so there is nothing there to keep. */
#if defined(__GLIBC__)
#include <malloc.h>
#define NTS_HEAP_TOP_KEPT (16 * 1024 * 1024)
#define NTS_HEAP_BLOCK_LIMIT (32 * 1024 * 1024)
#endif

#if !defined(_WIN32)
/* Unbounded recursion, ended by name.
 *
 * JavaScript ends it with a RangeError ("Maximum call stack size exceeded").
 * Compiled code has no limit of its own, so the stack runs into the kernel's
 * guard gap below it and the process died of SIGSEGV with nothing said
 * (`tests/outcomes/unbounded-recursion-is-a-range-error`). This says what
 * happened, and costs a call nothing: the fault is the test, as in Rust's
 * runtime, where a check on entry to every recursive function would be one
 * more compare and branch per call and would end a leaf's shrink-wrapping.
 * A RangeError the program can catch is not this: catching needs the raise
 * to start in the function itself, which only an entry check can give.
 *
 * Only the main thread's stack, the only one compiled code runs on: the
 * runtime starts no thread. A stack with no limit grows until memory runs
 * out and never faults, so it gets no handler. */
static const char *nts_stack_top;
static size_t nts_stack_size;
static struct sigaction nts_fault_before[2];
static char nts_fault_stack[64 << 10];

static void nts_on_fault(int signal, siginfo_t *info, void *context) {
  (void)context;
  const char *address = info->si_addr;
  /* The stack holds `[top - size, top]` and an overflow faults just below it,
   * in the guard gap (Linux keeps 1 MiB); `top` is this process's start, a
   * little under the true top, which only widens the window. A fault inside
   * the window is the stack's, since nothing else is mapped there. */
  if (address <= nts_stack_top &&
      (size_t)(nts_stack_top - address) <= nts_stack_size + ((size_t)2 << 20)) {
    static const char message[] =
        NTS_REFUSED "the call stack is exhausted: unbounded recursion, which "
                    "JavaScript ends with a RangeError this program cannot "
                    "catch\n";
    (void)!write(2, message, sizeof message - 1);
    abort();
  }
  /* Any other fault is whoever handled it before -- the default, or a
   * sanitizer's report: put that back and let the instruction fault again. */
  sigaction(signal, &nts_fault_before[signal == SIGBUS], 0);
}

static void nts_name_stack_overflow(void) {
  struct rlimit limit;
  if (getrlimit(RLIMIT_STACK, &limit) != 0 || limit.rlim_cur == RLIM_INFINITY) {
    return;
  }
  nts_stack_top = __builtin_frame_address(0);
  nts_stack_size = (size_t)limit.rlim_cur;
  /* The handler runs on a stack of its own: the one that faulted has no room
   * left for its frame. */
  stack_t alternate = {.ss_sp = nts_fault_stack,
                       .ss_size = sizeof nts_fault_stack};
  if (sigaltstack(&alternate, 0) != 0) {
    return;
  }
  struct sigaction action = {.sa_sigaction = nts_on_fault,
                             .sa_flags = SA_SIGINFO | SA_ONSTACK};
  sigemptyset(&action.sa_mask);
  sigaction(SIGSEGV, &action, &nts_fault_before[0]);
  /* Darwin reports a guard-page fault as SIGBUS. */
  sigaction(SIGBUS, &action, &nts_fault_before[1]);
}
#endif

void nts_process_start(void) {
#if defined(__GLIBC__)
  mallopt(M_MMAP_THRESHOLD, NTS_HEAP_BLOCK_LIMIT);
  mallopt(M_TOP_PAD, NTS_HEAP_TOP_KEPT);
#endif
#if !defined(_WIN32)
  nts_name_stack_overflow();
#endif
}

void nts_enter(void) { nts_env->depth++; }

void nts_leave(void) {
  if (nts_env->depth == 0) {
    fprintf(stderr, "nts: unbalanced nts_leave\n");
    abort();
  }
  nts_env->depth--;
  if (nts_env->depth != 0) {
    return;
  }
  /* A host that supplied `enqueue_microtask` checkpoints for us. */
  if (nts_env->host_installed && nts_env->host.enqueue_microtask) {
    return;
  }
  nts_process_ticks_and_rejections();
}

void nts_checkpoint(void) {
  /* The same opt-out `nts_leave` makes, for the same reason: a host that
   * supplied `enqueue_microtask` owns checkpointing, and draining here would
   * be a second ordering beside its one. */
  if (nts_env->host_installed && nts_env->host.enqueue_microtask) {
    return;
  }
  nts_process_ticks_and_rejections();
}

void nts_host_checkpoint_end(void) {
  if (!(nts_env->host_installed && nts_env->host.enqueue_microtask)) {
    fprintf(stderr, "nts: nts_host_checkpoint_end from a host that does not "
                    "own checkpointing; such a host calls nts_checkpoint\n");
    abort();
  }
  bool previous = nts_env->checkpoint_active;
  nts_env->checkpoint_active = true;
  nts_finish_checkpoint(previous);
}

void nts_task_run(NtsTask task) {
  nts_enter();
  task.run(task.state);
  nts_leave();
}

void nts_pending_begin(void) {
  if (!nts_is_owner_thread()) {
    fprintf(stderr, "nts: an operation began off the owning thread\n");
    abort();
  }
  nts_env->pending++;
  if (nts_env->host_installed && nts_env->host.pending) {
    nts_env->host.pending(nts_env->host.state, 1);
  }
}

void nts_pending_end(void) {
  if (!nts_is_owner_thread()) {
    fprintf(stderr, "nts: an operation ended off the owning thread\n");
    abort();
  }
  if (nts_env->pending == 0) {
    fprintf(stderr, "nts: an operation ended that never began\n");
    abort();
  }
  nts_env->pending--;
  if (nts_env->host_installed && nts_env->host.pending) {
    nts_env->host.pending(nts_env->host.state, -1);
  }
}

uint32_t nts_pending_count(void) { return nts_env->pending; }

bool nts_is_owner_thread(void) {
  return !nts_env->host_installed || !nts_env->host.is_owner_thread ||
         nts_env->host.is_owner_thread(nts_env->host.state);
}

NtsPromiseJoinResult nts_promise_join(NtsPromise *promise) {
  if (!nts_is_owner_thread()) {
    return NTS_JOIN_WRONG_THREAD;
  }
  /* **Joining is handling it**, and the promise has to be marked before the
     checkpoint below: a join on a rejected promise reads the reason back, which
     is an observation, and the checkpoint inside this loop would otherwise
     report it as unhandled and end the process before the join could return
     `NTS_JOIN_REJECTED`. That is not hypothetical -- it is what happened to
     `promise_join.c`'s own rejection arm the hour the report was added, which
     is why this function no longer takes a `const` promise: it observes one. */
  promise->handled = true;
  if (nts_env->depth || nts_env->checkpoint_active || nts_env->join_active) {
    return NTS_JOIN_REENTRANT;
  }
  nts_env->join_active = true;
  NtsPromiseJoinResult result;
  for (;;) {
    nts_checkpoint();
    double settled = nts_promise_state(promise);
    if (settled != NTS_PROMISE_PENDING) {
      result = settled == NTS_PROMISE_FULFILLED ? NTS_JOIN_FULFILLED
                                                : NTS_JOIN_REJECTED;
      break;
    }
    if (!nts_env->host_installed || !nts_env->host.pump_one) {
      result = NTS_JOIN_UNSUPPORTED;
      break;
    }
    NtsHostPumpResult pumped = nts_env->host.pump_one(nts_env->host.state);
    if (pumped == NTS_HOST_PUMP_TURN) {
      continue;
    }
    // The last turn can settle the promise and still report no live work.
    nts_checkpoint();
    settled = nts_promise_state(promise);
    result = settled == NTS_PROMISE_FULFILLED  ? NTS_JOIN_FULFILLED
             : settled == NTS_PROMISE_REJECTED ? NTS_JOIN_REJECTED
             : pumped == NTS_HOST_PUMP_BUSY    ? NTS_JOIN_REENTRANT
                                               : NTS_JOIN_PENDING;
    break;
  }
  nts_env->join_active = false;
  return result;
}

/* Posting is thin, and these exist for the assertion and the contract note
 * rather than for the indirection. */
void nts_post_task(NtsTask task) {
  nts_require_host("nts_post_task");
  nts_env->host.post_task(nts_env->host.state, task);
}

/* The delay every host is given: whole milliseconds, not negative, and small
 * enough to convert.
 *
 * Here rather than in each host, because it is the *contract* and not a host's
 * business -- and because leaving it to each host produced two hosts that
 * ordered the same program differently. `setTimeout(a, 1.5)` before
 * `setTimeout(b, 1.0)` ran `b` then `a` on the deterministic host, whose clock
 * is a `double`, and `a` then `b` on libuv, where both became one millisecond
 * and the tie broke by creation order. Opposite answers to the same program,
 * which is the shape of a contract bug rather than a host quirk: milliseconds
 * are the unit every platform can schedule in, so the runtime says so once.
 *
 * Truncated rather than rounded, because that is what a millisecond timer does
 * everywhere -- node included, at its own libuv boundary.
 *
 * A negative or NaN delay is zero: you cannot ask for less than "as soon as
 * possible", and the comparison is written so NaN takes that branch rather
 * than reaching a host's integer conversion, where it is undefined behaviour.
 * The ceiling is there for the same reason, and 2^53 is where a `double` stops
 * counting whole numbers. Anything a *profile* wants -- node's one-millisecond
 * floor, its 2^31 ceiling, its three warnings -- sits on top of this. */
double nts_delay(double delay_ms) {
  if (!(delay_ms > 0.0)) {
    return 0.0;
  }
  if (delay_ms > 9007199254740991.0) {
    return 9007199254740991.0;
  }
  return trunc(delay_ms);
}

NtsTimerId nts_post_delayed(NtsTask task, double delay_ms, bool repeating) {
  nts_require_host("nts_post_delayed");
  return nts_env->host.post_delayed(nts_env->host.state, task,
                                    nts_delay(delay_ms), repeating);
}

void nts_cancel_delayed(NtsTimerId id) {
  nts_require_host("nts_cancel_delayed");
  nts_env->host.cancel_delayed(nts_env->host.state, id);
}

/* The one entry point that is safe off-thread. Everything a platform completes
 * on its own thread -- OkHttp, URLSession, WinHTTP, libuv's file pool -- comes
 * home through here before it may touch the heap. */
void nts_post_from_any_thread(NtsTask task) {
  nts_require_host("nts_post_from_any_thread");
  nts_env->host.post_from_any_thread(nts_env->host.state, task);
}

/* --- Promises --------------------------------------------------------------
 *
 * Ordering is the whole substance here: reactions run in subscription order,
 * on the microtask queue, and never inline. Everything else is bookkeeping.
 */

static const uint32_t nts_reaction_offsets[] = {
    (uint32_t)offsetof(NtsReaction, state),
    (uint32_t)offsetof(NtsReaction, next),
};

/* Cyclic, both of them: a reaction's state is an async frame, and a frame can
 * hold the promise it will settle. That is an ordinary cycle and the collector
 * has to be able to see it. */
static const NtsDescriptor nts_desc_reaction = {NTS_KIND_OBJECT,
                                                (uint32_t)sizeof(NtsReaction),
                                                2u,
                                                1u,
                                                nts_reaction_offsets,
                                                0,
                                                "Reaction",
                                                0u,
                                                0,
                                                NTS_ARRAY_UNKNOWN,
                                                0u,
                                                NULL,
                                                NULL,
                                                NULL,
                                                NULL,
                                                NULL};

/* The settlement payload is *not* here: it is an erased slot, listed below, and
 * listing it in both tables would make `nts_each_reference` visit it twice --
 * doubling every retain and release, with the second release freeing something
 * still in use. */
static const uint32_t nts_promise_erased[] = {
    (uint32_t)offsetof(NtsPromise, value),
};

static const uint32_t nts_promise_offsets[] = {
    (uint32_t)offsetof(NtsPromise, reactions),
};

static const NtsDescriptor nts_desc_promise = {NTS_KIND_OBJECT,
                                               (uint32_t)sizeof(NtsPromise),
                                               1u,
                                               1u,
                                               nts_promise_offsets,
                                               0,
                                               "Promise",
                                               1u,
                                               nts_promise_erased,
                                               NTS_ARRAY_UNKNOWN,
                                               0u,
                                               NULL,
                                               nts_promise_to_string,
                                               NULL,
                                               NULL,
                                               NULL};

bool nts_is_promise(NtsValue value) {
  if (!NTS_TAG_IS_MANAGED(nts_value_tag(value))) {
    return false;
  }
  const NtsHeader *object = nts_value_reference(value);
  return object && object->descriptor == &nts_desc_promise;
}

NtsPromise *nts_promise_new(void) {
  return (NtsPromise *)nts_object_new(&nts_desc_promise);
}

static void nts_promise_require_owner(const char *what) {
  if (!nts_is_owner_thread()) {
    /* A capability adapter resolving straight from its completion thread.
     * OkHttp, URLSession, WinHTTP and libuv's file pool all complete on a
     * thread the runtime does not own, and settling a promise is a heap
     * mutation -- so this is a data race that would usually appear to work.
     * The completion has to come home to the owner thread first. */
    fprintf(stderr, "nts: %s from a thread that does not own the runtime\n",
            what);
    abort();
  }
}

/* Hand every reaction to the microtask queue, oldest subscription first.
 *
 * The chain is newest-first because subscribing prepends, so it is reversed
 * here. Reversing costs one walk and happens once; keeping a tail pointer
 * would cost the collector a second reference to every reaction. */
static void nts_promise_schedule(NtsPromise *promise) {
  NtsReaction *reaction = promise->reactions;
  promise->reactions = 0;
  NtsReaction *ordered = 0;
  while (reaction) {
    NtsReaction *next = reaction->next;
    reaction->next = ordered;
    ordered = reaction;
    reaction = next;
  }
  while (ordered) {
    NtsReaction *next = ordered->next;
    ordered->next = 0;
    NtsTask task;
    task.run = ordered->run;
    task.drop = ordered->drop;
    task.state = ordered->state;
    nts_enqueue_microtask(task);
    /* The queue holds the state now; the reaction object itself is done. */
    ordered->state = 0;
    nts_release((NtsHeader *)ordered);
    ordered = next;
  }
}

static void nts_promise_settle(NtsPromise *promise, uint8_t state) {
  promise->state = state;
  nts_promise_schedule(promise);
}

/* The tag a reference should carry, read from what it actually is. */
uint32_t nts_tag_of_reference(const NtsHeader *object) {
  if (!object) {
    return NTS_TAG_OBJECT;
  }
  switch (object->descriptor->kind) {
  case NTS_KIND_STRING:
    return NTS_TAG_STRING;
  case NTS_KIND_SYMBOL:
    return NTS_TAG_SYMBOL;
  case NTS_KIND_BIGINT:
    return NTS_TAG_BIGINT;
  default:
    /* A closure answers `"function"` and is not distinguishable here: its kind
     * is `NTS_KIND_OBJECT` like any other, and the tag it carries comes from
     * the compiler, which knows. This function is for the values that arrive
     * without one. */
    return NTS_TAG_OBJECT;
  }
}

/* Every fulfilment is the same store. The helpers differ only in the tag they
 * know at compile time, and `nts_promise_fulfill_value` is the one that does
 * not know it and is told. */
static void nts_promise_fulfill(NtsPromise *promise, NtsValue value) {
  /* A handle included, which the promise's death gives back as any container
   * does -- unreached while a promise boxes a handle. */
  nts_value_retain(value);
  promise->value = value;
  nts_promise_settle(promise, NTS_PROMISE_FULFILLED);
}

void nts_promise_fulfill_void(NtsPromise *promise) {
  nts_promise_require_owner("nts_promise_fulfill_void");
  if (promise->state != NTS_PROMISE_PENDING) {
    return;
  }
  nts_promise_fulfill(promise, nts_value_of_undefined());
}

void nts_promise_fulfill_number(NtsPromise *promise, double number) {
  nts_promise_require_owner("nts_promise_fulfill_number");
  if (promise->state != NTS_PROMISE_PENDING) {
    return;
  }
  nts_promise_fulfill(promise, nts_value_of_number(number));
}

void nts_promise_fulfill_tagged(NtsPromise *promise, NtsHeader *object,
                                uint32_t tag) {
  nts_promise_require_owner("nts_promise_fulfill_tagged");
  if (promise->state != NTS_PROMISE_PENDING) {
    return;
  }
  nts_promise_fulfill(promise, nts_value_of_reference(object, tag));
}

/* For a caller that has a reference and does not know which kind.
 *
 * The derivation is two comparisons and it is here rather than in the fulfil
 * path, so a caller that *does* know -- the compiler, always -- calls
 * `nts_promise_fulfill_tagged` and pays nothing. Without deriving somewhere, a
 * promise fulfilled with a string, raced, then awaited as `unknown` would
 * answer `typeof` with "object". */
void nts_promise_fulfill_reference(NtsPromise *promise, NtsHeader *object) {
  nts_promise_fulfill_tagged(promise, object, nts_tag_of_reference(object));
}

static void nts_promise_validate_value(NtsValue value) {
  uint32_t tag = nts_value_tag(value);
  if (tag > NTS_TAG_NULL && !NTS_TAG_IS_HANDLE(tag) && tag != NTS_TAG_BIGINT) {
    fprintf(stderr, "nts: settled a promise with an unknown value tag\n");
    abort();
  }
}

void nts_promise_fulfill_value(NtsPromise *promise, NtsValue value) {
  nts_promise_require_owner("nts_promise_fulfill_value");
  if (promise->state != NTS_PROMISE_PENDING) {
    return;
  }
  nts_promise_validate_value(value);
  nts_promise_fulfill(promise, value);
}

/* Both rejection entry points arrive here after owner/state checks. Store the
 * exact tagged value once; a reference is owned through the erased slot. */
static void nts_promise_reject_store(NtsPromise *promise, NtsValue reason) {
  /* Asked **before** settling, because settling consumes the list: it reverses
     the reactions into subscription order and queues them, leaving `reactions`
     null whether or not there were any. */
  bool listened = promise->reactions != 0 || promise->handled;
  nts_value_retain(reason);
  promise->value = reason;
  nts_promise_settle(promise, NTS_PROMISE_REJECTED);
  if (!listened) {
    nts_rejection_candidate(promise);
  }
}

void nts_promise_reject(NtsPromise *promise, NtsHeader *reason) {
  nts_promise_require_owner("nts_promise_reject");
  if (promise->state != NTS_PROMISE_PENDING) {
    return;
  }
  nts_promise_reject_store(
      promise,
      reason ? nts_value_of_reference(reason, nts_tag_of_reference(reason))
             : nts_value_of_undefined());
}

void nts_promise_subscribe(NtsPromise *promise, NtsTask reaction) {
  nts_promise_require_owner("nts_promise_subscribe");
  /* Before the settled test, so that subscribing to an *already rejected*
     promise handles it: that is the `p.catch(...)` written on the line after
     the rejection, and it is inside the same turn. */
  promise->handled = true;
  if (promise->state != NTS_PROMISE_PENDING) {
    /* Settled already -- but still a microtask, not an inline call. Running it
     * here would resolve one tick early, and the difference is observable
     * through interleaving with any other pending promise. */
    nts_enqueue_microtask(reaction);
    return;
  }
  NtsReaction *entry = (NtsReaction *)nts_object_new(&nts_desc_reaction);
  entry->run = reaction.run;
  entry->drop = reaction.drop;
  entry->state = (NtsHeader *)reaction.state;
  entry->next = promise->reactions;
  promise->reactions = entry;
}

double nts_promise_number(const NtsPromise *promise) {
  if (promise->state != NTS_PROMISE_FULFILLED ||
      nts_value_tag(promise->value) != NTS_TAG_NUMBER) {
    fprintf(stderr,
            "nts: read a number from a promise holding something else\n");
    abort();
  }
  return nts_value_number(promise->value);
}

void nts_promise_fulfill_pointer(NtsPromise *promise, void *pointer) {
  nts_promise_require_owner("nts_promise_fulfill_pointer");
  if (promise->state != NTS_PROMISE_PENDING) {
    return;
  }
  NtsValue value = nts_value_of_undefined();
  value.as.native = pointer;
  promise->native = true;
  nts_promise_fulfill(promise, value);
}

void *nts_promise_pointer(const NtsPromise *promise) {
  if (promise->state != NTS_PROMISE_FULFILLED || !promise->native) {
    fprintf(stderr,
            "nts: read a C handle from a promise holding something else\n");
    abort();
  }
  return promise->value.as.native;
}

NtsHeader *nts_promise_reference(const NtsPromise *promise) {
  if (promise->state != NTS_PROMISE_FULFILLED ||
      !NTS_TAG_IS_MANAGED(nts_value_tag(promise->value))) {
    fprintf(stderr,
            "nts: read a reference from a promise holding something else\n");
    abort();
  }
  return nts_value_reference(promise->value);
}

/* No assertion about *how* it was settled, only that it was.
 *
 * The typed readers above assert because the compiler claimed to know which
 * kind it was and a mismatch is a compiler bug. This one is called exactly
 * when the compiler does not know, so there is nothing to check beyond the
 * tag being present -- and every fulfilment writes one. */
NtsValue nts_promise_value(const NtsPromise *promise) {
  if (promise->state != NTS_PROMISE_FULFILLED) {
    fprintf(stderr,
            "nts: read an erased value from a promise that is not fulfilled\n");
    abort();
  }
  /* An assertion, not a policy: lowering never reads a handle-carrying
   * promise through the erased reader, and if it ever did, `undefined` in
   * the handle's place would be a wrong answer rather than a refusal. */
  if (promise->native) {
    fprintf(stderr, "nts: read a C handle from a promise as a value\n");
    abort();
  }
  return promise->value;
}

/* Whether an `await` has to propagate a rejection instead of reading a value.
 *
 * The resumed state machine asks this before it reads the payload, because a
 * rejected promise has no payload to read -- both readers assert, so an
 * `await` of a rejected promise aborted the program until this existed. */
bool nts_promise_is_rejected(const NtsPromise *promise) {
  return promise->state == NTS_PROMISE_REJECTED;
}

/* Keep the complete tagged reason, including non-reference values. */
void nts_promise_reject_value(NtsPromise *promise, NtsValue reason) {
  nts_promise_require_owner("nts_promise_reject_value");
  if (promise->state != NTS_PROMISE_PENDING) {
    return;
  }
  nts_promise_validate_value(reason);
  nts_promise_reject_store(promise, reason);
}

NtsValue nts_promise_reason(const NtsPromise *promise) {
  if (promise->state != NTS_PROMISE_REJECTED) {
    fprintf(stderr,
            "nts: read a rejection reason from a promise that has none\n");
    abort();
  }
  return promise->value;
}

void nts_promise_reject_with(NtsPromise *result, const NtsPromise *source) {
  if (source->state != NTS_PROMISE_REJECTED) {
    fprintf(stderr,
            "nts: forwarded a rejection from a promise that has none\n");
    abort();
  }
  nts_promise_reject_value(result, source->value);
}

/* --- Combinators: `Promise.all` and `Promise.race` --------------------------
 *
 * Both are the same machine with two dials: how many settlements it waits for,
 * and whether it keeps the values. `all` waits for every fulfilment and fills
 * an array; `race` takes the first settlement of either kind and forwards it.
 * Writing them as one is not a saving -- it is the claim that they *are* one,
 * which is what the specification says: each subscribes to every element, in
 * order, before returning, and the result promise settles once.
 *
 * The combinator holds no type. `all`'s result array is allocated by the
 * compiler and handed in, because whether a payload is a double or a pointer
 * is a fact about the type and the compiler is the only party that has it --
 * and an array already carries its descriptor, so passing one says it once.
 */

typedef struct NtsCombinator {
  NtsHeader header;
  NtsPromise *result;
  /* The array being filled, or null for `race`, which keeps no values. */
  NtsArray *values;
  /* Fulfilments still owed. A rejection does not decrement it: `all` rejects
   * outright, and a count that could still reach zero afterwards would
   * fulfil a promise that is already rejected. The second settle would be
   * ignored, so this is belt and braces -- but the invariant worth having is
   * that zero *means* every element fulfilled. */
  uint32_t remaining;
} NtsCombinator;

/* One element's share: which combinator, which promise, and which slot of the
 * result it fills. A separate object per element rather than an index baked
 * into a closure, because a reaction's state is one managed reference and the
 * collector reaches the combinator through it. */
typedef struct NtsCombinatorSlot {
  NtsHeader header;
  NtsCombinator *combinator;
  NtsPromise *source;
  uint32_t index;
} NtsCombinatorSlot;

static const uint32_t nts_combinator_offsets[] = {
    (uint32_t)offsetof(NtsCombinator, result),
    (uint32_t)offsetof(NtsCombinator, values),
};

/* Cyclic: a slot points at the combinator, the combinator's result promise
 * holds reactions, and a reaction's state is a slot. */
static const NtsDescriptor nts_desc_combinator = {
    NTS_KIND_OBJECT,
    (uint32_t)sizeof(NtsCombinator),
    2u,
    1u,
    nts_combinator_offsets,
    0,
    "Combinator",
    0u,
    0,
    NTS_ARRAY_UNKNOWN,
    0u,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL};

static const uint32_t nts_combinator_slot_offsets[] = {
    (uint32_t)offsetof(NtsCombinatorSlot, combinator),
    (uint32_t)offsetof(NtsCombinatorSlot, source),
};

static const NtsDescriptor nts_desc_combinator_slot = {
    NTS_KIND_OBJECT,
    (uint32_t)sizeof(NtsCombinatorSlot),
    2u,
    1u,
    nts_combinator_slot_offsets,
    0,
    "CombinatorSlot",
    0u,
    0,
    NTS_ARRAY_UNKNOWN,
    0u,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL};

/* Copy a settled promise's payload onto another promise. `race` is exactly
 * this, and `all`'s rejection is the same thing for the rejected case. */
static void nts_promise_forward(NtsPromise *to, const NtsPromise *from) {
  if (from->state == NTS_PROMISE_REJECTED) {
    nts_promise_reject_value(to, from->value);
    return;
  }
  /* One arm, because there is one payload. `undefined` needs no case of its
   * own -- it is a tag like any other -- which is what the old `default:`
   * quietly stood in for, and what made an erased payload fulfil with
   * `undefined` when its arm was missing. */
  if (from->native) {
    nts_promise_fulfill_pointer(to, from->value.as.native);
    return;
  }
  nts_promise_fulfill_value(to, from->value);
}

/* One element settled. */
static void nts_combinator_settled(void *state) {
  NtsCombinatorSlot *slot = (NtsCombinatorSlot *)state;
  NtsCombinator *all = slot->combinator;

  if (!all->values) {
    /* `race`: the first settlement of either kind wins, and a later one meets
     * an already-settled promise, which ignores it. */
    nts_promise_forward(all->result, slot->source);
  } else if (slot->source->state == NTS_PROMISE_REJECTED) {
    nts_promise_reject_value(all->result, slot->source->value);
  } else {
    /* An assertion: lowering refuses `Promise.all` over promises of C
     * handles (`combinator` in `hir/lower.rs` asks, rather than relying on
     * `Array<NativePointer>` being unrepresentable). */
    if (slot->source->native) {
      fprintf(stderr, "nts: a C handle settled a promise in `Promise.all`\n");
      abort();
    }
    /* By the element kind the array was laid out with. `references` alone
     * answered "a pointer, else a double", and an erased array holds 16-byte
     * tagged values while a boolean one holds a byte a slot: the first read
     * every result back as `undefined`, the second wrote eight bytes into each
     * one-byte slot and corrupted the heap past the array's end. A kind not
     * listed is refused rather than guessed at, as the descriptor asks. */
    NtsArray *values = all->values;
    NtsValue settled = slot->source->value;
    const NtsDescriptor *laid = values->header.descriptor;
    if (laid->element == NTS_ARRAY_VALUE) {
      nts_value_retain(settled);
      NTS_ITEMS(values, NtsValue)[slot->index] = settled;
    } else if (laid->element == NTS_ARRAY_REFERENCE) {
      NtsHeader *value = nts_value_reference(settled);
      nts_retain(value);
      NTS_ITEMS(values, NtsHeader *)[slot->index] = value;
    } else if (laid->element == NTS_ARRAY_BOOL) {
      /* A typed boolean promise is settled through
       * `nts_promise_fulfill_number`, as 0 or 1, and an erased one with a
       * boolean: truthiness reads both. */
      NTS_ITEMS(values, bool)[slot->index] = nts_value_truthy(settled);
    } else if (laid->element == NTS_ARRAY_FLOAT &&
               laid->size == sizeof(double)) {
      NTS_ITEMS(values, double)[slot->index] = nts_value_number(settled);
    } else {
      fprintf(stderr,
              "nts: `Promise.all` given a result array of element kind %u, "
              "which it cannot store into\n",
              laid->element);
      abort();
    }
    if (--all->remaining == 0) {
      nts_promise_fulfill_reference(all->result, (NtsHeader *)all->values);
    }
  }

  /* The queue's reference, given back by running. */
  nts_release((NtsHeader *)slot);
}

static void nts_combinator_drop(void *state) {
  nts_release((NtsHeader *)state);
}

/* Subscribe to every element, in order, before returning.
 *
 * Eagerly and synchronously: the specification iterates the argument inside
 * the call, and a program can tell -- an element that settles between the call
 * and a later subscription would be missed by a lazy one. */
static NtsPromise *nts_combinator_new(NtsArray *promises, NtsArray *values) {
  nts_promise_require_owner("a promise combinator");

  NtsCombinator *all = (NtsCombinator *)nts_object_new(&nts_desc_combinator);
  all->result = nts_promise_new();
  all->values = values;
  /* Its own reference, because the caller keeps one. The compiler passes both
   * arrays as arguments and releases them after the call -- they are borrowed,
   * like every other argument -- while this field is listed in the descriptor
   * and released when the combinator dies. Storing without retaining made that
   * a reference nobody had taken, and the array was freed three times: once by
   * the caller's release, once by the combinator's, and once by the result
   * promise, which retains it at fulfilment.
   *
   * It read as a `Promise.all` that answered wrongly, and only when something
   * else disturbed the allocator: freed memory that no one has reused still
   * holds the right numbers. */
  nts_retain((NtsHeader *)values);
  all->remaining = promises->header.length;

  /* `Promise.all([])` is fulfilled by the time it is returned, with an empty
   * array. `Promise.race([])` is pending forever, which is not a special case
   * here so much as the absence of one: nothing was subscribed, so nothing
   * will ever settle it. */
  if (values && promises->header.length == 0) {
    nts_promise_fulfill_reference(all->result, (NtsHeader *)values);
  }

  for (uint32_t i = 0; i < promises->header.length; i++) {
    NtsPromise *source = NTS_ITEMS(promises, NtsPromise *)[i];
    NtsCombinatorSlot *slot =
        (NtsCombinatorSlot *)nts_object_new(&nts_desc_combinator_slot);
    slot->combinator = all;
    nts_retain((NtsHeader *)all);
    slot->source = source;
    nts_retain((NtsHeader *)source);
    slot->index = i;
    nts_promise_subscribe(
        source, (NtsTask){nts_combinator_settled, nts_combinator_drop, slot});
  }

  NtsPromise *result = all->result;
  nts_retain((NtsHeader *)result);
  nts_release((NtsHeader *)all);
  return result;
}

NtsPromise *nts_promise_all(NtsArray *promises, NtsArray *values) {
  if (values->header.length != promises->header.length) {
    /* The compiler allocates `values` with the length of `promises`, so a
     * mismatch is a compiler bug and the next line would write past the end
     * of the array. Cheaper to say so than to debug the corruption. */
    fprintf(stderr,
            "nts: `Promise.all` given a result array of the wrong size\n");
    abort();
  }
  return nts_combinator_new(promises, values);
}

NtsPromise *nts_promise_race(NtsArray *promises) {
  return nts_combinator_new(promises, 0);
}

/* --- Adoption: a promise settled with another promise ----------------------
 *
 * `async function f() { return g(); }`. The outer promise does not take the
 * inner *promise* as its value; it takes the inner's eventual settlement, and
 * it takes it two microtasks later. Both halves are observable, which is why
 * this is a runtime operation rather than a copy at the settle site.
 *
 * **Two hops, and the specification says which two.** Resolving a promise with
 * a thenable enqueues `NewPromiseResolveThenableJob`, which is the first; that
 * job subscribes, and the subscription's reaction is the second. So a `return
 * g()` whose `g()` has already settled still resolves one tick after a `return
 * await g()` would -- measured against node before this was written, with a
 * chain of eight microtasks to count against:
 *
 *     tick0 tick1 AWAIT tick2 ADOPT tick3 ...
 *
 * Collapsing the two into one subscription would resolve a tick early, which is
 * the same mistake `nts_promise_subscribe` documents itself against for an
 * already-settled promise. */
typedef struct NtsAdoption {
  NtsHeader header;
  NtsPromise *outer;
  NtsPromise *inner;
} NtsAdoption;

static const uint32_t nts_adoption_offsets[] = {
    (uint32_t)offsetof(NtsAdoption, outer),
    (uint32_t)offsetof(NtsAdoption, inner),
};

static const NtsDescriptor nts_desc_adoption = {NTS_KIND_OBJECT,
                                                (uint32_t)sizeof(NtsAdoption),
                                                2u,
                                                1u,
                                                nts_adoption_offsets,
                                                0,
                                                "Adoption",
                                                0u,
                                                0,
                                                NTS_ARRAY_UNKNOWN,
                                                0u,
                                                NULL,
                                                NULL,
                                                NULL,
                                                NULL,
                                                NULL};

static void nts_adoption_drop(void *state) { nts_release((NtsHeader *)state); }

/* The inner settled: copy it across. `nts_promise_forward` is the same payload
 * copy `race` makes, and for the same reason -- there is one payload and the
 * rejected arm is the only one that needs telling apart. */
static void nts_adoption_settled(void *state) {
  NtsAdoption *adoption = (NtsAdoption *)state;
  nts_promise_forward(adoption->outer, adoption->inner);
  /* The reaction's reference, given back by running. */
  nts_release((NtsHeader *)adoption);
}

/* The first hop. Subscribing here rather than in `nts_promise_adopt` is the
 * whole of the tick this costs, and the reference the queue held passes
 * straight to the subscription. */
static void nts_adoption_begin(void *state) {
  NtsAdoption *adoption = (NtsAdoption *)state;
  nts_promise_subscribe(
      adoption->inner,
      (NtsTask){nts_adoption_settled, nts_adoption_drop, adoption});
}

void nts_promise_adopt(NtsPromise *outer, NtsPromise *inner) {
  nts_promise_require_owner("nts_promise_adopt");
  NtsAdoption *adoption = (NtsAdoption *)nts_object_new(&nts_desc_adoption);
  adoption->outer = outer;
  nts_retain((NtsHeader *)outer);
  adoption->inner = inner;
  nts_retain((NtsHeader *)inner);
  nts_enqueue_microtask(
      (NtsTask){nts_adoption_begin, nts_adoption_drop, adoption});
}

uint32_t nts_promise_pair(const NtsPromise *promise) {
  return promise->resolutions;
}

void nts_promise_resolve_value(NtsPromise *promise, NtsValue value) {
  nts_promise_require_owner("nts_promise_resolve_value");
  if (nts_is_promise(value)) {
    nts_promise_adopt(promise, (NtsPromise *)nts_value_reference(value));
    return;
  }
  nts_promise_fulfill_value(promise, value);
}

bool nts_promise_claim(NtsPromise *promise, uint32_t pair) {
  nts_promise_require_owner("nts_promise_claim");
  if (promise->resolutions != pair) {
    return false;
  }
  /* Each use is at least one microtask of thenable after thenable resolving
   * one promise, so this is out of reach of any program that finishes -- and
   * wrapping would make the executor's pair live again, which is a wrong
   * answer where stopping is only a refusal. */
  if (pair == UINT32_MAX) {
    fprintf(stderr, "nts: a promise resolved through more than %u thenables\n",
            (unsigned)UINT32_MAX);
    abort();
  }
  promise->resolutions = pair + 1;
  return true;
}

/* --- Timers, as a program calls them (docs/records/notebooks/async.md 8, phase
 * C) -------------
 *
 * `setTimeout` and its family are a *capability*, not part of the host
 * contract: a host provides `post_delayed`, and this is the surface built on
 * it. That is why they live here rather than in a host -- both hosts get them
 * unchanged, which is what makes `setTimeout` ordering testable against node
 * on the deterministic one.
 *
 * The callback is a closure, which in this compiler is an object with a
 * method table, so calling it needs the object and a slot. `NtsTask` has room
 * for one state pointer, so the pair becomes a small managed object -- the
 * same shape a promise reaction uses, and traced the same way.
 */

typedef struct {
  NtsHeader header;
  NtsHeader *callback;
  uint32_t slot;
} NtsCallback;

static const uint32_t nts_callback_offsets[] = {
    (uint32_t)offsetof(NtsCallback, callback),
};

static const NtsDescriptor nts_desc_callback = {NTS_KIND_OBJECT,
                                                (uint32_t)sizeof(NtsCallback),
                                                1u,
                                                1u,
                                                nts_callback_offsets,
                                                0,
                                                "Callback",
                                                0u,
                                                0,
                                                NTS_ARRAY_UNKNOWN,
                                                0u,
                                                NULL,
                                                NULL,
                                                NULL,
                                                NULL,
                                                NULL};

static void nts_callback_call(NtsCallback *entry) {
  NtsHeader *callback = entry->callback;
  /* The same cast the emitter makes at every closure call site: the table
   * stores untyped pointers and the caller spells the signature. A timer
   * callback takes nothing and returns nothing, so there is one signature
   * here rather than a family. */
  ((void (*)(NtsHeader *))callback->descriptor->methods[entry->slot])(callback);
}

/* A one-shot: running it is the last thing that happens to it, so running is
 * also what gives the reference back. */
static void nts_callback_run_once(void *state) {
  NtsCallback *entry = (NtsCallback *)state;
  nts_callback_call(entry);
  nts_release((NtsHeader *)entry);
}

/* An interval: the host runs the same task again and again, so the reference
 * is given back once, by `drop`, when it is finally cancelled. Releasing here
 * would free it under the timer that is still holding it. */
static void nts_callback_run_repeating(void *state) {
  nts_callback_call((NtsCallback *)state);
}

static void nts_callback_drop(void *state) { nts_release((NtsHeader *)state); }

NtsTask nts_callback_task(NtsHeader *callback, double slot, bool repeating) {
  NtsCallback *entry = (NtsCallback *)nts_object_new(&nts_desc_callback);
  entry->callback = callback;
  nts_retain(callback);
  entry->slot = (uint32_t)slot;
  NtsTask task;
  task.run = repeating ? nts_callback_run_repeating : nts_callback_run_once;
  task.drop = nts_callback_drop;
  task.state = entry;
  return task;
}

void nts_enqueue_job(NtsHeader *callback, double slot) {
  nts_enqueue_microtask(nts_callback_task(callback, slot, false));
}

double nts_set_timeout(NtsHeader *callback, double slot, double delay_ms,
                       bool repeating) {
  return (double)nts_post_delayed(nts_callback_task(callback, slot, repeating),
                                  delay_ms, repeating);
}

void nts_clear_timeout(double id) {
  /* A timer that already fired, or an id from another turn: the host's slot
   * table says so and this is a no-op, which is what `clearTimeout`
   * specifies. */
  nts_cancel_delayed((NtsTimerId)id);
}
