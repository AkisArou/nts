/* Observe nonreturning helper exits with an actual outer landing installed.
 * The Rust harness compares these observations with the shared core catalog. */
#include "nts_runtime.h"
#include "nts_test_host.h"
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>

static NtsLanding landing;

static void invoke(const char *name, NtsValue payload, NtsString *detail) {
  if (!strcmp(name, "nts_bigint_overflow")) {
    nts_bigint_overflow();
  } else if (!strcmp(name, "nts_no_arm")) {
    nts_no_arm("member");
  } else if (!strcmp(name, "nts_refused")) {
    nts_refused(detail);
  } else if (!strcmp(name, "nts_assertion_failed")) {
    nts_assertion_failed(detail);
  } else if (!strcmp(name, "nts_no_arm_of")) {
    nts_no_arm_of(payload, detail);
  } else if (!strcmp(name, "nts_cell_unready")) {
    nts_cell_unready("binding");
  } else if (!strcmp(name, "nts_uncaught")) {
    nts_uncaught(payload, detail);
  }
  _exit(90); /* Neither a process stop nor a transfer. */
}

static void child(const char *name) {
  struct rlimit no_core = {0, 0};
  if (setrlimit(RLIMIT_CORE, &no_core) || !freopen("/dev/null", "w", stderr)) {
    _exit(92);
  }
  nts_test_host_install();
  NtsString *text = nts_string_from_utf8("payload", 7);
  NtsString *detail = nts_string_from_utf8("detail", 6);
  NtsValue payload = nts_value_of_reference((NtsHeader *)text, NTS_TAG_STRING);
  if (setjmp(landing.frame) == 0) {
    nts_landing_push(&landing);
    invoke(name, payload, detail);
  }
  /* A nonlocal transfer must preserve the actual managed payload and detail,
   * not just reach some handler. nts_uncaught has already popped this frame. */
  bool same = nts_value_strict_eq(nts_landing_thrown(&landing), payload) &&
              nts_landing_detail(&landing) == detail && text->length == 7 &&
              nts_unit(text, 0) == 'p' && nts_unit(detail, 0) == 'd';
  _exit(same ? 91 : 93);
}

int main(void) {
  const char *names[] = {"nts_bigint_overflow", "nts_no_arm",
                         "nts_refused",         "nts_assertion_failed",
                         "nts_no_arm_of",       "nts_cell_unready",
                         "nts_uncaught"};
  for (unsigned at = 0; at < sizeof names / sizeof *names; ++at) {
    fflush(stdout);
    pid_t pid = fork();
    if (pid < 0) {
      return 1;
    }
    if (pid == 0) {
      child(names[at]);
      _exit(94);
    }
    int status = 0;
    pid_t waited;
    do {
      waited = waitpid(pid, &status, 0);
    } while (waited < 0 && errno == EINTR);
    if (waited != pid) {
      return 2;
    }
    const char *outcome =
        WIFEXITED(status) && WEXITSTATUS(status) == 91 ? "transfer"
        : (WIFSIGNALED(status) && WTERMSIG(status) == SIGABRT) ||
                (WIFEXITED(status) && WEXITSTATUS(status) == 1)
            ? "terminal"
            : "unexpected";
    printf("%s\t%s\tstatus=%d\n", names[at], outcome, status);
    if (!strcmp(outcome, "unexpected")) {
      return 3;
    }
  }
  return 0;
}
