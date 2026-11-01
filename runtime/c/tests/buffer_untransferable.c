/* Observe the direct transfer invariant at the abort call, synchronously.
 * Link this dedicated test TU with -Wl,--wrap=abort. A SIGABRT alone cannot
 * tell an early guard from one that already allocated or detached the slab.
 * Node26 lib/internal/buffer.js:1085-1105 supplies the marking contract. */
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

#include "nts_runtime.h"

enum {
  OBS_UNCHANGED = 23,
  OBS_MUTATED = 24,
  OBS_RETURNED = 25,
  OBS_UNEXPECTED = 26
};

static struct {
  bool active;
  NtsBuffer *buffer;
  NtsView *alias;
  unsigned char *storage;
  size_t length;
  size_t reserved;
  bool resizable;
  size_t live_count;
  size_t live_bytes;
  size_t allocations;
  unsigned char contents[8];
} observation;

/* This is an ordinary call interposition, not a signal handler. Read the
 * counters and object while the runtime is stopped at its own abort call. */
_Noreturn void __wrap_abort(void) {
  if (!observation.active) {
    _exit(OBS_UNEXPECTED);
  }
  const NtsBuffer *buffer = observation.buffer;
  bool unchanged = observation.alias->buffer == buffer &&
                   buffer->bytes == observation.storage &&
                   buffer->length == observation.length &&
                   buffer->reserved_bytes == observation.reserved &&
                   buffer->resizable == observation.resizable &&
                   nts_buffer_is_marked_as_untransferable(buffer) &&
                   nts_live_count() == observation.live_count &&
                   nts_live_bytes() == observation.live_bytes &&
                   nts_counted_allocations() == observation.allocations;
  /* Only read the contents if the live backing identity is intact; a late
   * guard may have freed it and cleared the source pointer. */
  if (unchanged) {
    unchanged = memcmp(buffer->bytes, observation.contents,
                       sizeof observation.contents) == 0;
  }
  _exit(unchanged ? OBS_UNCHANGED : OBS_MUTATED);
}

static int failures;
static void check(bool holds, const char *what) {
  printf("%s %s\n", holds ? "ok  " : "FAIL", what);
  if (!holds) {
    failures++;
  }
}

static bool rejects_before_mutation(bool fixed) {
  fflush(stdout);
  pid_t child = fork();
  if (child < 0) {
    return false;
  }
  if (child == 0) {
    NtsBuffer *buffer = nts_buffer_new_resizable(8, 16);
    memset(buffer->bytes, 0x5a, 8);
    observation.buffer = buffer;
    observation.alias = nts_view_new(buffer, 0, 8, NTS_ELEMENT_U8, false);
    observation.storage = buffer->bytes;
    observation.length = buffer->length;
    observation.reserved = buffer->reserved_bytes;
    observation.resizable = buffer->resizable;
    observation.live_count = nts_live_count();
    observation.live_bytes = nts_live_bytes();
    observation.allocations = nts_counted_allocations();
    memcpy(observation.contents, buffer->bytes, 8);
    nts_buffer_mark_as_untransferable(buffer);
    observation.active = true;
    (void)nts_buffer_transfer(buffer, 0, fixed);
    _exit(OBS_RETURNED);
  }
  int status = 0;
  return waitpid(child, &status, 0) == child && WIFEXITED(status) &&
         WEXITSTATUS(status) == OBS_UNCHANGED;
}

static void ordinary_twin(bool fixed) {
  NtsBuffer *buffer = nts_buffer_new_resizable(8, 16);
  memset(buffer->bytes, 0x5a, 8);
  NtsBuffer *moved = nts_buffer_transfer(buffer, 4, fixed);
  check(moved && nts_buffer_detached(buffer) && moved->length == 4 &&
            moved->bytes[0] == 0x5a && moved->resizable == !fixed &&
            !nts_buffer_is_marked_as_untransferable(moved),
        fixed ? "ordinary fixed transfer twin completes"
              : "ordinary transfer twin completes");
  nts_release((NtsHeader *)moved);
  nts_release((NtsHeader *)buffer);
}

int main(void) {
  check(
      rejects_before_mutation(false),
      "marked transfer rejects with source and allocation counters unchanged");
  ordinary_twin(false);
  check(rejects_before_mutation(true),
        "marked fixed transfer rejects with source and allocation counters "
        "unchanged");
  ordinary_twin(true);
  return failures != 0;
}
