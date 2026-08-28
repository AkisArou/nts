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
const NtsDescriptor nts_desc_ref = {NTS_KIND_ARRAY, sizeof(void *), 1, 1, 0, 0,
                                    "reference"};
const NtsDescriptor nts_desc_string1 = {NTS_KIND_STRING, 1, 0, 0, 0, 0,
                                        "string"};
const NtsDescriptor nts_desc_string2 = {NTS_KIND_STRING, 2, 0, 0, 0, 0,
                                        "string"};

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
static void nts_free(void *object) {
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
  if (descriptor->references == 0) {
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
#define NTS_COLLECT_THRESHOLD 10000u

static void nts_push(NtsHeader ***buffer, size_t *len, size_t *cap,
                     NtsHeader *object) {
  if (*len == *cap) {
    size_t grown = *cap ? *cap * 2u : 64u;
    NtsHeader **moved =
        (NtsHeader **)realloc(*buffer, grown * sizeof(NtsHeader *));
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

void nts_bounds(double index, uint32_t length) {
  fprintf(stderr, "nts: index %g is outside [0, %u)\n", index, length);
  abort();
}

/* The shared part: everything but deciding what the elements start as. */
static NtsArray *nts_array_allocate(const NtsDescriptor *descriptor, double length) {
  if (!(length >= 0.0 && length <= 4294967295.0 &&
        length == (double)(uint32_t)length)) {
    fprintf(stderr, "nts: %g is not a valid array length\n", length);
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
  memset(array->elements, 0xA5, (size_t)array->header.length * descriptor->size);
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
    if (a->elements != (unsigned char *)a + sizeof(NtsArray)) {
      /* Not the inline block, so it was one of ours to free. */
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
  /* Popping nothing is `undefined`, which for a number is NaN. */
  if (a->header.length == 0) {
    return (double)NAN;
  }
  a->header.length--;
  return NTS_ITEMS(a, double)[a->header.length];
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
 * did not allocate, and `nts_live_count` is how reference counting is tested. */
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
    memcpy(NTS_ELEMENTS(out, uint16_t), units, (size_t)length * sizeof(uint16_t));
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

NtsString *nts_str_char_at_into(NtsHeader *into, const NtsString *s, double at) {
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
    fprintf(stderr, "nts: repeat produces a string longer than 2^32-1\n");
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
static double *nts_numbers(const NtsArray *a) {
  return NTS_ITEMS(a, double);
}

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
  /* Negative counts from the end, and out of range is `undefined` -- which
   * for a number is NaN, the only value a double has to say "not one". */
  at = nts_to_integer(at);
  if (at < 0) {
    at += (double)a->header.length;
  }
  if (at < 0 || at >= (double)a->header.length) {
    return (double)NAN;
  }
  return nts_numbers(a)[(uint32_t)at];
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
bool nts_is_finite(double x) {
    return isfinite(x);
}

/* Finite and equal to its own truncation. `Math.floor` would do as well; the
 * point is that infinity is not an integer even though it has no fraction. */
bool nts_is_integer(double x) {
    return isfinite(x) && trunc(x) == x;
}

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
    if ((base == 1.0 || base == -1.0) && (exponent == INFINITY || exponent == -INFINITY)) {
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
double nts_math_fround(double x) {
    return (double)(float)x;
}

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
