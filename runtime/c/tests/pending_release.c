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
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

typedef struct Owner {
  NtsHeader header;
  void *handle;
} Owner;

static unsigned failures;
static unsigned released;
static double argument;
static double answer;
static unsigned escape_mode;

static void *keep(void *handle) { return handle; }
static void keep_tagged(void *handle) { (void)handle; }

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
  if (!handle) {
    return;
  }
  released++;
  nts_callback_enter();
  if (escape_mode == 1) {
    nts_uncaught(nts_value_of_number(67), nts_string_from_utf8("release", 7));
  }
  if (escape_mode == 2) {
    nts_raise(nts_value_of_number(67));
    nts_callback_leave();
    return;
  }
  answer = callback(argument);
  nts_callback_leave();
}

static const NtsFamilyOps ops = {.retain = keep, .release = dispose};
static const NtsForeignSlot slots[] = {
    {.offset = offsetof(Owner, handle), .family = NTS_FAMILY_NONE, .ops = &ops},
};
static const NtsDescriptor descriptor = {.kind = NTS_KIND_OBJECT,
                                         .size = sizeof(Owner),
                                         .name = "Owner",
                                         .foreign = 1,
                                         .foreign_slots = slots};
static const NtsDescriptor array_descriptor = {.kind = NTS_KIND_ARRAY,
                                               .size = sizeof(void *),
                                               .name = "foreign[]",
                                               .element = NTS_ARRAY_FOREIGN,
                                               .foreign = 1,
                                               .foreign_slots = slots};

/* Each runtime-owned way to invoke a foreign release: a field, array death,
 * an erased handle, replacing a foreign array element, and shrinking it. */
static void drop(unsigned path, double n) {
  argument = n;
  if (path == 0) {
    Owner *owner = (Owner *)nts_object_new(&descriptor);
    owner->handle = &answer;
    nts_release((NtsHeader *)owner);
  } else if (path == 2) {
    NtsValue held = nts_value_of_undefined();
    held.tag = NTS_TAG_HANDLE_OBJC;
    held.as.native = &answer;
    nts_value_release(held);
  } else {
    NtsArray *array = nts_array_new(&array_descriptor, 1);
    NTS_ITEMS(array, void *)[0] = &answer;
    if (path == 3) {
      nts_array_fill_foreign(array, NULL);
    } else if (path == 4) {
      nts_array_set_length_foreign(array, 0);
    }
    nts_release((NtsHeader *)array);
  }
}

static void one(unsigned path, bool outer, double n) {
  if (outer) {
    nts_raise(nts_value_of_number(22));
  }
  drop(path, n);
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

static void escaping(bool outer, unsigned mode) {
  int ends[2];
  if (pipe(ends) != 0) {
    expect("escaping release has a diagnostic pipe", false);
    return;
  }
  fflush(stdout);
  pid_t child = fork();
  if (child == 0) {
    close(ends[0]);
    dup2(ends[1], STDERR_FILENO);
    close(ends[1]);
    /* A release has native frames to unwind. Its exception must not be
     * delivered to this waiting outer landing, with or without an outer raise.
     */
    NtsLanding landing = {0};
    if (setjmp(landing.frame) != 0) {
      _exit(42);
    }
    nts_landing_push(&landing);
    if (outer) {
      nts_raise(nts_value_of_number(22));
    }
    escape_mode = mode;
    drop(0, 0);
    _exit(0);
  }
  close(ends[1]);
  if (child < 0) {
    close(ends[0]);
    expect("escaping release has a child", false);
    return;
  }
  char said[512] = {0};
  size_t at = 0;
  ssize_t got;
  while (at + 1 < sizeof said &&
         (got = read(ends[0], said + at, sizeof said - at - 1)) > 0) {
    at += (size_t)got;
  }
  close(ends[0]);
  int status = 0;
  waitpid(child, &status, 0);
  expect(mode == 1 ? "ordinary release throw follows the uncaught boundary"
                   : "pending release throw follows the uncaught boundary",
         WIFEXITED(status) && WEXITSTATUS(status) == 1 &&
             strstr(said, "a callback threw across a C boundary") != NULL);
}

int main(void) {
  nts_test_host_install();
  nts_handle_family_register(NTS_TAG_HANDLE_OBJC, keep_tagged, dispose,
                             "release callback");
  size_t baseline = nts_live_count();
  for (unsigned path = 0; path < 5; path++) {
    one(path, false, 0);
    one(path, true, 0);
    one(path, false, -1);
    one(path, true, -1);
  }
  escaping(false, 1);
  escaping(true, 1);
  escaping(false, 2);
  escaping(true, 2);
  expect("each owned foreign reference is released once", released == 20);
  nts_collect_cycles();
  expect("release leaves no live owner", nts_live_count() == baseline);
  return failures ? 1 : 0;
}
