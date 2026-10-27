/* Call regions: memory for everything one call makes, given back at once.
 *
 * What the runtime promises the compiler, checked without the compiler: while
 * a region is active every object, string, array, table and buffer comes from
 * it; each is immortal, so a stray retain or release from outside changes
 * nothing; a suspend puts allocation back where it was; a reset gives the
 * blocks back and brings the live counts and bytes back to where they were
 * before the open -- including what a growth inside the region moved, and in
 * any order across regions; and a cycle collection due inside a region's call
 * waits for it to end.
 *
 * Reference counting only: under NoGC nothing is freed and a region is a
 * no-op. Built once plainly and once under `NTS_POISON`, where a reset fills
 * the blocks it keeps and memory the facts say cannot be given back inside a
 * region is refused by name. */
#include <stddef.h>
#include <stdio.h>
#include <string.h>

#include "nts_test_host.h"

static int failures;

static void check(const char *what, bool ok) {
  if (ok) {
    printf("ok   %s\n", what);
  } else {
    printf("FAIL %s\n", what);
    failures++;
  }
}

/* Whether the runtime keeps blocks a reset gave back, which it does not under
 * AddressSanitizer: there a reset frees every block, so a read after it is the
 * sanitizer's to report. The same test as the runtime's `NTS_RECYCLES`. */
#if defined(__SANITIZE_ADDRESS__)
#define KEEPS_BLOCKS 0
#elif defined(__has_feature)
#if __has_feature(address_sanitizer)
#define KEEPS_BLOCKS 0
#else
#define KEEPS_BLOCKS 1
#endif
#else
#define KEEPS_BLOCKS 1
#endif

typedef struct Node {
  NtsHeader header;
  NtsHeader *a;
  double value;
} Node;

static const uint32_t node_refs[] = {offsetof(Node, a)};
static const NtsDescriptor node_desc = {
    NTS_KIND_OBJECT,   sizeof(Node), 1u,   1u,   node_refs, 0,   "Node", 0u, 0,
    NTS_ARRAY_UNKNOWN, 0u,           NULL, NULL, NULL,      NULL};

static const NtsDescriptor numbers_desc = {NTS_KIND_ARRAY,
                                           (uint32_t)sizeof(double),
                                           0u,
                                           0u,
                                           0,
                                           0,
                                           "number[]",
                                           0u,
                                           0,
                                           NTS_ARRAY_FLOAT,
                                           0u,
                                           NULL,
                                           NULL,
                                           NULL,
                                           NULL};

static const NtsDescriptor refs_desc = {NTS_KIND_ARRAY,
                                        (uint32_t)sizeof(void *),
                                        1u,
                                        1u,
                                        0,
                                        0,
                                        "Node[]",
                                        0u,
                                        0,
                                        NTS_ARRAY_REFERENCE,
                                        0u,
                                        NULL,
                                        NULL,
                                        NULL,
                                        NULL};

static Node *node(double value) {
  Node *made = (Node *)nts_object_new(&node_desc);
  made->value = value;
  return made;
}

static NtsString *text(const char *s) {
  return nts_string_from_utf8(s, (uint32_t)strlen(s));
}

/* Everything a region-safe call makes, of every kind that owns storage. */
static void everything_comes_from_the_active_region(void) {
  size_t bytes = nts_live_bytes();
  size_t count = nts_live_count();

  NtsRegion *region = nts_region_open();
  Node *n = node(1.0);
  NtsArray *numbers = nts_array_new(&numbers_desc, 0);
  for (int i = 0; i < 100; i++) {
    nts_array_push(numbers, (double)i);
  }
  NtsArray *refs = nts_array_new(&refs_desc, 0);
  for (int i = 0; i < 40; i++) {
    nts_array_push_ref(refs, node((double)i));
  }
  NtsString *joined = nts_concat(text("call "), text("region"));
  NtsMap *map = nts_map_new(NTS_KEY_NUMBER);
  for (int i = 0; i < 100; i++) {
    nts_map_set(map, nts_value_of_number(i), nts_value_of_number(i * 2),
                map->kind);
  }
  NtsBuffer *buffer = nts_buffer_new(64);
  nts_region_suspend(region);

  check("an object is the region's", nts_region_owns(region, n));
  check("an array grown past its inline elements is the region's, and so are "
        "its elements",
        nts_region_owns(region, numbers) &&
            nts_region_owns(region, numbers->elements) &&
            numbers->header.length == 100 &&
            ((double *)numbers->elements)[99] == 99.0);
  check("a reference array grown three times keeps every element",
        nts_region_owns(region, refs->elements) && refs->header.length == 40 &&
            ((Node **)refs->elements)[39]->value == 39.0);
  check("a string is the region's",
        nts_region_owns(region, joined) && joined->length == 11);
  check("a map rehashed past its first table is the region's, table and all",
        nts_region_owns(region, map) && nts_region_owns(region, map->keys) &&
            nts_value_number(
                nts_map_get(map, nts_value_of_number(99), map->kind)) == 198.0);
  {
    bool zero = buffer && nts_region_owns(region, buffer) &&
                nts_region_owns(region, buffer->bytes);
    for (size_t i = 0; zero && i < 64; i++) {
      zero = buffer->bytes[i] == 0;
    }
    check("a buffer's bytes are the region's, and read as zeroes", zero);
  }
  check("what a region makes is immortal",
        n->header.reserved == NTS_IMMORTAL &&
            numbers->header.reserved == NTS_IMMORTAL &&
            joined->reserved == NTS_IMMORTAL &&
            map->header.reserved == NTS_IMMORTAL);

  /* A stray retain and release from code outside the call: nothing moves. */
  nts_retain(&n->header);
  nts_release(&n->header);
  nts_release(&n->header);
  check("a retain or release of a region object changes nothing",
        n->header.reserved == NTS_IMMORTAL && n->value == 1.0);

  check("the region's objects are live until its reset",
        nts_live_count() > count && nts_live_bytes() > bytes);
  nts_region_reset(region);
  check("a reset brings the live count back to where the open found it",
        nts_live_count() == count);
  check("and the live bytes, growth inside the region included",
        nts_live_bytes() == bytes);
}

static void a_suspend_puts_allocation_back_on_the_heap(void) {
  size_t bytes = nts_live_bytes();
  size_t count = nts_live_count();
  NtsRegion *region = nts_region_open();
  Node *inside = node(1.0);
  nts_region_suspend(region);
  Node *outside = node(2.0);
  check("after a suspend, an allocation is the heap's, counted once",
        !nts_region_owns(region, outside) && outside->header.reserved == 1u);
  nts_region_reset(region);
  check("a reset leaves what was made beside it alone",
        outside->value == 2.0 && outside->header.reserved == 1u);
  (void)inside;
  nts_release(&outside->header);
  check("and the counts come back once that is released too",
        nts_live_count() == count && nts_live_bytes() == bytes);
}

static void two_regions_reset_out_of_order(void) {
  size_t bytes = nts_live_bytes();
  size_t count = nts_live_count();
  NtsRegion *first = nts_region_open();
  Node *a = node(1.0);
  nts_region_suspend(first);
  NtsRegion *second = nts_region_open();
  Node *b = node(2.0);
  NtsString *s = text("still here");
  nts_region_suspend(second);
  check("two regions hold their own objects",
        nts_region_owns(first, a) && !nts_region_owns(first, b) &&
            nts_region_owns(second, b) && !nts_region_owns(second, a));
  nts_region_reset(first);
  check("resetting the first leaves the second's objects whole",
        b->value == 2.0 && s->length == 10 &&
            NTS_ELEMENTS(s, unsigned char)[0] == 's');
  nts_region_reset(second);
  check("both reset, out of order: the counts are back",
        nts_live_count() == count && nts_live_bytes() == bytes);
}

/* A region-safe call that itself contains a region site: activations nest
 * like the calls they bracket. */
static void activations_nest(void) {
  size_t bytes = nts_live_bytes();
  size_t count = nts_live_count();
  NtsRegion *outer = nts_region_open();
  Node *before = node(1.0);
  NtsRegion *inner = nts_region_open();
  Node *in = node(2.0);
  nts_region_suspend(inner);
  Node *after = node(3.0);
  nts_region_suspend(outer);
  check("an inner region's objects are its own",
        nts_region_owns(inner, in) && !nts_region_owns(outer, in));
  check("the outer region resumes when the inner one is suspended",
        nts_region_owns(outer, before) && nts_region_owns(outer, after));
  Node *heap = node(4.0);
  check("and the heap after both", heap->header.reserved == 1u);
  nts_release(&heap->header);
  nts_region_reset(inner);
  check("the inner reset gives back only its own",
        before->value == 1.0 && after->value == 3.0 &&
            nts_live_count() > count);
  nts_region_reset(outer);
  check("both reset: the counts are back",
        nts_live_count() == count && nts_live_bytes() == bytes);
}

/* A throw out of the region's call reaches its reset before its suspend. */
static void a_reset_of_the_active_region_suspends_it(void) {
  size_t bytes = nts_live_bytes();
  size_t count = nts_live_count();
  NtsRegion *region = nts_region_open();
  (void)node(1.0);
  nts_region_reset(region);
  Node *heap = node(2.0);
  check("a reset of the active region puts allocation back on the heap",
        heap->header.reserved == 1u);
  nts_release(&heap->header);
  check("and the counts are back",
        nts_live_count() == count && nts_live_bytes() == bytes);
}

static void many_blocks_and_a_large_allocation(void) {
  size_t bytes = nts_live_bytes();
  size_t count = nts_live_count();
  NtsRegion *region = nts_region_open();
  Node *first = node(0.0);
  /* 100,000 doubles, 800 KB: the first fits in what is left of the block and
   * is bumped there; the second does not, and is past a quarter of a block,
   * so it gets one of its own -- and the next small allocation still comes
   * from the space left in the first block rather than abandoning it. */
  NtsArray *large = nts_array_new(&numbers_desc, 100000);
  NtsArray *larger = nts_array_new(&numbers_desc, 100000);
  Node *next = node(1.0);
  uintptr_t block = (uintptr_t)first;
  uintptr_t apart = (uintptr_t)larger;
  check("a large allocation that no longer fits gets a block of its own",
        apart < block || apart >= block + ((uintptr_t)1 << 20));
  check("and the block being bumped through stays in use",
        (uintptr_t)next > (uintptr_t)large &&
            (uintptr_t)next - block < ((uintptr_t)1 << 20));
  check("both are the region's", nts_region_owns(region, large) &&
                                     nts_region_owns(region, larger) &&
                                     larger->header.length == 100000);
  /* About 3.2 MB of nodes: several blocks. */
  Node *last = 0;
  for (int i = 0; i < 80000; i++) {
    last = node((double)i);
  }
  nts_region_suspend(region);
  check("a region spanning several blocks keeps every object",
        last->value == 79999.0 && nts_region_owns(region, last));
  nts_region_reset(region);
  check("all of it given back: the counts are back",
        nts_live_count() == count && nts_live_bytes() == bytes);
}

static void a_reset_keeps_blocks_for_the_next_open(void) {
#if KEEPS_BLOCKS
  NtsRegion *first = nts_region_open();
  Node *n = node(5.0);
  nts_region_reset(first);
#if NTS_POISON
  /* Kept, and filled: a read through a pointer that outlived its region reads
   * a pattern rather than the value it had. */
  check("a kept block is filled on reset",
        ((const unsigned char *)n)[sizeof(NtsHeader)] == 0xA5u);
#else
  (void)n;
#endif
  NtsRegion *second = nts_region_open();
  check("the next open reuses the block the reset kept",
        (void *)second == (void *)first);
  nts_region_reset(second);
#else
  check("a reset under AddressSanitizer keeps nothing for it to miss", true);
#endif
}

/* Heap garbage in a cycle, buffered before the open: a collection asked for
 * inside the call waits, and one after it frees the cycle. */
/* The handle compiled code holds: a counted box whose death is the reset. */
static void the_handle_resets_its_region_when_it_dies(void) {
  size_t bytes = nts_live_bytes();
  size_t count = nts_live_count();
  /* An argument the call keeps in what it makes, and whose caller lets go of
   * it before the result is done with. */
  Node *argument = node(9.0);
  NtsHeader *box = nts_region_begin();
  check("the handle is a counted object on the heap",
        box && box->reserved == 1u);
  nts_region_keep(box, &argument->header);
  Node *made = node(1.0);
  made->a = &argument->header;
  nts_region_end_call(box);
  Node *after = node(2.0);
  check("after the call ends, allocation is the heap's",
        after->header.reserved == 1u);
  nts_release(&after->header);
  nts_release(&argument->header);
  nts_region_hold(box);
  check("a kept argument outlives its caller's release until the reset",
        argument->value == 9.0 && ((Node *)made->a)->value == 9.0);
  nts_release(box);
  /* The caller's release left the argument a cycle candidate, which a count
   * reaching zero does not free until a collection runs. */
  nts_collect_cycles();
  check("the handle's death resets the region and gives the argument back",
        nts_live_count() == count && nts_live_bytes() == bytes);
}

static void a_collection_waits_for_the_call(void) {
  size_t count = nts_live_count();
  Node *a = node(1.0);
  Node *b = node(2.0);
  nts_retain(&b->header);
  a->a = &b->header;
  nts_retain(&a->header);
  b->a = &a->header;
  nts_release(&a->header);
  nts_release(&b->header);
  NtsRegion *region = nts_region_open();
  nts_collect_cycles();
  check("a collection inside a region's call waits",
        nts_live_count() == count + 2u);
  nts_region_suspend(region);
  nts_collect_cycles();
  check("and the next one after it frees the cycle", nts_live_count() == count);
  nts_region_reset(region);
  check("which the reset does not count again", nts_live_count() == count);
}

int main(void) {
  size_t bytes = nts_live_bytes();
  size_t count = nts_live_count();
  everything_comes_from_the_active_region();
  a_suspend_puts_allocation_back_on_the_heap();
  two_regions_reset_out_of_order();
  activations_nest();
  a_reset_of_the_active_region_suspends_it();
  many_blocks_and_a_large_allocation();
  a_reset_keeps_blocks_for_the_next_open();
  a_collection_waits_for_the_call();
  the_handle_resets_its_region_when_it_dies();
  check("the suite as a whole leaves nothing live",
        nts_live_count() == count && nts_live_bytes() == bytes);
  if (failures) {
    printf("%d region check(s) FAILED\n", failures);
    return 1;
  }
  printf("all region checks passed\n");
  return 0;
}
