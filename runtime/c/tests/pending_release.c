/* A foreign release can re-enter compiled code while another frame is
 * propagating a throw. That callback must see its own pending state, not the
 * unrelated outer exception. The callback below has the same raising shape as
 * this program emitted by the clean 9761b99dd7d3 compiler:
 *
 *   function inner(n: number): number {
 *     if (n < 0) throw 67;
 *     return 1;
 *   }
 *   export function callback(n: number): number {
 *     try { return inner(n); } catch { return 7; }
 *   }
 *
 * Node answers 1 at 0 and 7 at -1. A pending outer throw must not change either
 * answer or be taken by the callback's catch. */
#include "nts_runtime.h"
#include "nts_test_host.h"
#include <stddef.h>
#include <stdio.h>

typedef struct Owner {
  NtsHeader header;
  void *handle;
} Owner;

static unsigned failures;
static unsigned released;
static double argument;
static double answer;

static void expect(const char *what, bool holds) {
  printf("%s %s\n", holds ? "ok " : "FAIL", what);
  failures += !holds;
}

static double inner(double n) {
  if (n < 0) {
    nts_raise(nts_value_of_number(67));
    return 0;
  }
  return 1;
}

static double callback(double n) {
  double result = inner(n);
  if (nts_raising()) {
    nts_value_release(nts_raise_take());
    return 7;
  }
  return result;
}

static void dispose(void *handle) {
  (void)handle;
  released++;
  nts_callback_enter();
  answer = callback(argument);
  nts_callback_leave();
}

static const NtsFamilyOps ops = {.retain = NULL, .release = dispose};
static const NtsForeignSlot slots[] = {
    {.offset = offsetof(Owner, handle), .family = NTS_FAMILY_NONE, .ops = &ops},
};
static const NtsDescriptor descriptor = {.kind = NTS_KIND_OBJECT,
                                         .size = sizeof(Owner),
                                         .name = "Owner",
                                         .foreign = 1,
                                         .foreign_slots = slots};

static void drop(double n) {
  argument = n;
  Owner *owner = (Owner *)nts_object_new(&descriptor);
  owner->handle = &answer;
  nts_release((NtsHeader *)owner);
}

static void one(bool outer, double n) {
  if (outer) {
    nts_raise(nts_value_of_number(22));
  }
  drop(n);
  expect(outer ? "pending outer throw does not enter the callback's catch"
               : "control callback catches only its own throw",
         answer == (n < 0 ? 7 : 1));
  expect(outer ? "release preserves the outer pending flag"
               : "control release leaves no pending flag",
         (nts_raising() != 0) == outer);
  if (nts_raising()) {
    NtsValue raised = nts_raise_take();
    expect("release preserves the outer payload",
           nts_value_tag(raised) == NTS_TAG_NUMBER &&
               nts_value_number(raised) == 22);
    nts_value_release(raised);
  }
}

int main(void) {
  nts_test_host_install();
  size_t baseline = nts_live_count();
  one(false, 0);
  one(true, 0);
  one(false, -1);
  one(true, -1);
  expect("each owned foreign field is released once", released == 4);
  nts_collect_cycles();
  expect("release leaves no live owner", nts_live_count() == baseline);
  return failures ? 1 : 0;
}
