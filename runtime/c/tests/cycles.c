/* The cycle collector's ordering, which is the part of it that has no oracle.
 *
 * Every other runtime suite here transcribes its expected answers from node.
 * This one cannot: node has no observable cycle collector, and the question is
 * not what the program computes but whether the memory comes back. So these
 * are white-box checks -- they build a heap state by hand, run one collection,
 * and say what must be true afterwards.
 *
 * Both of them are regressions of one bug, and it is a bug about *when*. The
 * mark pass used to destroy a candidate whose count had already reached zero,
 * in the middle of the same loop that was trial-deleting the other candidates.
 * Destroying runs real releases, and a real release landing on an object whose
 * count has been trial-decremented is reading a number that does not mean what
 * it says. */
#include <stddef.h>
#include <stdio.h>

#include "nts_runtime.h"

typedef struct Node {
  NtsHeader header;
  NtsHeader *a;
  NtsHeader *b;
} Node;

static const uint32_t node_refs[] = {offsetof(Node, a), offsetof(Node, b)};
static const NtsDescriptor node_desc = {
    NTS_KIND_OBJECT, sizeof(Node), 2u, 1u, node_refs, 0, "Node", 0u, 0};

static int failures;

static void check(int held, const char *what) {
  if (held) {
    printf("ok   %s\n", what);
  } else {
    printf("FAIL %s\n", what);
    failures++;
  }
}

static Node *make(void) {
  Node *node = (Node *)nts_object_new(&node_desc);
  node->a = 0;
  node->b = 0;
  return node;
}

/* A linked list built head first, which is what `list.push_front` lowers to and
 * what half the benchmark suite does.
 *
 * Every link but the newest is decremented without reaching zero -- the old
 * head loses the list's reference and gains the new head's -- so every one of
 * them is buffered as a cycle candidate. Dropping the list then takes the
 * newest to zero and cascades, and the cascade stops at the first buffered
 * link, which is left for the collector.
 *
 * That is all correct. What was not is what the collector then did with it: it
 * destroyed that link while it was marking the others, and the release took the
 * next one to zero after it had already been marked gray. A gray object
 * repainted black is skipped by the scan for not being gray and by the gather
 * for not being white, and emptying the buffer drops the last pointer to it.
 * One link, at every length above two, forever. */
static void a_chain_built_head_first_is_reclaimed_whole(void) {
  /* Read here, not once for the file. Sharing one baseline across checks means
     a check that leaks moves the floor under the next one -- and it did: the
     leak below hid the shortfall in the check after it exactly, so the second
     check passed against the very runtime it was written to fail against. */
  size_t baseline = nts_live_count();
  Node *top = 0;
  for (int index = 0; index < 33; index++) {
    Node *made = make();
    nts_retain((NtsHeader *)top);
    made->a = (NtsHeader *)top;
    Node *previous = top;
    top = made;
    nts_release((NtsHeader *)previous);
  }
  nts_release((NtsHeader *)top);
  nts_collect_cycles();
  check(nts_live_count() == baseline,
        "a chain built head first is reclaimed whole");
}

/* The same ordering, one step worse.
 *
 * `keeper` is a live candidate and `dying` is one whose count has already
 * reached zero, and both point at `shared`. Marking `keeper` gray trial-deletes
 * its edge, so `shared` reads one -- which is the truth about references from
 * outside the subgraph and a lie about references in total.
 *
 * Destroying `dying` at that moment releases `shared` against that number. It
 * reaches zero, and `shared` was never itself a candidate, so nothing defers
 * it: it is freed on the spot, while `keeper` still points at it. The scan then
 * walks `keeper` and reads it. That is a use-after-free, and the only reason it
 * was not the first symptom is that a leak is quieter.
 *
 * Checked by the live count rather than by crashing, because reading freed
 * memory is entitled to do nothing at all. */
static void a_dying_root_does_not_free_what_a_live_one_holds(void) {
  size_t baseline = nts_live_count();
  Node *shared = make();
  Node *keeper = make();
  Node *dying = make();
  keeper->a = (NtsHeader *)shared;
  dying->a = (NtsHeader *)shared;

  /* Set by hand: this is the heap state the collector has to survive, and
     reaching it through the public operations would take a program. */
  shared->header.reserved = 2; /* the two field edges, and nothing else */
  keeper->header.reserved = 2;
  nts_release((NtsHeader *)keeper); /* buffered first, and still live */
  dying->header.reserved = 2;
  nts_release((NtsHeader *)dying); /* buffered second */
  nts_release((NtsHeader *)dying); /* and now at zero, left for the collector */

  nts_collect_cycles();
  check(nts_live_count() == baseline + 2,
        "a dying root does not free what a live one holds");

  nts_release((NtsHeader *)keeper);
  nts_collect_cycles();
  check(nts_live_count() == baseline, "and both are reclaimed once it lets go");
}

int main(void) {
  a_chain_built_head_first_is_reclaimed_whole();
  a_dying_root_does_not_free_what_a_live_one_holds();
  return failures != 0;
}
