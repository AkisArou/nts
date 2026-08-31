/* The Native TypeScript C runtime: the half that allocates or is too large to
 * inline. See nts_runtime.h for why this is a translation unit rather than text
 * pasted into every generated file.
 *
 * The system headers a runtime needs -- <stdio.h>, <stdlib.h>, <string.h> --
 * are confined here. That is the point: a generated file no longer picks up the
 * hundreds of names they declare, so a TypeScript `function div()` no longer
 * collides with C's.
 */
#include "nts_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Allocated and reclaimed, so that a test can see reference counting balance
 * from inside the program rather than infer it from memory use. */
static size_t nts_allocated = 0;
static size_t nts_reclaimed = 0;

size_t nts_live_count(void) { return nts_allocated - nts_reclaimed; }

/* Cyclic, because one descriptor serves every array of references and says
   nothing about what the elements point at. */
const NtsDescriptor nts_desc_ref = {
    NTS_KIND_ARRAY, sizeof(void *), 1, 1, 0, 0, "reference", 0u, 0};
const NtsDescriptor nts_desc_string1 = {NTS_KIND_STRING, 1,  0, 0, 0, 0,
                                        "string",        0u, 0};
const NtsDescriptor nts_desc_string2 = {NTS_KIND_STRING, 2,  0, 0, 0, 0,
                                        "string",        0u, 0};

/* The NoGC provider (RFC 9.1): a bump allocator that never frees. For compiler
 * bring-up, allocation testing and bounded-lifetime tools. It must never be
 * selected silently for a general application. */
#ifndef NTS_PROVIDER_RC
static unsigned char *nts_bump = 0;
static size_t nts_bump_left = 0;
#endif

static size_t nts_bytes_held = 0;

size_t nts_live_bytes(void) { return nts_bytes_held; }

#ifdef NTS_PROVIDER_RC
/* Whether an uninitialized allocation is filled with a pattern that is not
 * zero, so that reading a slot nobody wrote is visible rather than lucky.
 * Off by default; the differential suite turns it on. */
#ifndef NTS_POISON
#define NTS_POISON 0
#endif

/* Whether this build recycles memory itself.
 *
 * Not under AddressSanitizer. A recycling allocator hands the same address back
 * after a free, which is precisely the pattern the sanitizer exists to catch --
 * so a build made to find use-after-free must get its memory from `malloc` and
 * give it back. The cycle collector's use-after-free was found that way and
 * would have been invisible behind a free list.
 *
 * `NTS_NO_RECYCLE` forces the same, for anyone measuring what the recycling is
 * worth. */
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
#if NTS_RECYCLES
#define NTS_CLASS_STEP 16u
#define NTS_CLASSES 65u /* up to 1024 bytes */
static void *nts_recycled[NTS_CLASSES];
#endif
#endif

void *nts_alloc(size_t bytes) {
  bytes = (bytes + 15u) & ~(size_t)15u;
  nts_bytes_held += bytes;

#ifdef NTS_PROVIDER_RC
  /* Its own allocation, because it will be given back. The size is kept in
   * front of the object so that `nts_free` knows what it is returning without
   * consulting the descriptor -- which a freed object may no longer have. */
#if NTS_RECYCLES
  size_t klass = bytes / NTS_CLASS_STEP;
  if (klass < NTS_CLASSES && nts_recycled[klass]) {
    void *block = nts_recycled[klass];
    /* The list is threaded through the free blocks themselves, in the word
     * after the size -- which is dead while the block is dead. */
    nts_recycled[klass] = *(void **)((unsigned char *)block + 8u);
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
  if (bytes > nts_bump_left) {
    size_t chunk = bytes > (size_t)1048576 ? bytes : (size_t)1048576;
    nts_bump = (unsigned char *)malloc(chunk);
    if (!nts_bump) {
      fprintf(stderr, "nts: out of memory\n");
      abort();
    }
    nts_bump_left = chunk;
  }
  void *result = nts_bump;
  nts_bump += bytes;
  nts_bump_left -= bytes;
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
  nts_bytes_held -= bytes;
#if NTS_RECYCLES
  size_t klass = bytes / NTS_CLASS_STEP;
  if (klass < NTS_CLASSES) {
    *(void **)((unsigned char *)block + 8u) = nts_recycled[klass];
    nts_recycled[klass] = block;
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
    nts_bytes_held -= (size_t)map->capacity * sizeof(NtsValue);
    nts_bytes_held -= (size_t)map->slots * sizeof(int32_t);
    if (map->values) {
      nts_bytes_held -= (size_t)map->capacity * sizeof(NtsValue);
    }
    free(map->keys);
    free(map->values);
    free(map->index);
    map->keys = 0;
    map->values = 0;
    map->index = 0;
    return;
  }
  if (object->descriptor->kind != NTS_KIND_ARRAY) {
    return;
  }
  NtsArray *array = (NtsArray *)object;
  if (!nts_array_is_inline(array)) {
    nts_bytes_held -= (size_t)array->capacity * object->descriptor->size;
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
  nts_allocated++;
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
  if (!object || object->reserved == NTS_IMMORTAL) {
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
static NtsHeader *nts_dying = 0;
static bool nts_draining = false;

/* Destroy an object whose count has reached zero: give up what it holds, then
 * give the memory back. */
static void nts_destroy(NtsHeader *object) {
  object->reserved = (uintptr_t)nts_dying;
  nts_dying = object;
  if (nts_draining) {
    /* An outer call owns the list and will get to it. */
    return;
  }

  nts_draining = true;
  while (nts_dying) {
    NtsHeader *dead = nts_dying;
    nts_dying = (NtsHeader *)dead->reserved;
    /* This may link more objects into the list, which the loop picks up. */
    nts_release_contents(dead);
    nts_reclaimed++;
    nts_free(dead);
  }
  nts_draining = false;
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
static NtsHeader **nts_roots = 0;
static size_t nts_roots_len = 0;
static size_t nts_roots_cap = 0;
static NtsHeader **nts_work = 0;
static size_t nts_work_len = 0;
static size_t nts_work_cap = 0;
static size_t nts_candidates = 0;
static bool nts_collecting = false;

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
  nts_push(&nts_work, &nts_work_len, &nts_work_cap, object);
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
  nts_push(&nts_roots, &nts_roots_len, &nts_roots_cap, object);
  nts_candidates++;
}

void nts_release(NtsHeader *object) {
  if (!object || object->reserved == NTS_IMMORTAL) {
    return;
  }
  if (object->reserved > 1) {
    object->reserved--;
    nts_possible_root(object);
    /* Not while destroying: the dying list keeps its next pointer in the
     * count word, so an object on it has no count for the collector to
     * read. */
    if (!nts_draining && !nts_collecting &&
        nts_roots_len >= NTS_COLLECT_THRESHOLD) {
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
  nts_work_len = 0;
  nts_work_push(root);
  while (nts_work_len) {
    NtsHeader *object = nts_work[--nts_work_len];
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
  size_t floor = nts_work_len;
  nts_paint(root, NTS_BLACK);
  nts_work_push(root);
  while (nts_work_len > floor) {
    NtsHeader *object = nts_work[--nts_work_len];
    nts_each_reference(object, nts_scan_black_child);
  }
}

static void nts_scan_child(NtsHeader *child) { nts_work_push(child); }

static void nts_scan(NtsHeader *root) {
  nts_work_len = 0;
  nts_work_push(root);
  while (nts_work_len) {
    NtsHeader *object = nts_work[--nts_work_len];
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
static NtsHeader **nts_dead = 0;
static size_t nts_dead_len = 0;
static size_t nts_dead_cap = 0;

static void nts_collect_white_child(NtsHeader *child) { nts_work_push(child); }

static void nts_gather_white(NtsHeader *root) {
  nts_work_len = 0;
  nts_work_push(root);
  while (nts_work_len) {
    NtsHeader *object = nts_work[--nts_work_len];
    if (nts_color(object) != NTS_WHITE || (object->flags & NTS_BUFFERED)) {
      continue;
    }
    nts_paint(object, NTS_BLACK);
    nts_each_reference(object, nts_collect_white_child);
    nts_push(&nts_dead, &nts_dead_len, &nts_dead_cap, object);
  }
}

void nts_collect_cycles(void) {
  if (nts_collecting) {
    return;
  }
  nts_collecting = true;

  /* Mark. A candidate that is no longer purple was retained since it was
   * buffered, so it is reachable and not a root; one whose count reached zero
   * while buffered was left for exactly this moment. */
  size_t kept = 0;
  for (size_t index = 0; index < nts_roots_len; index++) {
    NtsHeader *root = nts_roots[index];
    if (nts_color(root) == NTS_PURPLE && root->reserved > 0 &&
        root->reserved != NTS_IMMORTAL) {
      nts_mark_gray(root);
      nts_roots[kept++] = root;
      continue;
    }
    root->flags &= ~NTS_BUFFERED;
    if (nts_color(root) == NTS_BLACK && root->reserved == 0) {
      nts_destroy(root);
    }
  }
  nts_roots_len = kept;

  for (size_t index = 0; index < nts_roots_len; index++) {
    nts_scan(nts_roots[index]);
  }

  /* Collect. The buffered flag is cleared first for every root, because
   * `nts_collect_white` refuses to free anything still buffered -- which is
   * how a root that is white but still in the buffer stays reachable until
   * its own turn. */
  for (size_t index = 0; index < nts_roots_len; index++) {
    nts_roots[index]->flags &= ~NTS_BUFFERED;
  }
  nts_dead_len = 0;
  for (size_t index = 0; index < nts_roots_len; index++) {
    nts_gather_white(nts_roots[index]);
  }
  nts_roots_len = 0;

  /* Every one of these is garbage and every reference between them has
   * already been accounted for, so this frees the memory and nothing else --
   * releasing contents here would decrement counts a second time. */
  for (size_t index = 0; index < nts_dead_len; index++) {
    nts_reclaimed++;
    nts_free(nts_dead[index]);
  }
  nts_dead_len = 0;
  nts_collecting = false;
}

size_t nts_cycle_candidates(void) { return nts_candidates; }

void nts_thrown(const NtsString *message) {
  fputs("nts: uncaught ", stderr);
  if (message) {
    /* Narrow strings are the common case and the only one worth spelling
     * carefully; a wide one is dumped as its code units rather than not at
     * all. */
    for (uint32_t at = 0; at < message->length; at++) {
      fputc((int)nts_unit(message, at), stderr);
    }
  }
  fputc('\n', stderr);
  abort();
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
  default:
    fprintf(stderr,
            NTS_REFUSED "String() of tag %u, which the lowering should have "
                        "refused\n",
            nts_value_tag(value));
    abort();
  }
}

void nts_bounds(double index, uint32_t length) {
  fprintf(stderr, NTS_REFUSED "index %g is outside [0, %u)\n", index, length);
  abort();
}

/* The shared part: everything but deciding what the elements start as. */
static NtsArray *nts_array_allocate(const NtsDescriptor *descriptor,
                                    double length) {
  if (!(length >= 0.0 && length <= 4294967295.0 &&
        length == (double)(uint32_t)length)) {
    fprintf(stderr, NTS_REFUSED "%g is not a valid array length\n", length);
    abort();
  }
  uint32_t count = (uint32_t)length;
  size_t bytes = sizeof(NtsArray) + (size_t)count * descriptor->size;
  NtsArray *array = (NtsArray *)nts_alloc(bytes);
  array->header.descriptor = descriptor;
  array->header.reserved = 1;
  nts_allocated++;
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

double nts_array_push(NtsArray *a, double value) {
  if (a->header.length == a->capacity) {
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
    nts_bytes_held += bytes;
    if (!nts_array_is_inline(a)) {
      /* Not the inline block, so it was one of ours to free. */
      nts_bytes_held -= (size_t)a->capacity * a->header.descriptor->size;
      free(a->elements);
    }
    a->elements = moved;
    a->capacity = wanted;
  }
  NTS_ITEMS(a, double)[a->header.length] = value;
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

static NtsString *nts_str_raw(uint32_t length, int wide);

/* Give storage the caller already has a string's header, instead of allocating
 * one.
 *
 * The count is `NTS_IMMORTAL`, which is what makes the rest of the system need
 * no new rule: retain and release already do nothing to an immortal object, and
 * the compiler emits a release wherever this string's live range ends whether
 * it is on the heap or not. `nts_allocated` is deliberately not touched -- this
 * did not allocate, and `nts_live_count` is how reference counting is tested.
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

NtsString *nts_concat(const NtsString *a, const NtsString *b) {
  return nts_concat_into(NULL, a, b);
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
static NtsString *nts_str_raw(uint32_t length, int wide) {
  size_t width = wide ? 2u : 1u;
  NtsString *out =
      (NtsString *)nts_alloc(sizeof(NtsHeader) + ((size_t)length + 1) * width);
  out->descriptor = wide ? &nts_desc_string2 : &nts_desc_string1;
  out->reserved = 1;
  nts_allocated++;
  out->flags = wide ? NTS_TWO_BYTE : 0u;
  out->length = length;
  if (wide) {
    NTS_ELEMENTS(out, uint16_t)[length] = 0;
  } else {
    NTS_ELEMENTS(out, unsigned char)[length] = 0;
  }
  return out;
}

static NtsString *nts_str_alloc(const uint16_t *units, uint32_t length) {
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

/* Where an index lands, or -1 for out of range. Negative counts from the end.
 */
static double nts_array_offset(const NtsArray *a, double at) {
  at = nts_to_integer(at);
  if (at < 0) {
    at += (double)a->header.length;
  }
  return (at < 0 || at >= (double)a->header.length) ? -1.0 : at;
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

NtsArray *nts_array_fill(NtsArray *a, double value) {
  double *items = nts_numbers(a);
  for (uint32_t at = 0; at < a->header.length; at++) {
    items[at] = value;
  }
  /* In place, returning what it was given -- which is what makes
   * `xs.fill(0).length` mean something. */
  return a;
}

NtsArray *nts_array_fill_bool(NtsArray *a, bool value) {
  bool *items = NTS_ITEMS(a, bool);
  for (uint32_t at = 0; at < a->header.length; at++) {
    items[at] = value;
  }
  return a;
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
  return a;
}

NtsArray *nts_array_reverse(NtsArray *a) {
  double *items = nts_numbers(a);
  for (uint32_t at = 0; at * 2u + 1u < a->header.length; at++) {
    double swap = items[at];
    items[at] = items[a->header.length - 1u - at];
    items[a->header.length - 1u - at] = swap;
  }
  return a;
}

NtsArray *nts_array_slice(const NtsArray *a, double from, double to) {
  /* Negative counts from the end, as `String.prototype.slice` does. */
  uint32_t start = nts_str_clamp(from, a->header.length, 1);
  uint32_t end = nts_str_clamp(to, a->header.length, 1);
  uint32_t count = end > start ? end - start : 0u;
  NtsArray *out = nts_array_new(a->header.descriptor, (double)count);
  if (count != 0) {
    memcpy(nts_numbers(out), nts_numbers(a) + start,
           (size_t)count * sizeof(double));
  }
  return out;
}

/* ECMAScript `Number::toString`, base 10, written from the specification.
 *
 * Not `printf`. `%.17g` gives seventeen significant digits whether or not they
 * are needed, so `0.1` prints as `0.10000000000000001`; `%g` also switches to
 * exponential notation at a threshold that is not JavaScript's. The
 * specification asks for the *shortest* decimal that reads back as the same
 * double, and then for four different layouts of it depending on where the
 * decimal point falls.
 *
 * Checked against node over 1039 values -- NaN, both zeros, both infinities,
 * the smallest denormal, the 1e21 and 1e-7 notation boundaries, 2^53 either
 * side, and a thousand pseudorandom values spanning 10^-22 to 10^21. Zero
 * differences; and with the search below truncated it differs on 1013 of them,
 * which is what makes the zero worth reporting. */
static int nts_shortest_digits(double x, char *s, int *n) {
  char buffer[64];
  /* Upward from one digit, so the first that reads back is the shortest. */
  for (int precision = 1; precision <= 17; precision++) {
    snprintf(buffer, sizeof buffer, "%.*e", precision - 1, x);
    if (strtod(buffer, NULL) == x) {
      const char *e = strchr(buffer, 'e');
      /* The digits are `snprintf`'s own `%e` output two lines up, so there is
       * no input here that could fail to convert. */
      /* NOLINTNEXTLINE(bugprone-unchecked-string-to-number-conversion) */
      *n = atoi(e + 1) + 1;
      int k = 0;
      for (const char *at = buffer; at < e; at++) {
        if (*at >= '0' && *at <= '9') {
          s[k++] = *at;
        }
      }
      /* The specification's `s` has no trailing zeros: 100 is s=1, n=3. */
      while (k > 1 && s[k - 1] == '0') {
        k--;
      }
      s[k] = '\0';
      return k;
    }
  }
  s[0] = '0';
  s[1] = '\0';
  *n = 1;
  return 1;
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

NtsString *nts_number_to_string(double x) {
  char out[64];
  char *at = out;
  if (x != x) {
    return nts_string_from_utf8("NaN", 3);
  }
  /* Negative zero prints as "0": the sign is not part of the answer. */
  if (x == 0.0) {
    return nts_string_from_utf8("0", 1);
  }
  if (x < 0.0) {
    *at++ = '-';
    x = -x;
  }
  if (x > 1.7976931348623157e308) {
    memcpy(at, "Infinity", 8);
    return nts_string_from_utf8(out, (size_t)(at - out) + 8);
  }

  char s[32];
  int n = 0;
  const int k = nts_shortest_digits(x, s, &n);

  if (k <= n && n <= 21) {
    /* Every digit, then the zeros that place them: 100. */
    memcpy(at, s, (size_t)k);
    memset(at + k, '0', (size_t)(n - k));
    at += n;
  } else if (0 < n && n <= 21) {
    /* The point falls inside the digits: 1.5. */
    memcpy(at, s, (size_t)n);
    at[n] = '.';
    memcpy(at + n + 1, s + n, (size_t)(k - n));
    at += k + 1;
  } else if (-6 < n && n <= 0) {
    /* A leading zero and the point, then the digits: 0.001. */
    *at++ = '0';
    *at++ = '.';
    memset(at, '0', (size_t)(-n));
    memcpy(at - n, s, (size_t)k);
    at += k - n;
  } else {
    /* Exponential, with the exponent's sign always written: 1e+21. */
    *at++ = s[0];
    if (k != 1) {
      *at++ = '.';
      memcpy(at, s + 1, (size_t)(k - 1));
      at += k - 1;
    }
    *at++ = 'e';
    const int exponent = n - 1;
    *at++ = exponent < 0 ? '-' : '+';
    at += snprintf(at, 16, "%d", exponent < 0 ? -exponent : exponent);
  }
  return nts_string_from_utf8(out, (size_t)(at - out));
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

static uint32_t nts_hash_key(NtsValue key, uint32_t kind) {
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

static bool nts_key_eq(NtsValue a, NtsValue b, uint32_t kind) {
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
    NTS_KIND_MAP, (uint32_t)sizeof(NtsMap), 0u, 1u, 0, 0, "Map", 1u, 0,
};

static NtsMap *nts_map_alloc(uint32_t kind, bool holds_values) {
  NtsMap *map = (NtsMap *)nts_alloc(sizeof(NtsMap));
  map->header.descriptor = &nts_desc_map;
  map->header.reserved = 1;
  map->header.flags = 0;
  map->header.length = 0;
  nts_allocated++;
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

NtsMap *nts_map_new(double kind) { return nts_map_alloc((uint32_t)kind, true); }
NtsMap *nts_set_new(double kind) {
  return nts_map_alloc((uint32_t)kind, false);
}

/* Where `key` lives, or -1.
 *
 * `insert_at` receives the slot a fresh key would take: the first DELETED slot
 * on the chain if there was one, so that deleting and reinserting does not
 * make the table grow, and the terminating EMPTY otherwise. */
static int32_t nts_map_find(const NtsMap *map, NtsValue key, uint32_t hash,
                            uint32_t *insert_at) {
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

  NtsValue *keys = (NtsValue *)malloc((size_t)wanted * sizeof(NtsValue));
  NtsValue *values = map->holds_values
                         ? (NtsValue *)malloc((size_t)wanted * sizeof(NtsValue))
                         : 0;
  uint32_t slots = 8u;
  while (slots < NTS_MAP_SLOTS_FOR(wanted)) {
    slots *= 2u;
  }
  int32_t *index = (int32_t *)malloc((size_t)slots * sizeof(int32_t));
  if (!keys || (map->holds_values && !values) || !index) {
    fprintf(stderr, "nts: out of memory growing a map\n");
    abort();
  }
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

  nts_bytes_held += (size_t)wanted * sizeof(NtsValue);
  nts_bytes_held += (size_t)slots * sizeof(int32_t);
  if (map->holds_values) {
    nts_bytes_held += (size_t)wanted * sizeof(NtsValue);
  }
  if (map->keys) {
    nts_bytes_held -= (size_t)map->capacity * sizeof(NtsValue);
    nts_bytes_held -= (size_t)map->slots * sizeof(int32_t);
    if (map->values) {
      nts_bytes_held -= (size_t)map->capacity * sizeof(NtsValue);
    }
    free(map->keys);
    free(map->values);
    free(map->index);
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
NtsValue nts_map_get(const NtsMap *map, NtsValue key) {
  int32_t at = nts_map_find(map, key, nts_hash_key(key, map->kind), 0);
  if (at < 0 || !map->values) {
    return nts_value_of_undefined();
  }
  return map->values[at];
}

bool nts_map_has(const NtsMap *map, NtsValue key) {
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

NtsMap *nts_map_set(NtsMap *map, NtsValue key, NtsValue value) {
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
    return map;
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
  return map;
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
    if (map->values) {
      nts_value_release(map->values[at]);
    }
  }
  for (uint32_t slot = 0; slot < map->slots; slot++) {
    map->index[slot] = NTS_MAP_EMPTY;
  }
  map->used = 0;
  map->header.length = 0;
}

NtsMap *nts_set_add(NtsMap *map, NtsValue key) {
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
NtsValue nts_map_key_at(const NtsMap *map, double at) {
  return map->keys[(uint32_t)at];
}

NtsValue nts_map_value_at(const NtsMap *map, double at) {
  return map->values ? map->values[(uint32_t)at] : nts_value_of_undefined();
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

static NtsHost nts_host;
static bool nts_host_installed = false;
static uint32_t nts_depth = 0;

void nts_host_install(const NtsHost *host) {
  nts_host = *host;
  nts_host_installed = true;
}

static void nts_require_host(const char *what) {
  if (!nts_host_installed) {
    fprintf(stderr, "nts: %s before a host was installed\n", what);
    abort();
  }
}

/* A growable ring of tasks.
 *
 * A ring rather than a list because the drain is FIFO and the whole point is
 * that it stays FIFO: reaction order is what the specification pins. */
typedef struct NtsQueue {
  NtsTask *items;
  uint32_t head;
  uint32_t len;
  uint32_t capacity;
} NtsQueue;

static NtsQueue nts_microtask_queue;
static NtsQueue nts_tick_queue;

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
  if (nts_host_installed && nts_host.enqueue_microtask) {
    nts_host.enqueue_microtask(nts_host.state, task);
    return;
  }
  nts_queue_push(&nts_microtask_queue, task);
}

void nts_enqueue_tick(NtsTask task) { nts_queue_push(&nts_tick_queue, task); }

bool nts_has_pending_work(void) {
  return nts_microtask_queue.len != 0 || nts_tick_queue.len != 0;
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
  if (nts_collecting || nts_draining || nts_roots_len == 0) {
    return;
  }
  nts_collect_cycles();
}

static void nts_process_ticks_and_rejections(void) {
  NtsTask task;
  do {
    while (nts_queue_shift(&nts_tick_queue, &task)) {
      task.run(task.state);
    }
    while (nts_queue_shift(&nts_microtask_queue, &task)) {
      task.run(task.state);
    }
  } while (nts_tick_queue.len != 0);
  nts_collect_at_checkpoint();
}

void nts_enter(void) { nts_depth++; }

void nts_leave(void) {
  if (nts_depth == 0) {
    fprintf(stderr, "nts: unbalanced nts_leave\n");
    abort();
  }
  nts_depth--;
  if (nts_depth != 0) {
    return;
  }
  /* A host that supplied `enqueue_microtask` checkpoints for us. */
  if (nts_host_installed && nts_host.enqueue_microtask) {
    return;
  }
  nts_process_ticks_and_rejections();
}

void nts_checkpoint(void) {
  /* The same opt-out `nts_leave` makes, for the same reason: a host that
   * supplied `enqueue_microtask` owns checkpointing, and draining here would
   * be a second ordering beside its one. */
  if (nts_host_installed && nts_host.enqueue_microtask) {
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
  return !nts_host_installed || !nts_host.is_owner_thread ||
         nts_host.is_owner_thread(nts_host.state);
}

/* Posting is thin, and these exist for the assertion and the contract note
 * rather than for the indirection. */
void nts_post_task(NtsTask task) {
  nts_require_host("nts_post_task");
  nts_host.post_task(nts_host.state, task);
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
  return nts_host.post_delayed(nts_host.state, task, nts_delay(delay_ms),
                               repeating);
}

void nts_cancel_delayed(NtsTimerId id) {
  nts_require_host("nts_cancel_delayed");
  nts_host.cancel_delayed(nts_host.state, id);
}

/* The one entry point that is safe off-thread. Everything a platform completes
 * on its own thread -- OkHttp, URLSession, WinHTTP, libuv's file pool -- comes
 * home through here before it may touch the heap. */
void nts_post_from_any_thread(NtsTask task) {
  nts_require_host("nts_post_from_any_thread");
  nts_host.post_from_any_thread(nts_host.state, task);
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
static const NtsDescriptor nts_desc_reaction = {
    NTS_KIND_OBJECT,
    (uint32_t)sizeof(NtsReaction),
    2u,
    1u,
    nts_reaction_offsets,
    0,
    "Reaction",
    0u,
    0,
};

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

static const NtsDescriptor nts_desc_promise = {
    NTS_KIND_OBJECT,
    (uint32_t)sizeof(NtsPromise),
    2u,
    1u,
    nts_promise_offsets,
    0,
    "Promise",
    1u,
    nts_promise_erased,
};

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
  return object->descriptor->kind == NTS_KIND_STRING ? NTS_TAG_STRING
                                                     : NTS_TAG_OBJECT;
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
};

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
};

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

static const NtsDescriptor nts_desc_callback = {
    NTS_KIND_OBJECT,
    (uint32_t)sizeof(NtsCallback),
    1u,
    1u,
    nts_callback_offsets,
    0,
    "Callback",
    0u,
    0,
};

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
