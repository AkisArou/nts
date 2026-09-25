/* Handles in an erased value: the tag block 8..15, where a C library's object
 * is a pointer and never a managed object, and counts through what its family
 * registered.
 *
 * What is checked, all of it before anything in the compiler produces such a
 * value -- the runtime half is in the tree and provably unreached first:
 *
 *   - a registered family's retain and release run for a value holding one of
 *     its handles, and for nothing else;
 *   - the handle block is a pointer and not managed (`NTS_TAG_IS_POINTER`,
 *     `NTS_TAG_IS_MANAGED`), so no reader of an `NtsHeader` reaches it;
 *   - `typeof` answers "object", truthiness is presence, and two values are
 *     strictly equal when they hold the same handle;
 *   - and every way it can go wrong aborts, in its own words: a handle whose
 *     family nothing registered, a family registered after a handle was
 *     counted, one registered twice, one registered outside the block, and
 *     `typeof` of a tag that is not one. Each runs in a child, because the
 *     answer is the abort. */
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

#include "nts_runtime.h"
#include "nts_test_host.h"

static int failures;

static void expect(const char *what, bool holds) {
  if (holds) {
    printf("ok   %s\n", what);
  } else {
    printf("FAIL %s\n", what);
    failures++;
  }
}

/* A family's counting, observed. */
static int retained;
static int released;
static void count_retain(void *object) {
  (void)object;
  retained++;
}
static void count_release(void *object) {
  (void)object;
  released++;
}

static NtsValue handle(uint32_t tag, void *object) {
  NtsValue value = nts_value_of_undefined();
  value.tag = tag;
  value.as.native = object;
  return value;
}

/* Whether `body`, run in a child, aborts and says `words` on its way out. */
static bool aborts_saying(void (*body)(void), const char *words) {
  int pipe_ends[2];
  if (pipe(pipe_ends) != 0) {
    return false;
  }
  fflush(stdout);
  pid_t child = fork();
  if (child == 0) {
    close(pipe_ends[0]);
    dup2(pipe_ends[1], 2);
    body();
    _exit(0);
  }
  close(pipe_ends[1]);
  char said[512] = {0};
  size_t at = 0;
  ssize_t got;
  while (at + 1 < sizeof said &&
         (got = read(pipe_ends[0], said + at, sizeof said - 1 - at)) > 0) {
    at += (size_t)got;
  }
  close(pipe_ends[0]);
  int status = 0;
  waitpid(child, &status, 0);
  return WIFSIGNALED(status) && WTERMSIG(status) == SIGABRT &&
         strstr(said, words) != NULL;
}

static int object_a;
static int object_b;

/* A handle of the COM tag, which nothing in these children registered. */
static void unregistered(void) {
  nts_value_retain(handle(NTS_TAG_HANDLE_COM, &object_a));
}

/* A handle counted, then its family registered. */
static void too_late(void) {
  nts_handle_family_register(NTS_TAG_HANDLE_OBJC, count_retain, count_release,
                             "first");
  nts_value_retain(handle(NTS_TAG_HANDLE_OBJC, &object_a));
  nts_handle_family_register(NTS_TAG_HANDLE_GOBJECT, count_retain,
                             count_release, "late");
}

static void twice(void) {
  nts_handle_family_register(NTS_TAG_HANDLE_OBJC, count_retain, count_release,
                             "once");
  nts_handle_family_register(NTS_TAG_HANDLE_OBJC, count_retain, count_release,
                             "again");
}

static void outside_the_block(void) {
  nts_handle_family_register(NTS_TAG_OBJECT, count_retain, count_release,
                             "misplaced");
}

static void unknown_typeof(void) { nts_tag_name(200); }

int main(void) {
  nts_test_host_install();

  expect("an unregistered handle aborts, naming its tag",
         aborts_saying(unregistered, "tag 10, and no family registered"));
  expect("a family registered after a handle was counted is too late",
         aborts_saying(too_late, "registered too late"));
  expect("a family registered twice aborts",
         aborts_saying(twice, "registered twice"));
  expect("a family outside the handle block aborts",
         aborts_saying(outside_the_block, "not one of the handle block's"));
  expect("typeof of an unknown tag aborts, naming it",
         aborts_saying(unknown_typeof, "tag 200, which is not one"));

  nts_handle_family_register(NTS_TAG_HANDLE_GOBJECT, count_retain,
                             count_release, "counted");
  NtsValue value = handle(NTS_TAG_HANDLE_GOBJECT, &object_a);
  nts_value_retain(value);
  nts_value_retain(value);
  nts_value_release(value);
  expect("a handle retains and releases through its family",
         retained == 2 && released == 1);
  nts_value_retain(nts_value_of_number(1.0));
  nts_value_release(nts_value_of_null());
  nts_value_retain(handle(NTS_TAG_HANDLE_GOBJECT, NULL));
  expect("and nothing else reaches it: a number, null, a NULL handle",
         retained == 2 && released == 1);

  expect("the handle block is a pointer",
         NTS_TAG_IS_POINTER(NTS_TAG_HANDLE_GOBJECT) &&
             NTS_TAG_IS_POINTER(NTS_TAG_HANDLE_OBJC) &&
             NTS_TAG_IS_POINTER(NTS_TAG_HANDLE_COM));
  expect("and never managed", !NTS_TAG_IS_MANAGED(NTS_TAG_HANDLE_GOBJECT) &&
                                  !NTS_TAG_IS_MANAGED(NTS_TAG_HANDLE_OBJC) &&
                                  !NTS_TAG_IS_MANAGED(NTS_TAG_HANDLE_COM));
  expect("the block is 8..15 and nothing below it",
         NTS_TAG_IS_HANDLE(8u) && NTS_TAG_IS_HANDLE(15u) &&
             !NTS_TAG_IS_HANDLE(NTS_TAG_NULL) && !NTS_TAG_IS_HANDLE(16u));

  NtsString *name = nts_tag_name(NTS_TAG_HANDLE_GOBJECT);
  expect("typeof a handle is \"object\"",
         nts_string_eq(name, nts_string_from_utf8("object", 6)));
  expect("a handle is truthy, and a NULL one is not",
         nts_value_truthy(value) &&
             !nts_value_truthy(handle(NTS_TAG_HANDLE_GOBJECT, NULL)));
  expect("two values holding one handle are strictly equal",
         nts_value_strict_eq(value, handle(NTS_TAG_HANDLE_GOBJECT, &object_a)));
  expect(
      "and two handles are not",
      !nts_value_strict_eq(value, handle(NTS_TAG_HANDLE_GOBJECT, &object_b)));

  printf("%s\n", failures == 0 ? "all handle checks passed"
                               : "some handle checks failed");
  return failures == 0 ? 0 : 1;
}
