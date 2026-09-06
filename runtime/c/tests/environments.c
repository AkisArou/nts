/* Environments: that a process-wide diagnostic still answers for the process.
 *
 * The counters used to be file-scope statics, so "how many objects are live"
 * was a load. They are per-environment now, and every one of those questions
 * became a sum -- which is the whole of what keeps the memory harness, the
 * counter-reading suites here, and the differential leak check working after
 * the move. Aggregation on read is also why none of it had to become atomic:
 * the cost is paid once by whoever asks instead of on every retain by everyone
 * who does not.
 *
 * So the checks that matter are the ones taken from OUTSIDE the environment
 * that did the allocating. A `nts_total` that returned only the current
 * environment's counter would pass every check written from the inside, and
 * this file would agree that a broken aggregate was a working one. */
#include <stddef.h>
#include <stdio.h>

#include "nts_runtime.h"

typedef struct Cell {
  NtsHeader header;
  NtsHeader *link;
} Cell;

static const uint32_t cell_refs[] = {offsetof(Cell, link)};
static const NtsDescriptor cell_desc = {
    NTS_KIND_OBJECT, sizeof(Cell), 1u, 1u, cell_refs, 0, "Cell", 0u, 0};

static int failures;

static void check(int held, const char *what) {
  if (held) {
    printf("ok   %s\n", what);
  } else {
    printf("FAIL %s\n", what);
    failures++;
  }
}

static Cell *make(void) {
  Cell *cell = (Cell *)nts_object_new(&cell_desc);
  cell->link = 0;
  return cell;
}

/* The aggregation itself, observed from the outside. */
static void a_second_environment_is_counted_by_the_process(void) {
  size_t baseline = nts_live_count();

  NtsEnvironment *other = nts_environment_create();
  check(nts_live_count() == baseline,
        "a new environment holds nothing and changes no total");

  NtsEnvironmentScope scope = nts_environment_enter(other);
  Cell *cell = make();
  nts_environment_leave(&scope);

  /* Taken from the default environment, about an object the other one owns.
     This is the check a per-environment read would fail. */
  check(nts_live_count() == baseline + 1,
        "an object allocated in another environment is in the process total");

  scope = nts_environment_enter(other);
  nts_release((NtsHeader *)cell);
  nts_environment_leave(&scope);

  check(nts_live_count() == baseline,
        "and leaves the total when it is released");

  nts_environment_destroy(other);
  check(nts_live_count() == baseline,
        "closing an emptied environment changes nothing");
}

/* Entering nests, and leaving restores rather than clears. */
static void entering_nests_and_leaving_restores(void) {
  NtsEnvironment *outer = nts_environment_current();

  NtsEnvironment *a = nts_environment_create();
  NtsEnvironment *b = nts_environment_create();

  NtsEnvironmentScope first = nts_environment_enter(a);
  check(nts_environment_current() == a,
        "entering makes an environment current");

  NtsEnvironmentScope second = nts_environment_enter(b);
  check(nts_environment_current() == b, "and a nested entry replaces it");

  nts_environment_leave(&second);
  check(nts_environment_current() == a,
        "leaving the inner one restores the outer, rather than clearing it");

  nts_environment_leave(&first);
  check(nts_environment_current() == outer,
        "and leaving again restores the first");

  nts_environment_destroy(a);
  nts_environment_destroy(b);
}

/* A measurement window is process-wide too, or a reset taken in one
   environment leaves another's counters standing and the next total is wrong
   by however much that one had already done. */
static void resetting_the_window_clears_every_environment(void) {
  NtsEnvironment *other = nts_environment_create();

  NtsEnvironmentScope scope = nts_environment_enter(other);
  Cell *cell = make();
  nts_environment_leave(&scope);

  check(nts_counted_allocations() > 0,
        "the other environment's allocation is in the window");

  nts_counting_reset();
  check(nts_counted_allocations() == 0,
        "and the reset reaches an environment that is not current");

  scope = nts_environment_enter(other);
  nts_release((NtsHeader *)cell);
  nts_environment_leave(&scope);
  nts_environment_destroy(other);
}

/* The platform slot: one managed reference the environment owns.
 *
 * What it replaces is a module-level `let` in shared TypeScript, which every
 * environment in the process would share -- so the checks that matter are the
 * ones about *two* environments holding different values, and about the
 * reference being given back when one closes. A slot that leaked would make a
 * closed environment look occupied forever; a slot that did not retain would
 * hand out a pointer to something already reclaimed. */
static void the_platform_slot_is_owned_per_environment(void) {
  size_t baseline = nts_live_count();

  Cell *first = make();
  nts_environment_install_platform((NtsHeader *)first);
  /* The install retained, so giving up the local leaves it live. */
  nts_release((NtsHeader *)first);
  check(nts_live_count() == baseline + 1, "installing retains the runtime");
  check(nts_environment_platform() == (NtsHeader *)first,
        "and reading gives back what was installed");

  Cell *second = make();
  nts_environment_install_platform((NtsHeader *)second);
  nts_release((NtsHeader *)second);
  check(nts_environment_platform() == (NtsHeader *)second,
        "installing over replaces the reference");
  /* Collected first, and that is a fact about the runtime rather than a
     convenience here: a release that takes a count to zero leaves the object
     alone when the candidate buffer is holding it, so the reference really was
     given up and the memory comes back at the next collection. Checking the
     count without collecting measures the buffer, not the ownership. */
  nts_collect_cycles();
  check(nts_live_count() == baseline + 1,
        "and releases the one it replaced rather than keeping both");

  /* Another environment's slot is its own, which is the whole point. */
  NtsEnvironment *other = nts_environment_create();
  NtsEnvironmentScope scope = nts_environment_enter(other);
  Cell *theirs = make();
  nts_environment_install_platform((NtsHeader *)theirs);
  nts_release((NtsHeader *)theirs);
  check(nts_environment_platform() == (NtsHeader *)theirs,
        "a second environment reads its own runtime");
  nts_environment_leave(&scope);
  check(nts_environment_platform() == (NtsHeader *)second,
        "and the first still reads the one it installed");

  /* Closing gives the reference back. Without this the environment could not
     be destroyed at all -- `destroy` refuses one that still holds objects, so
     a slot that leaked would fail the check below rather than pass quietly. */
  nts_environment_destroy(other);
  check(nts_live_count() == baseline + 1,
        "closing an environment releases the runtime it held");

  Cell *last = make();
  nts_environment_install_platform((NtsHeader *)last);
  nts_release((NtsHeader *)last);
  nts_release((NtsHeader *)second);
  (void)last;
}

int main(void) {
  a_second_environment_is_counted_by_the_process();
  entering_nests_and_leaving_restores();
  resetting_the_window_clears_every_environment();
  the_platform_slot_is_owned_per_environment();
  return failures != 0;
}
