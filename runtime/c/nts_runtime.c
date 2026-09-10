/* The Native TypeScript C runtime: the half that allocates or is too large to
 * inline. See nts_runtime.h for why this is a translation unit rather than text
 * pasted into every generated file.
 *
 * The system headers a runtime needs -- <stdio.h>, <stdlib.h>, <string.h> --
 * are confined here. That is the point: a generated file no longer picks up the
 * hundreds of names they declare, so a TypeScript `function div()` no longer
 * collides with C's.
 */

/* Before any system header, which is what a feature-test macro requires.
 * quickjs-ng's `cutils.h`, which `dtoa.c` below includes, reaches for
 * `clock_gettime`, `readlink` and `pthread_condattr_setclock` -- none of which
 * strict ISO C declares, and the differential compiles with `-std=c11`. */
#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif

#include "nts_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Double to decimal, which is a specification rather than a `printf`.
 *
 * Included rather than compiled beside, and that is deliberate: several places
 * build a program and each names its `.c` files explicitly -- one of them is
 * `tooling/conformance/build.sh`, which this session does not own. A second
 * translation unit would need all of them to agree; a header-style include
 * needs none of them to change, and the file is emitted into a `quickjs/`
 * subdirectory of the output so this path resolves the same whether the runtime
 * is compiled from `runtime/c` or from an emitted directory.
 *
 * What it replaces: `nts_shortest_digits` found the shortest round-tripping
 * representation by calling `snprintf("%.*e")` and `strtod` at every precision
 * from 1 to 17 until one read back. That is correct -- it verifies -- and it
 * cost 867ns to render `1234567`, which is seven of those round trips.
 * `js_dtoa` computes it, produces byte-identical output on every value tested,
 * and does the same number in 7.4ns.
 *
 * clang-tidy flags including a `.c`, and it is right to: it usually means
 * somebody meant the header. Here it is the point -- the file must not become
 * a translation unit of its own -- so the check is suppressed at the line with
 * the reason above it rather than turned off. */
/* Vendored code is held to upstream's warning standard, not ours, and the
 * pragmas are pushed and popped around it so that everything below is still
 * compiled with all of them on. `runtime_checkpoint` builds with `-Werror
 * -Wunused-parameter` and `cutils.h` has four `static` helpers that ignore an
 * argument, which is how this was found. */
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
/* NOLINTNEXTLINE(bugprone-suspicious-include) */
#include "quickjs/dtoa.c"
#if defined(__clang__) || defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

/* And ours, which replaces `js_dtoa` for everything it can prove. */
#include "nts_grisu.h"

/* One environment: everything a runtime owns that a second runtime must not
 * see (RFC 17.1).
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
  /* -- one cache line: the reference-counting and allocation hot path -- */
  size_t retains;
  size_t releases;
  size_t roots_len;
  size_t roots_cap;
  NtsHeader **roots;
  size_t candidates;
  size_t bytes_held;
  bool draining;
  bool collecting;

  /* -- allocation -- */
#ifndef NTS_PROVIDER_RC
  unsigned char *bump;
  size_t bump_left;
#endif
#if NTS_RECYCLES
  void *recycled[NTS_CLASSES];
#endif

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
  uint32_t depth;
  NtsQueue microtask_queue;
  NtsQueue tick_queue;
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

/* Cyclic, because one descriptor serves every array of references and says
   nothing about what the elements point at. */
const NtsDescriptor nts_desc_ref = {
    NTS_KIND_ARRAY,     sizeof(void *), 1, 1, 0, 0, "reference", 0u, 0,
    NTS_ARRAY_REFERENCE};
const NtsDescriptor nts_desc_string1 = {
    NTS_KIND_STRING, 1, 0, 0, 0, 0, "string", 0u, 0, NTS_ARRAY_UNKNOWN};
const NtsDescriptor nts_desc_string2 = {
    NTS_KIND_STRING, 2, 0, 0, 0, 0, "string", 0u, 0, NTS_ARRAY_UNKNOWN};

/* The NoGC provider (RFC 9.1): a bump allocator that never frees. For compiler
 * bring-up, allocation testing and bounded-lifetime tools. It must never be
 * selected silently for a general application. */
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
 * direction: RFC 9.2's counting already knows what 9.3's collector would have
 * to discover. */
/* Declared only where it is used. Every use is behind `NTS_RECYCLES`, and a
 * declaration that is not makes an AddressSanitizer build -- the one case that
 * turns recycling off -- fail on `-Wunused-variable`, which the tests build
 * with `-Werror`. */
#endif

void *nts_alloc(size_t bytes) {
  bytes = (bytes + 15u) & ~(size_t)15u;
  nts_env->bytes_held += bytes;

#ifdef NTS_PROVIDER_RC
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
    return (unsigned char *)block + 16u;
  }
#endif
  size_t *block = (size_t *)malloc(bytes + 16u);
  if (!block) {
    fprintf(stderr, "nts: out of memory\n");
    abort();
  }
  *block = bytes;
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

/* Whether an array's elements still sit in the block the array itself lives in.
 *
 * The one growth that moves them out is the only thing that makes this false,
 * and two places need to know: the grow path, which must not free the inline
 * block, and reclamation, which must free every other one. */
static bool nts_array_is_inline(const NtsArray *array) {
  return array->elements == (const unsigned char *)array + sizeof(NtsArray);
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
static void nts_free_storage(NtsHeader *object) {
  /* A map owns three of them, and a Set two -- the same question the array
   * above answers, asked of the type that made the question worth asking. */
  if (object->descriptor->kind == NTS_KIND_MAP) {
    NtsMap *map = (NtsMap *)object;
    nts_env->bytes_held -= (size_t)map->capacity * sizeof(NtsValue);
    nts_env->bytes_held -= (size_t)map->slots * sizeof(int32_t);
    if (map->values) {
      nts_env->bytes_held -= (size_t)map->capacity * sizeof(NtsValue);
    }
    /* Paired with the `nts_note_allocation` in `nts_map_rehash`, the same way
     * the rehash pairs the one it replaces. A table that was never grown has no
     * block and none to give back. */
    if (map->keys) {
      nts_env->reclaimed++;
    }
    /* `keys` is the block: `values` and `index` point into it. */
    free(map->keys);
    map->keys = 0;
    map->values = 0;
    map->index = 0;
    return;
  }
  /* The bytes an `ArrayBuffer` owns. A transferred buffer already gave them
   * back and says so by having none. */
  if (object->descriptor->kind == NTS_KIND_BUFFER) {
    NtsBuffer *buffer = (NtsBuffer *)object;
    if (buffer->bytes) {
      nts_env->bytes_held -= buffer->reserved_bytes;
      nts_env->reclaimed++;
      free(buffer->bytes);
      buffer->bytes = 0;
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
    free(array->elements);
    array->elements = 0;
  }
}

/* Reclaim an object: what hangs off it, then the block itself. */
static void nts_free(NtsHeader *object) {
  nts_free_storage(object);
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
  object->reserved = 1;
  nts_note_allocation();
  return object;
}

/* Reference counting (RFC 9.2). The count lives in the header's
 * provider-reserved word, which is unused under NoGC and is this under RC.
 *
 * Not atomic. A runtime owns its heap (RFC 17.1) and a managed reference does
 * not cross between runtimes, so the count is only ever touched by one thread.
 * Making it atomic would cost every retain a locked instruction to defend
 * against sharing the design does not permit. */
void nts_retain(NtsHeader *object) {
  nts_env->retains++;
  if (!object || object->reserved == NTS_IMMORTAL ||
      (object->flags & NTS_DYING) != 0) {
    return;
  }
  object->reserved++;
  /* A reference was added, so this is reachable from somewhere and is not a
   * candidate for anything. */
  object->flags = (object->flags & ~NTS_COLOR_MASK) | NTS_BLACK;
}

/* Every reference an object holds, handed one at a time to `visit`.
 *
 * The three walks the collector does and the one destruction does differ only
 * in what they do with each child, so the walking is written once. */
static void nts_each_reference(NtsHeader *object, void (*visit)(NtsHeader *)) {
  const NtsDescriptor *descriptor = object->descriptor;
  if (descriptor->references == 0 && descriptor->erased == 0) {
    return;
  }
  /* A map's references are in two heap arrays rather than at fixed offsets,
   * so it gets a case here for the same reason an array does. Holes carry a
   * tag that is not a reference, so skipping them needs no test of its own. */
  if (descriptor->kind == NTS_KIND_MAP) {
    const NtsMap *map = (const NtsMap *)object;
    for (uint32_t at = 0; at < map->used; at++) {
      NtsValue key = map->keys[at];
      if (NTS_TAG_IS_REFERENCE(nts_value_tag(key)) &&
          nts_value_reference(key)) {
        visit(nts_value_reference(key));
      }
      if (!map->values) {
        continue;
      }
      NtsValue value = map->values[at];
      if (NTS_TAG_IS_REFERENCE(nts_value_tag(value)) &&
          nts_value_reference(value)) {
        visit(nts_value_reference(value));
      }
    }
    return;
  }
  if (descriptor->kind == NTS_KIND_ARRAY) {
    /* An array of erased values: every element is an `NtsValue` and each one
     * is a reference only when its own tag says so. */
    if (descriptor->erased) {
      NtsValue *slots = NTS_ITEMS((const NtsArray *)object, NtsValue);
      for (uint32_t index = 0; index < object->length; index++) {
        if (NTS_TAG_IS_REFERENCE(nts_value_tag(slots[index])) &&
            nts_value_reference(slots[index])) {
          visit(nts_value_reference(slots[index]));
        }
      }
      return;
    }
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
   * This is the single traversal: `nts_release_contents` and all four passes of
   * the cycle collector go through here, so teaching it about erased slots
   * teaches the whole collector at once. That is the reason an erased value is
   * stored whole rather than decomposed into a tag beside a typed slot at every
   * kind of storage -- one concept here, against a parallel tag slot in object
   * layout, array layout, globals and closure captures. */
  for (uint32_t index = 0; index < descriptor->erased; index++) {
    unsigned char *slot =
        (unsigned char *)object + descriptor->erased_offsets[index];
    NtsValue value = *(const NtsValue *)slot;
    if (NTS_TAG_IS_REFERENCE(nts_value_tag(value)) &&
        nts_value_reference(value)) {
      visit(nts_value_reference(value));
    }
  }
}

/* The out-of-line half of erased strict equality. Declared beside the inline
 * scalar forms in the header; here because they call through pointers. */
bool nts_value_eq_string(NtsValue value, const NtsString *text) {
  return value.tag == NTS_TAG_STRING &&
         nts_string_eq((const NtsString *)value.as.reference, text);
}

bool nts_value_eq_reference(NtsValue value, const NtsHeader *reference) {
  return NTS_TAG_IS_REFERENCE(value.tag) && value.as.reference == reference;
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
  case NTS_TAG_STRING:
    return nts_string_eq((const NtsString *)a.as.reference,
                         (const NtsString *)b.as.reference);
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
    return value;
  }
  unsigned width = (unsigned)bits;
  /* `ToIndex` truncates, so a width in (0, 1) is a width of zero -- and the
   * signed path below shifts by `width - 1`, which underflows to a shift count
   * no C shift has. The test above admits `0.5` because it asks about the
   * *double*; this asks about what the conversion produced. Zero bits of a
   * value is zero. Every other unsupported width still refuses above. */
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
 * The domain is 128 bits, so `1n << 200n` is 0 here where node grows the
 * number instead. That is the same boundary `nts_bigint_as_intn` works within
 * and the same one the lowering refuses literals outside of. */

/* Left, on the unsigned twin so a negative value's shift is defined. */
static __int128 nts_bigint_up(__int128 value, unsigned count) {
  if (count >= 128u) {
    return 0;
  }
  return (__int128)((unsigned __int128)value << count);
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
  return count >= 128 ? 0 : nts_bigint_up(value, (unsigned)count);
}

__int128 nts_bigint_shr(__int128 value, __int128 count) {
  if (count < 0) {
    return count <= -128 ? 0 : nts_bigint_up(value, (unsigned)-count);
  }
  return count >= 128 ? (value < 0 ? (__int128)-1 : (__int128)0)
                      : nts_bigint_down(value, (unsigned)count);
}

/* Claim and give up what an erased value holds. */
void nts_value_retain(NtsValue value) {
  if (NTS_TAG_IS_REFERENCE(nts_value_tag(value)) &&
      nts_value_reference(value)) {
    nts_retain(nts_value_reference(value));
  }
}

void nts_value_release(NtsValue value) {
  if (NTS_TAG_IS_REFERENCE(nts_value_tag(value)) &&
      nts_value_reference(value)) {
    nts_release(nts_value_reference(value));
  }
}

/* Give up what a dying object was holding.
 *
 * A field is a slot with an owner, so an object that is about to stop existing
 * has to release everything its slots hold -- otherwise a tree of objects leaks
 * everything below its root, which is the shape of leak that looks like it
 * works right up until it doesn't. */
static void nts_release_contents(NtsHeader *object) {
  nts_each_reference(object, nts_release);
}

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
    /* This may link more objects into the list, which the loop picks up. */
    nts_release_contents(dead);
    nts_env->reclaimed++;
    nts_free(dead);
  }
  nts_env->draining = false;
}

/* --- The cycle collector (RFC 9.2) -----------------------------------------
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

/* A release that did not reach zero. It might have cut the last reference from
 * outside a cycle, so the object is worth looking at later -- unless its type
 * cannot lead back to itself, in which case there is nothing to look for. */
static void nts_possible_root(NtsHeader *object) {
  if (!object->descriptor->cyclic || nts_color(object) == NTS_PURPLE) {
    return;
  }
  nts_paint(object, NTS_PURPLE);
  if (object->flags & NTS_BUFFERED) {
    return;
  }
  object->flags |= NTS_BUFFERED;
  nts_push(&nts_env->roots, &nts_env->roots_len, &nts_env->roots_cap, object);
  nts_env->candidates++;
}

void nts_release(NtsHeader *object) {
  nts_env->releases++;
  if (!object || object->reserved == NTS_IMMORTAL) {
    return;
  }
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
    if (!nts_env->draining && !nts_env->collecting &&
        nts_env->roots_len >= NTS_COLLECT_THRESHOLD) {
      nts_collect_cycles();
    }
    return;
  }

  object->reserved = 0;
  nts_paint(object, NTS_BLACK);
  if (object->flags & NTS_BUFFERED) {
    /* The candidate buffer is holding it. Freeing it now would leave the
     * buffer pointing at memory that is gone; collection frees it instead,
     * which is where the buffer is emptied. */
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
    nts_each_reference(object, nts_mark_gray_child);
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
    nts_each_reference(object, nts_scan_black_child);
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
    nts_each_reference(object, nts_scan_child);
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
    nts_each_reference(object, nts_collect_white_child);
    nts_push(&nts_env->dead, &nts_env->dead_len, &nts_env->dead_cap, object);
  }
}

void nts_collect_cycles(void) {
  if (nts_env->collecting) {
    return;
  }
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
      nts_env->roots[kept++] = root;
      continue;
    }
    root->flags &= ~NTS_BUFFERED;
    if (nts_color(root) == NTS_BLACK && root->reserved == 0) {
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
    nts_env->roots[index]->flags &= ~NTS_BUFFERED;
  }
  nts_env->dead_len = 0;
  for (size_t index = 0; index < nts_env->roots_len; index++) {
    nts_gather_white(nts_env->roots[index]);
  }
  nts_env->roots_len = 0;

  /* Every one of these is garbage and every reference between them has
   * already been accounted for, so this frees the memory and nothing else --
   * releasing contents here would decrement counts a second time. */
  for (size_t index = 0; index < nts_env->dead_len; index++) {
    nts_env->reclaimed++;
    nts_free(nts_env->dead[index]);
  }
  nts_env->dead_len = 0;

  /* Now, with every count settled and the buffer already empty, reclaim what
   * was found dead at the start. Ordinary release handles the cascade, and
   * nothing here can free memory the walks above still name: a zeroed root's
   * references were never trial-deleted, so every child of one keeps a count
   * it did not get from inside the subgraph and cannot have been painted
   * white. Garbage held only by one of these is reclaimed a collection later
   * than it could be, which is the price of never perturbing a count mid-walk.
   *
   * These cannot reach each other -- a zeroed object is one nothing points at
   * -- so no entry in this list is freed twice. */
  for (size_t index = 0; index < nts_env->zeroed_len; index++) {
    nts_destroy(nts_env->zeroed[index]);
  }
  nts_env->zeroed_len = 0;
  nts_env->collecting = false;
}

size_t nts_cycle_candidates(void) { return nts_env->candidates; }

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

const char *nts_thrown_class(NtsValue value) {
  if (!NTS_TAG_IS_REFERENCE(nts_value_tag(value))) {
    return NULL;
  }
  const NtsHeader *object = nts_value_reference(value);
  return object && object->descriptor ? object->descriptor->name : NULL;
}

_Noreturn void nts_uncaught(NtsValue value, const NtsString *detail) {
  /* An embedder with somewhere to put it gets it, and the process survives.
     Popped here rather than by the caller, because the caller is reached by a
     jump and the frame it lands in is no longer the innermost one. */
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
  if (!NTS_TAG_IS_REFERENCE(nts_value_tag(value))) {
    return false;
  }
  const NtsHeader *object = nts_value_reference(value);
  return object && object->descriptor == klass;
}

double nts_promise_state(const NtsPromise *promise) {
  return promise ? (double)promise->state : (double)NTS_PROMISE_PENDING;
}

bool nts_is_buffer(NtsValue value) {
  if (!NTS_TAG_IS_REFERENCE(nts_value_tag(value))) {
    return false;
  }
  const NtsHeader *object = nts_value_reference(value);
  return object && object->descriptor &&
         object->descriptor->kind == NTS_KIND_BUFFER;
}

bool nts_is_array(NtsValue value) {
  if (!NTS_TAG_IS_REFERENCE(nts_value_tag(value))) {
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

/* `String(v)` where `v` carries its own tag.
 *
 * Exact for every tag this can be reached with, and it can only be reached
 * with those: the compiler admits the call when the value's *type* has no
 * member whose spelling needs a `toString` -- no object, no array, no closure.
 * `String({})` is "[object Object]" and `String([1,2])` is "1,2", and both are
 * the prototype chain's answer rather than the value's, which is §13's and not
 * this function's.
 *
 * So the `default` here is a compiler bug and says so, rather than inventing a
 * spelling that would be wrong wherever it appeared.
 *
 * The returned string is owned by the caller. A string already in the value is
 * retained rather than copied, which is what makes `String(s)` free when `s`
 * was already text. */
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
 * boundary `typescript.md` argues for, refused where it is crossed rather than
 * wrapped silently. */
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

void nts_bounds(double index, uint32_t length) {
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
  size_t bytes = sizeof(NtsArray) + (size_t)count * descriptor->size;
  NtsArray *array = (NtsArray *)nts_alloc(bytes);
  array->header.descriptor = descriptor;
  array->header.reserved = 1;
  nts_note_allocation();
  array->header.flags = 0;
  array->header.length = count;
  array->capacity = count;
  /* Just past the struct, so an array nothing grows keeps its elements next to
   * its header and reads them with the locality inline storage had. */
  array->elements = (unsigned char *)array + sizeof(NtsArray);
  return array;
}

/* Zeroed rather than left as holes: there is no `undefined` in a double, so a
 * hole has no representation to leave behind. This is what `new Array(n)` gets,
 * and anything else the source can read before it writes. */
/* The same shape `codegen/c` emits for a `double` element type: kind, element
   size, no references, no erased elements, and a name the runtime prints. */
static const NtsDescriptor nts_desc_number_array = {
    NTS_KIND_ARRAY, (uint32_t)sizeof(double), 0, 0, 0, 0, "double[]", 0, 0,
    NTS_ARRAY_FLOAT};

NtsArray *nts_array_of_numbers(double length) {
  return nts_array_new(&nts_desc_number_array, length);
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
NtsValue nts_array_element(NtsValue array, double index) {
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
  if (!(index >= 0.0 && index < (double)object->header.length &&
        index == (double)(uint32_t)index)) {
    return nts_value_of_undefined();
  }
  uint32_t at = (uint32_t)index;
  switch (descriptor->element) {
  case NTS_ARRAY_VALUE: {
    NtsValue element = NTS_ITEMS(object, NtsValue)[at];
    if (NTS_TAG_IS_REFERENCE(nts_value_tag(element)) &&
        nts_value_reference(element)) {
      nts_retain(nts_value_reference(element));
    }
    return element;
  }
  case NTS_ARRAY_REFERENCE: {
    NtsHeader *element = NTS_ITEMS(object, NtsHeader *)[at];
    if (!element) {
      return nts_value_of_undefined();
    }
    nts_retain(element);
    return nts_value_of_reference(element, nts_tag_of_reference(element));
  }
  case NTS_ARRAY_BOOL:
    return nts_value_of_boolean(NTS_ITEMS(object, bool)[at]);
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

/* Where an index lands, or -1 for out of range. Negative counts from the end.
 */
static double nts_array_offset(const NtsArray *a, double at) {
  at = nts_to_integer(at);
  if (at < 0) {
    at += (double)a->header.length;
  }
  return (at < 0 || at >= (double)a->header.length) ? -1.0 : at;
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
    void *moved = malloc(bytes);
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
      free(a->elements);
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

void *nts_array_at_ref(const NtsArray *a, double at) {
  double offset = nts_array_offset(a, at);
  if (offset < 0) {
    return NULL;
  }
  void *element = NTS_ITEMS(a, void *)[(uint32_t)offset];
  nts_retain((NtsHeader *)element);
  return element;
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

__attribute__((always_inline)) NtsString *nts_str_append(NtsString *a,
                                                         const NtsString *b) {
  uint32_t total = a->length + b->length;
  int wide = ((a->flags | b->flags) & NTS_TWO_BYTE) != 0;
  int already_wide = (a->flags & NTS_TWO_BYTE) != 0;

  /* In place, when every one of these holds. `reserved == 1` is the whole
   * safety argument: one reference exists and this call is consuming it, so
   * nobody can be looking at the units being overwritten. An immortal string --
   * a literal, or frame storage -- fails it, which is right: neither is ours to
   * write. */
  if (a->reserved == 1u && wide == already_wide &&
      total <= nts_str_capacity(a)) {
    /* One unit on the right, spelled out rather than handed to a copy.
     *
     * `out += c` is the shape a decoder writes, once per code point, and the
     * right-hand side of it is a string of length one. `memcpy` of one byte is
     * a call into the C library's vector dispatch, which reads its length,
     * picks a strategy and moves a byte: on `benches/cases/node-utf8` that was
     * 494,776 calls to `__memcpy_avx_unaligned_erms`, seven per cent of the
     * whole program, to do 494,776 bytes of work.
     *
     * The branch is free where it does not hit -- one compare against a length
     * already loaded -- and where it does it is a store. */
    if (wide) {
      uint16_t *units = NTS_ELEMENTS(a, uint16_t);
      if (b->length == 1u) {
        units[a->length] = nts_unit(b, 0);
      } else {
        nts_widen(units + a->length, b);
      }
      units[total] = 0;
    } else {
      unsigned char *bytes = NTS_ELEMENTS(a, unsigned char);
      if (b->length == 1u) {
        bytes[a->length] = NTS_ELEMENTS(b, unsigned char)[0];
      } else {
        memcpy(bytes + a->length, NTS_ELEMENTS(b, unsigned char), b->length);
      }
      bytes[total] = 0;
    }
    a->length = total;
    return a;
  }

  /* Otherwise a new one, sized to the next power of two so that the *next*
   * append has somewhere to go. That is what makes a loop of n appends cost
   * log n allocations instead of n, and it is why the capacity can be derived
   * from the length rather than stored beside it. */
  NtsString *out = nts_str_raw(nts_round_up_pow2(total), wide);
  if (wide) {
    uint16_t *units = NTS_ELEMENTS(out, uint16_t);
    nts_widen(units, a);
    nts_widen(units + a->length, b);
    units[total] = 0;
  } else {
    unsigned char *bytes = NTS_ELEMENTS(out, unsigned char);
    memcpy(bytes, NTS_ELEMENTS(a, unsigned char), a->length);
    memcpy(bytes + a->length, NTS_ELEMENTS(b, unsigned char), b->length);
    bytes[total] = 0;
  }
  out->length = total;
  out->flags |= NTS_GROWN;
  /* The old storage, returned rather than released. A release is the right
   * thing when somebody else may still hold this -- `reserved != 1` -- and a
   * counted operation the caller is charged for either way. Where the count
   * says the string is ours alone, there is nothing to decide: no other
   * reference exists, a string has no fields to give back, and one with no
   * reference fields is never a collection candidate, so nothing is buffered
   * that could be left pointing at it.
   *
   * `nts_destroy` and not `nts_free`: the first is the death path every other
   * object takes and does the reclaiming bookkeeping, and `nts_live_count` is
   * how reference counting is tested. Freeing the block alone gave the memory
   * back and left the object counted as live, which the suite reported as five
   * leaks -- correctly.
   *
   * This is what keeps growth off the bill. Six reallocations building a string
   * were six releases, and the operation they were counted against is one the
   * program never asked for. */
  if (a->reserved == 1u) {
    nts_destroy((NtsHeader *)a);
  } else if (a->reserved != NTS_IMMORTAL) {
    nts_release((NtsHeader *)a);
  }
  /* An immortal left alone. A literal or frame storage has no count to give
   * back -- retain and release both return on their first line -- so releasing
   * one is a call that decides nothing, and `let out = ""` in front of a loop
   * put exactly one of those on every string built in this program. */
  return out;
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
      (NtsString *)nts_alloc(sizeof(NtsHeader) + ((size_t)length + 1) * width);
  out->descriptor = wide ? &nts_desc_string2 : &nts_desc_string1;
  out->reserved = 1;
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

/* Copy a range of code units out of a string, into the caller's storage where
 * it supplied one. */
static NtsString *nts_str_range(NtsHeader *into, const NtsString *s,
                                uint32_t from, uint32_t to) {
  uint32_t length = to > from ? to - from : 0u;
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
  at = nts_to_integer(at);
  if (!(at >= 0.0 && at < (double)s->length)) {
    nts_bounds(at, s->length);
  }
  uint32_t index = (uint32_t)at;
  return nts_str_range(into, s, index, index + 1u);
}

NtsString *nts_str_at(const NtsString *s, double at) {
  return nts_str_at_into(NULL, s, at);
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

NtsArray *nts_array_fill_ref(NtsArray *a, void *value) {
  void **items = NTS_ITEMS(a, void *);
  for (uint32_t at = 0; at < a->header.length; at++) {
    /* Retain before release, so filling an array with something it already
     * holds cannot free the value between the two. */
    nts_retain((NtsHeader *)value);
    nts_release((NtsHeader *)items[at]);
    items[at] = value;
  }
  return nts_array_same(a);
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

/* One element of a numeric `join`, formatted into `out` and its length
 * returned.
 *
 * `out` needs 32 bytes. The general path's widest answer is
 * `-1.7976931348623157e+308` at 24 characters and the integer path's is eleven,
 * so 32 is the bound with room rather than a guess -- and
 * `nts_number_to_string` is asked for the general case, which cannot exceed
 * what it produced.
 *
 * A whole value in the `i32` range takes the integer path and allocates
 * nothing. That is every element of a `Uint8Array`, every index, and most of an
 * ordinary `number[]`; the fraction allocates one string and frees it, which is
 * the price of not duplicating Grisu's twenty lines of ECMAScript formatting
 * rules here. `nts_number_to_string_into` is `always_inline` for a reason
 * `benches/cases/number-format` measured, and splitting it to share a buffer
 * would spend that to save an allocation on the rarer path. */
static uint32_t nts_join_one(char *out, double x) {
  const int32_t whole =
      x >= -2147483648.0 && x <= 2147483647.0 ? (int32_t)x : 0;
  if ((double)whole == x) {
    const uint32_t magnitude =
        whole < 0 ? (uint32_t)(-(int64_t)whole) : (uint32_t)whole;
    const uint32_t sign = whole < 0 ? 1u : 0u;
    if (sign != 0u) {
      out[0] = '-';
    }
    return sign + (uint32_t)nts_u32toa(out + sign, magnitude);
  }
  NtsString *formatted = nts_number_to_string(x);
  uint32_t length = formatted->length;
  if (length > 31u) {
    /* Unreachable for a `double`, and a silent overrun if it ever is not. */
    fprintf(stderr, NTS_REFUSED "a number formatted to %u characters\n",
            length);
    abort();
  }
  memcpy(out, NTS_ELEMENTS(formatted, unsigned char), length);
  nts_release(formatted);
  return length;
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
  for (uint32_t at = 0; at < count; at++) {
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

NtsArray *nts_array_slice_ref(const NtsArray *a, double from, double to) {
  uint32_t start = nts_str_clamp(from, a->header.length, 1);
  uint32_t end = nts_str_clamp(to, a->header.length, 1);
  uint32_t count = end > start ? end - start : 0u;
  NtsArray *out =
      nts_array_new_uninitialized(a->header.descriptor, (double)count);
  void *const *items = NTS_ITEMS(a, void *);
  void **into = NTS_ITEMS(out, void *);
  for (uint32_t at = 0; at < count; at++) {
    into[at] = items[start + at];
    nts_retain((NtsHeader *)into[at]);
  }
  return out;
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

NtsArray *nts_array_splice(NtsArray *a, double start, double count) {
  return nts_array_splice_at(a, start, count, sizeof(double));
}

NtsArray *nts_array_splice_ref(NtsArray *a, double start, double count) {
  return nts_array_splice_at(a, start, count, sizeof(void *));
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

void nts_array_extend_ref(NtsArray *dst, const NtsArray *src) {
  void *const *items = NTS_ITEMS(src, void *);
  for (uint32_t at = 0; at < src->header.length; at++) {
    nts_retain((NtsHeader *)items[at]);
    nts_array_push_ref(dst, items[at]);
  }
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
NtsArray *nts_array_concat_ref(const NtsArray *a, const NtsArray *b) {
  uint32_t total = a->header.length + b->header.length;
  NtsArray *out =
      nts_array_new_uninitialized(a->header.descriptor, (double)total);
  void **into = NTS_ITEMS(out, void *);
  void *const *first = NTS_ITEMS(a, void *);
  void *const *second = NTS_ITEMS(b, void *);
  for (uint32_t at = 0; at < a->header.length; at++) {
    into[at] = first[at];
    nts_retain((NtsHeader *)into[at]);
  }
  for (uint32_t at = 0; at < b->header.length; at++) {
    into[a->header.length + at] = second[at];
    nts_retain((NtsHeader *)into[a->header.length + at]);
  }
  return out;
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
  for (uint32_t at = 0; at < total; at++) {
    if (NTS_TAG_IS_REFERENCE(nts_value_tag(into[at])) &&
        nts_value_reference(into[at])) {
      nts_retain(nts_value_reference(into[at]));
    }
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
 * The specification says that if the base is 1 or -1 and the exponent is an
 * infinity, the result is NaN. C99 says both are 1, on the grounds that the
 * limit is 1 -- and the difference is reachable from ordinary source:
 * `Math.pow(1, x)` where `x` overflows to infinity. */
double nts_math_pow(double base, double exponent) {
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

/* `String(x)`, which is ECMAScript's Number::toString and not `printf`.
 *
 * `js_dtoa` with `FORMAT_FREE` is exactly that algorithm: the shortest decimal
 * that reads back as the same double, placed by the specification's own rules
 * for where the point goes and when to use an exponent. It answers `NaN`,
 * `Infinity` and `-Infinity` itself.
 *
 * `-0` is the one place the specification and the library disagree on purpose.
 * `String(-0)` is `"0"` -- the sign is not part of the answer -- and `js_dtoa`
 * writes it only when asked with `JS_DTOA_MINUS_ZERO`, which this does not ask.
 *
 * What was here: a loop calling `snprintf("%.*e")` and `strtod` at every
 * precision from 1 to 17 until one round-tripped. Correct, because it verifies,
 * and 867ns for `1234567` against 7.4ns for this.
 */
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
 * Ours rather than a patch to `runtime/c/quickjs`: that directory is upstream
 * unmodified so updating it stays a file copy. `js_dtoa` is still theirs and
 * still does everything a non-integer needs. */
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
NtsString *nts_number_to_string_radix(double x, double radix) {
  if (radix == 10.0)
    return nts_number_to_string(x);

  int base = (int)radix;
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
 * It is not a small function -- an integer fast path and a Grisu fallback --
 * and inlining it wholesale is the kind of thing that usually loses. What makes
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
   * test and fall through to `js_dtoa`, which spells them itself. */
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

  /* Grisu3 for anything finite, `js_dtoa` for what it declines and for the
   * values it is not asked about -- NaN and the infinities, which it spells
   * itself. The two produce the same characters; see `nts_grisu.h` for the
   * measurement that says so. */
  char digits[32];
  int length;
  int point;
  if (isfinite(x) && nts_grisu(x < 0 ? -x : x, digits, &length, &point)) {
    char buf[JS_DTOA_MAX_DIGITS + 32];
    char *q = buf;
    if (x < 0) {
      *q++ = '-';
    }
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
    const uint32_t total = (uint32_t)(q - buf);
    NtsString *out =
        nts_str_build(total <= NTS_NUMBER_STRING_MAX ? into : NULL, total, 0);
    memcpy(NTS_ELEMENTS(out, unsigned char), buf, (size_t)total);
    return out;
  }

  char buf[JS_DTOA_MAX_DIGITS + 32];
  JSDTOATempMem tmp;
  const int exact =
      js_dtoa(buf, x, 10, 0, JS_DTOA_FORMAT_FREE | JS_DTOA_EXP_AUTO, &tmp);
  /* The caller's storage is sized by `NTS_NUMBER_STRING_MAX`, which is an
   * argument about the longest thing this can write and not a measurement of
   * it. If that argument is ever wrong, this takes the heap rather than writing
   * past a frame slot: a lost optimisation instead of a smashed stack. */
  NtsHeader *where = (exact <= NTS_NUMBER_STRING_MAX) ? into : NULL;
  /* Always one byte: every character written in radix 10 is ASCII. */
  NtsString *out = nts_str_build(where, (uint32_t)exact, 0);
  memcpy(NTS_ELEMENTS(out, unsigned char), buf, (size_t)exact);
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
 * An unrecognised tag answers "undefined" rather than aborting. A tag this
 * function does not know is a compiler bug, and a program that prints the wrong
 * word is a better place to find one than a program that dies without saying
 * which value it died on. */
NtsString *nts_tag_name(uint32_t tag) {
  switch (tag) {
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
    return nts_string_from_utf8("object", 6);
  default:
    return nts_string_from_utf8("undefined", 9);
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
NtsString *nts_bigint_to_string(__int128 value) {
  /* 2^127 is 39 digits; one more for the sign. */
  char digits[40];
  size_t at = sizeof digits;
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

NtsString *nts_string_from_utf8(const char *bytes, size_t length) {
  /* At most one code unit per byte for the BMP, two for a supplementary
   * character -- which is also at most one per byte, since those take four. */
  uint16_t *units = (uint16_t *)malloc((length + 1u) * sizeof(uint16_t));
  if (!units) {
    fprintf(stderr, "nts: out of memory\n");
    abort();
  }
  uint32_t count = 0;
  size_t at = 0;
  while (at < length) {
    unsigned char lead = (unsigned char)bytes[at];
    uint32_t point;
    size_t extra;
    if (lead < 0x80u) {
      point = lead;
      extra = 0;
    } else if ((lead & 0xE0u) == 0xC0u) {
      point = lead & 0x1Fu;
      extra = 1;
    } else if ((lead & 0xF0u) == 0xE0u) {
      point = lead & 0x0Fu;
      extra = 2;
    } else if ((lead & 0xF8u) == 0xF0u) {
      point = lead & 0x07u;
      extra = 3;
    } else {
      point = 0xFFFDu;
      extra = 0;
    }
    if (at + extra >= length + (extra == 0 ? 1u : 0u) && extra > 0) {
      point = 0xFFFDu;
      extra = 0;
    }
    for (size_t step = 1; step <= extra; step++) {
      unsigned char next = (unsigned char)bytes[at + step];
      if ((next & 0xC0u) != 0x80u) {
        point = 0xFFFDu;
        extra = 0;
        break;
      }
      point = (point << 6) | (next & 0x3Fu);
    }
    at += extra + 1u;

    if (point > 0xFFFFu) {
      /* A supplementary character is a surrogate pair, and `length`
       * counts both halves -- which is what JavaScript reports. */
      point -= 0x10000u;
      units[count++] = (uint16_t)(0xD800u + (point >> 10));
      units[count++] = (uint16_t)(0xDC00u + (point & 0x3FFu));
    } else {
      units[count++] = (uint16_t)point;
    }
  }
  NtsString *out = nts_str_alloc(units, count);
  free(units);
  return out;
}

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
 * Not `strtod` on the whole string, which is the obvious implementation and the
 * wrong one. C accepts three spellings JavaScript does not -- `inf`, `nan` and
 * a hexadecimal *float* with a `p` exponent -- and JavaScript accepts three C
 * does not, `0b`, `0o` and a bare leading `.` with no digit before it. So the
 * grammar is checked here and `strtod` is asked only about a span this has
 * already decided is a decimal literal, where it is exactly right: correctly
 * rounded, which a hand-rolled accumulate-and-scale is not.
 *
 * Whitespace is `nts_str_is_space`, the same predicate `trim` uses, because
 * StrWhiteSpace and TrimString's are the same set. An empty or all-space string
 * is +0 rather than NaN -- `Number("")` is 0 and `Number(" ")` is 0, which is
 * the case people are surprised by and the one node agrees with.
 *
 * Anything outside ASCII is NaN without further reading: no numeric literal has
 * a code unit above 0x7F, so a single one settles the whole string. That is
 * also what keeps the copy below a byte copy rather than a transcoding.
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
 * the checker's type admits no object -- `typeof v === "string" || typeof v ===
 * "boolean"` is the shape that reaches it -- and the arm is here because a tag
 * switch with a hole is worse than one with an answer that cannot be reached.
 * NaN is also what the specification gives for a plain `{}`, so the unreachable
 * case is at least not a surprising number. */
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
  default:
    return (double)NAN;
  }
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
  /* Long enough for every literal a program writes and short enough to sit in
   * a frame. Past it the value is decided by the leading significant digits and
   * the exponent, and neither survives truncation -- so it is a heap copy
   * rather than a silently wrong answer. `malloc` directly rather than
   * `nts_alloc`, because this is scratch that never becomes an object and does
   * not want a header, a descriptor or a place in the collector's accounting.
   */
  char inline_buffer[256];
  char *text = inline_buffer;
  char *owned = NULL;
  if (length + 1u > sizeof inline_buffer) {
    owned = (char *)malloc(length + 1u);
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
  text[length] = '\0';

  double answer;
  const char *body = text;
  size_t remaining = length;
  bool negative = false;
  if (remaining > 0 && (body[0] == '+' || body[0] == '-')) {
    negative = body[0] == '-';
    body++;
    remaining--;
  }
  /* `Infinity` with an optional sign, and nothing else spelled with letters. */
  if (remaining == 8 && memcmp(body, "Infinity", 8) == 0) {
    answer = negative ? -INFINITY : INFINITY;
  } else if (nts_number_radix(text, length, &answer)) {
    /* Whole string, sign included: a radix literal cannot carry one. */
  } else if (nts_number_span_is_decimal(text, length)) {
    answer = strtod(text, NULL);
  } else {
    answer = (double)NAN;
  }

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
    return memcmp((const unsigned char *)a + sizeof(NtsHeader),
                  (const unsigned char *)b + sizeof(NtsHeader),
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
 * leaves the runtime nowhere: `NTS_TAG_IS_REFERENCE` is false for it, so the
 * collector walks straight past a hole without being taught about holes. */
#define NTS_TAG_HOLE 0xFFFFFFFFu

#define NTS_MAP_EMPTY (-1)
#define NTS_MAP_DELETED (-2)

/* Load factor 1/2, so a probe chain stays short. */
#define NTS_MAP_SLOTS_FOR(entries) ((entries) * 2u)

static bool nts_map_is_hole(NtsValue key) {
  return nts_value_tag(key) == NTS_TAG_HOLE;
}

/* A 64-bit avalanche, so that a power-of-two mask sees the whole hash rather
 * than its low bits. Pointers, which are aligned and therefore have none of
 * interest down there, are the reason this is not just a truncation. */
static uint32_t nts_hash_mix(uint64_t x) {
  x ^= x >> 33;
  x *= 0xff51afd7ed558ccdULL;
  x ^= x >> 33;
  x *= 0xc4ceb9fe1a85ec53ULL;
  x ^= x >> 33;
  return (uint32_t)x;
}

/* Over code units rather than bytes.
 *
 * A narrow and a wide string holding the same text are `===` -- that is what
 * `nts_string_eq` says -- so they have to hash alike, and their bytes do not
 * match. Widening as it goes costs a branch per unit and allocates nothing. */
static uint32_t nts_hash_string(const NtsString *s) {
  uint64_t h = 0xcbf29ce484222325ULL;
  uint32_t units = s->length;
  if (s->flags & NTS_TWO_BYTE) {
    const uint16_t *text = NTS_ELEMENTS(s, uint16_t);
    for (uint32_t i = 0; i < units; i++) {
      h = (h ^ text[i]) * 0x100000001b3ULL;
    }
  } else {
    const unsigned char *text = NTS_ELEMENTS(s, unsigned char);
    for (uint32_t i = 0; i < units; i++) {
      h = (h ^ (uint16_t)text[i]) * 0x100000001b3ULL;
    }
  }
  return nts_hash_mix(h);
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

static inline __attribute__((always_inline)) uint32_t
nts_hash_key(NtsValue key, uint32_t kind) {
  switch (kind) {
  case NTS_KEY_STRING:
    return nts_hash_string((const NtsString *)nts_value_reference(key));
  case NTS_KEY_NUMBER:
    return nts_hash_number(nts_value_number(key));
  case NTS_KEY_REFERENCE:
    return nts_hash_mix((uint64_t)(uintptr_t)nts_value_reference(key));
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
static const NtsDescriptor nts_desc_map = {
    NTS_KIND_MAP,     (uint32_t)sizeof(NtsMap), 0u, 1u, 0, 0, "Map", 1u, 0,
    NTS_ARRAY_UNKNOWN};

static NtsMap *nts_map_alloc(uint32_t kind, bool holds_values) {
  NtsMap *map = (NtsMap *)nts_alloc(sizeof(NtsMap));
  map->header.descriptor = &nts_desc_map;
  map->header.reserved = 1;
  map->header.flags = 0;
  map->header.length = 0;
  nts_note_allocation();
  map->used = 0;
  map->capacity = 0;
  map->slots = 0;
  map->kind = kind;
  map->holds_values = holds_values;
  map->index = 0;
  map->keys = 0;
  /* The three arrays are allocated on the first insertion rather than here, so
   * that a map nothing is ever put into costs one header. */
  map->values = 0;
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
static const NtsDescriptor nts_desc_date = {
    NTS_KIND_OBJECT,  (uint32_t)sizeof(NtsDate), 0u, 0u, 0, 0, "Date", 0u, 0,
    NTS_ARRAY_UNKNOWN};

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
  date->header.reserved = 1;
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
                                              NTS_ARRAY_UNKNOWN};

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
  unsigned char *bytes = (unsigned char *)calloc(reserved ? reserved : 1u, 1u);
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
  buffer->header.reserved = 1;
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
                                                NTS_ARRAY_UNKNOWN};

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
  NtsBuffer *moved = nts_buffer_make(
      length, fixed ? length : (buffer ? buffer->reserved_bytes : length),
      !fixed && buffer && buffer->resizable);
  if (moved && buffer && buffer->bytes) {
    size_t carried = buffer->length < length ? buffer->length : length;
    memcpy(moved->bytes, buffer->bytes, carried);
    /* Detached, which is the observable point of a transfer. The block goes
     * back now rather than at death: a transferred buffer may be held for a
     * long time by something that only ever asks whether it is detached. */
    nts_env->bytes_held -= buffer->reserved_bytes;
    nts_env->reclaimed++;
    free(buffer->bytes);
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
    0u, 0, NTS_ARRAY_UNKNOWN};

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
  if (!NTS_TAG_IS_REFERENCE(nts_value_tag(value))) {
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
  if (!NTS_TAG_IS_REFERENCE(nts_value_tag(value))) {
    return false;
  }
  const NtsHeader *object = nts_value_reference(value);
  if (!object || !object->descriptor ||
      object->descriptor->kind != NTS_KIND_MAP) {
    return false;
  }
  return ((const NtsMap *)object)->holds_values == holds_values;
}

bool nts_is_map(NtsValue value) { return nts_is_map_like(value, true); }

bool nts_is_set(NtsValue value) { return nts_is_map_like(value, false); }

bool nts_is_date(NtsValue value) {
  if (!NTS_TAG_IS_REFERENCE(nts_value_tag(value))) {
    return false;
  }
  const NtsHeader *object = nts_value_reference(value);
  return object && object->descriptor == &nts_desc_date;
}

bool nts_is_data_view(NtsValue value) {
  if (!NTS_TAG_IS_REFERENCE(nts_value_tag(value))) {
    return false;
  }
  const NtsHeader *object = nts_value_reference(value);
  return object && object->descriptor == &nts_desc_dataview;
}

bool nts_is_view_kind(NtsValue value, double kind) {
  if (!NTS_TAG_IS_REFERENCE(nts_value_tag(value))) {
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
  view->header.reserved = 1;
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
                                              NTS_ARRAY_UNKNOWN};

/* The `Symbol.for` registry: keys to the symbols made for them.
 *
 * A strong reference on purpose, and the specification's own rule -- a
 * registered symbol is reachable from the registry for the life of the runtime,
 * which is exactly the difference between `Symbol.for("a")` and `Symbol("a")`.
 * So it is not a leak; it is the semantics. */

NtsSymbol *nts_symbol_new(NtsString *description) {
  NtsSymbol *symbol = (NtsSymbol *)nts_alloc(sizeof(NtsSymbol));
  symbol->header.descriptor = &nts_desc_symbol;
  symbol->header.reserved = 1;
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
    nts_env->symbol_registry = nts_map_alloc(NTS_KEY_STRING, true);
    /* The map header. Its key block is counted where it is allocated, in
     * `nts_map_rehash`, and is accounted for on the first insertion below. */
    nts_env->permanent++;
  }
  NtsValue slot = nts_value_of_reference((NtsHeader *)key, NTS_TAG_STRING);
  NtsValue found = nts_map_get(nts_env->symbol_registry, slot);
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
              nts_value_of_reference((NtsHeader *)symbol, NTS_TAG_SYMBOL));
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
    NtsValue value = nts_map_value_at(nts_env->symbol_registry, (double)at);
    if (nts_value_tag(value) == NTS_TAG_SYMBOL &&
        (const NtsSymbol *)nts_value_reference(value) == symbol) {
      NtsValue key = nts_map_key_at(nts_env->symbol_registry, (double)at);
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

NtsMap *nts_map_new(double kind) { return nts_map_alloc((uint32_t)kind, true); }
NtsMap *nts_set_new(double kind) {
  return nts_map_alloc((uint32_t)kind, false);
}

/* Where `key` lives, or -1.
 *
 * `insert_at` receives the slot a fresh key would take: the first DELETED slot
 * on the chain if there was one, so that deleting and reinserting does not
 * make the table grow, and the terminating EMPTY otherwise. */
static inline __attribute__((always_inline)) int32_t nts_map_find(
    const NtsMap *map, NtsValue key, uint32_t hash, uint32_t *insert_at) {
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
    int32_t at = map->index[slot];
    if (at == NTS_MAP_EMPTY) {
      if (insert_at) {
        *insert_at = reuse < map->slots ? reuse : slot;
      }
      return -1;
    }
    if (at == NTS_MAP_DELETED) {
      if (reuse == map->slots) {
        reuse = slot;
      }
    } else if (nts_key_eq(map->keys[at], key, map->kind)) {
      if (insert_at) {
        *insert_at = slot;
      }
      return at;
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
  /* On `used` rather than on the live count, because the holes are staying. */
  uint32_t wanted = map->used * 2u;
  if (wanted < 8u) {
    wanted = 8u;
  }

  uint32_t slots = 8u;
  while (slots < NTS_MAP_SLOTS_FOR(wanted)) {
    slots *= 2u;
  }

  /* One block, sliced, rather than three.
   *
   * The three arrays are allocated and freed together and always have been --
   * they are the same table -- so nothing was buying the separate `malloc`s
   * except the code being written that way. A table of seventeen entries grows
   * three times, and `tooling/memory/cases/map-and-set` counted 3 blocks a
   * rehash for a `Map` and 2 for a `Set`: seventeen allocations for two
   * containers.
   *
   * `keys` first, so the block's base is what `free` is given. `NtsValue` is
   * sixteen bytes and `wanted` is a whole number of them, so `values` and then
   * `index` are aligned by construction rather than by padding -- and the
   * index, which every lookup touches, now sits next to the keys it indexes. */
  size_t key_bytes = (size_t)wanted * sizeof(NtsValue);
  size_t value_bytes = map->holds_values ? key_bytes : 0u;
  size_t index_bytes = (size_t)slots * sizeof(int32_t);
  unsigned char *block =
      (unsigned char *)malloc(key_bytes + value_bytes + index_bytes);
  if (!block) {
    fprintf(stderr, "nts: out of memory growing a map\n");
    abort();
  }
  NtsValue *keys = (NtsValue *)(void *)block;
  NtsValue *values =
      map->holds_values ? (NtsValue *)(void *)(block + key_bytes) : 0;
  int32_t *index = (int32_t *)(void *)(block + key_bytes + value_bytes);
  /* Counted, which they were not.
   *
   * `nts_note_allocation` says "objects, arrays, strings and maps all come
   * through it", and a map's *header* did while the three blocks holding its
   * actual contents did not -- so `tooling/memory`'s allocation column showed
   * `1` for a table of any size, and could not have shown otherwise. The bytes
   * were already tracked a few lines below; only the count was missing.
   *
   * These stay `malloc` rather than `nts_alloc` on purpose: a table reallocates
   * as it grows, and the bump provider cannot give a block back. */
  nts_note_allocation();
  for (uint32_t slot = 0; slot < slots; slot++) {
    index[slot] = NTS_MAP_EMPTY;
  }

  /* Every entry at the index it already had, holes included. */
  uint32_t out = map->used;
  for (uint32_t at = 0; at < out; at++) {
    keys[at] = map->keys[at];
    if (values) {
      values[at] = map->values[at];
    }
  }

  nts_env->bytes_held += (size_t)wanted * sizeof(NtsValue);
  nts_env->bytes_held += (size_t)slots * sizeof(int32_t);
  if (map->holds_values) {
    nts_env->bytes_held += (size_t)wanted * sizeof(NtsValue);
  }
  if (map->keys) {
    nts_env->bytes_held -= (size_t)map->capacity * sizeof(NtsValue);
    nts_env->bytes_held -= (size_t)map->slots * sizeof(int32_t);
    if (map->values) {
      nts_env->bytes_held -= (size_t)map->capacity * sizeof(NtsValue);
    }
    /* Paired with the one above, or `nts_live_count` -- which is
     * `allocated - reclaimed` -- would read every grown table as a leak. */
    nts_env->reclaimed++;
    /* `keys` is the block: `values` and `index` point into it. */
    free(map->keys);
  }
  map->keys = keys;
  map->values = values;
  map->index = index;
  map->capacity = wanted;
  map->slots = slots;
  map->used = out;

  /* The index is rebuilt from the live entries only: a hole has no key to
   * hash, and nothing should find its way back to one. */
  uint32_t mask = slots - 1u;
  for (uint32_t at = 0; at < out; at++) {
    if (nts_map_is_hole(keys[at])) {
      continue;
    }
    uint32_t slot = nts_hash_key(keys[at], map->kind) & mask;
    while (index[slot] != NTS_MAP_EMPTY) {
      slot = (slot + 1u) & mask;
    }
    index[slot] = (int32_t)at;
  }
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
__attribute__((always_inline)) NtsValue nts_map_get(const NtsMap *map,
                                                    NtsValue key) {
  int32_t at = nts_map_find(map, key, nts_hash_key(key, map->kind), 0);
  if (at < 0 || !map->values) {
    return nts_value_of_undefined();
  }
  nts_value_retain(map->values[at]);
  return map->values[at];
}

__attribute__((always_inline)) bool nts_map_has(const NtsMap *map,
                                                NtsValue key) {
  return nts_map_find(map, key, nts_hash_key(key, map->kind), 0) >= 0;
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

__attribute__((always_inline)) NtsMap *nts_map_set(NtsMap *map, NtsValue key,
                                                   NtsValue value) {
  key = nts_map_normalize(key);
  uint32_t hash = nts_hash_key(key, map->kind);
  uint32_t slot = 0;
  int32_t at = nts_map_find(map, key, hash, &slot);
  if (at >= 0) {
    /* Present: the key stays as it was -- `set` replaces the value and not the
     * key, which is observable for `-0` against `+0`. */
    if (map->values) {
      nts_value_retain(value);
      nts_value_release(map->values[at]);
      map->values[at] = value;
    }
    return nts_map_same(map);
  }
  if (map->used == map->capacity) {
    nts_map_rehash(map);
    nts_map_find(map, key, hash, &slot);
  }
  nts_value_retain(key);
  if (map->values) {
    nts_value_retain(value);
    map->values[map->used] = value;
  }
  map->keys[map->used] = key;
  map->index[slot] = (int32_t)map->used;
  map->used++;
  map->header.length++;
  return nts_map_same(map);
}

bool nts_map_delete(NtsMap *map, NtsValue key) {
  uint32_t hash = nts_hash_key(key, map->kind);
  uint32_t slot = 0;
  int32_t at = nts_map_find(map, key, hash, &slot);
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
  /* DELETED rather than EMPTY: a key further along the probe chain was placed
   * past this slot and would become unreachable if the chain ended here. */
  map->index[slot] = NTS_MAP_DELETED;
  map->header.length--;
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
}

__attribute__((always_inline)) NtsMap *nts_set_add(NtsMap *map, NtsValue key) {
  return nts_map_set(map, key, nts_value_of_undefined());
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
double nts_map_next(const NtsMap *map, double from) {
  if (!(from >= 0.0)) {
    return -1.0;
  }
  uint32_t at = from >= 4294967295.0 ? UINT32_MAX : (uint32_t)from;
  for (; at < map->used; at++) {
    if (!nts_map_is_hole(map->keys[at])) {
      return (double)at;
    }
  }
  return -1.0;
}

/* Read an entry the cursor has already landed on.
 *
 * No bounds test: `nts_map_next` returned this index and the only thing that
 * could invalidate it is a rehash, which cannot happen between the two -- the
 * loop body runs after the read, not between it and the step. An out-of-range
 * index would be a compiler bug rather than a program's, so it is not a check
 * this pays for on every element. */
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
  NtsMap *out = nts_map_new((double)map->kind);
  for (double at = nts_map_next(map, 0); at >= 0;
       at = nts_map_next(map, at + 1)) {
    nts_map_set(out, nts_map_key_at(map, at), nts_map_value_at(map, at));
  }
  return out;
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
  for (double at = nts_map_next(map, 0); at >= 0;
       at = nts_map_next(map, at + 1)) {
    NtsHeader *key = nts_value_reference(nts_map_key_at(map, at));
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
  for (double at = nts_map_next(map, 0); at >= 0;
       at = nts_map_next(map, at + 1)) {
    NtsHeader *key = nts_value_reference(nts_map_key_at(map, at));
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

NtsValue nts_map_key_at(const NtsMap *map, double at) {
  nts_value_retain(map->keys[(uint32_t)at]);
  return map->keys[(uint32_t)at];
}

NtsValue nts_map_value_at(const NtsMap *map, double at) {
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

/* --- Tasks, the host seam, and the checkpoint (RFC 12.1) -------------------
 *
 * See docs/async.md. The short version: the runtime owns the two queues and
 * the checkpoint because their ordering is observable, and the host owns the
 * loop because it is the platform's. The vtable is what makes a deterministic
 * test host possible, which is why it is a vtable rather than a compile-time
 * choice.
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
   * ordering rather than two interleaved (RFC 26.6). */
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
static void nts_collect_at_checkpoint(void) {
  if (nts_env->collecting || nts_env->draining || nts_env->roots_len == 0) {
    return;
  }
  nts_collect_cycles();
}

static void nts_process_ticks_and_rejections(void) {
  NtsTask task;
  do {
    while (nts_queue_shift(&nts_env->tick_queue, &task)) {
      task.run(task.state);
    }
    while (nts_queue_shift(&nts_env->microtask_queue, &task)) {
      task.run(task.state);
    }
  } while (nts_env->tick_queue.len != 0);
  nts_collect_at_checkpoint();
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

void nts_task_run(NtsTask task) {
  nts_enter();
  task.run(task.state);
  nts_leave();
}

bool nts_is_owner_thread(void) {
  return !nts_env->host_installed || !nts_env->host.is_owner_thread ||
         nts_env->host.is_owner_thread(nts_env->host.state);
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

/* --- Promises (RFC 12) -----------------------------------------------------
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
                                                NTS_ARRAY_UNKNOWN};

/* The fulfilled payload is *not* here: it is an erased slot, listed below, and
 * listing it in both tables would make `nts_each_reference` visit it twice --
 * doubling every retain and release, with the second release freeing something
 * still in use. */
static const uint32_t nts_promise_erased[] = {
    (uint32_t)offsetof(NtsPromise, value),
};

static const uint32_t nts_promise_offsets[] = {
    (uint32_t)offsetof(NtsPromise, reason),
    (uint32_t)offsetof(NtsPromise, reactions),
};

static const NtsDescriptor nts_desc_promise = {NTS_KIND_OBJECT,
                                               (uint32_t)sizeof(NtsPromise),
                                               2u,
                                               1u,
                                               nts_promise_offsets,
                                               0,
                                               "Promise",
                                               1u,
                                               nts_promise_erased,
                                               NTS_ARRAY_UNKNOWN};

bool nts_is_promise(NtsValue value) {
  if (!NTS_TAG_IS_REFERENCE(nts_value_tag(value))) {
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
     * RFC 17.4 requires the completion to come home first. */
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

static void nts_promise_settle(NtsPromise *promise, uint32_t state) {
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
  if (NTS_TAG_IS_REFERENCE(nts_value_tag(value)) &&
      nts_value_reference(value)) {
    nts_retain(nts_value_reference(value));
  }
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

void nts_promise_fulfill_value(NtsPromise *promise, NtsValue value) {
  nts_promise_require_owner("nts_promise_fulfill_value");
  if (promise->state != NTS_PROMISE_PENDING) {
    return;
  }
  if (nts_value_tag(value) > NTS_TAG_OBJECT) {
    fprintf(stderr, "nts: settled a promise with an unknown value tag\n");
    abort();
  }
  nts_promise_fulfill(promise, value);
}

void nts_promise_reject(NtsPromise *promise, NtsHeader *reason) {
  nts_promise_require_owner("nts_promise_reject");
  if (promise->state != NTS_PROMISE_PENDING) {
    return;
  }
  nts_retain(reason);
  promise->reason = reason;
  nts_promise_settle(promise, NTS_PROMISE_REJECTED);
}

void nts_promise_subscribe(NtsPromise *promise, NtsTask reaction) {
  nts_promise_require_owner("nts_promise_subscribe");
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

NtsHeader *nts_promise_reference(const NtsPromise *promise) {
  if (promise->state != NTS_PROMISE_FULFILLED ||
      !NTS_TAG_IS_REFERENCE(nts_value_tag(promise->value))) {
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

/* Reject `result` with whatever `source` was rejected with.
 *
 * One call rather than a reason accessor and a reject, so the reason never
 * becomes a value in the compiler's world. It has no type there: the runtime
 * stores every rejection in one reference slot, and the machinery for saying
 * "a managed reference of unknown class" would be a type-system change bought
 * for one argument that is immediately passed back. */
void nts_promise_reject_value(NtsPromise *promise, NtsValue reason) {
  if (!NTS_TAG_IS_REFERENCE(nts_value_tag(reason))) {
    nts_promise_reject(promise, 0);
    return;
  }
  nts_promise_reject(promise, nts_value_reference(reason));
}

NtsValue nts_promise_reason(const NtsPromise *promise) {
  NtsHeader *reason = promise->reason;
  if (!reason) {
    return nts_value_of_undefined();
  }
  return nts_value_of_reference(reason, nts_tag_of_reference(reason));
}

void nts_promise_reject_with(NtsPromise *result, const NtsPromise *source) {
  if (source->state != NTS_PROMISE_REJECTED) {
    fprintf(stderr,
            "nts: forwarded a rejection from a promise that has none\n");
    abort();
  }
  nts_promise_reject(result, source->reason);
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
    NTS_ARRAY_UNKNOWN};

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
    NTS_ARRAY_UNKNOWN};

/* Copy a settled promise's payload onto another promise. `race` is exactly
 * this, and `all`'s rejection is the same thing for the rejected case. */
static void nts_promise_forward(NtsPromise *to, const NtsPromise *from) {
  if (from->state == NTS_PROMISE_REJECTED) {
    nts_promise_reject(to, from->reason);
    return;
  }
  /* One arm, because there is one payload. `undefined` needs no case of its
   * own -- it is a tag like any other -- which is what the old `default:`
   * quietly stood in for, and what made an erased payload fulfil with
   * `undefined` when its arm was missing. */
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
    nts_promise_reject(all->result, slot->source->reason);
  } else {
    if (all->values->header.descriptor->references) {
      NtsHeader *value = nts_value_reference(slot->source->value);
      nts_retain(value);
      NTS_ITEMS(all->values, NtsHeader *)[slot->index] = value;
    } else {
      NTS_ITEMS(all->values, double)
      [slot->index] = nts_value_number(slot->source->value);
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

/* --- Timers, as a program calls them (docs/async.md 8, phase C) -------------
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
                                                NTS_ARRAY_UNKNOWN};

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
