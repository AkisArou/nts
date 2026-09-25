/* An operation the program awaits holds the libuv loop until its completion
 * arrives from another thread, and only while it is outstanding. */
#include "nts_uv_host.h"

#include <stdio.h>
#include <uv.h>

static int failures;
static void expect(const char *name, bool yes) {
  printf("%s %s\n", yes ? "ok" : "FAIL", name);
  failures += !yes;
}

static bool completed;
static void complete(void *state) {
  completed = true;
  if (state != 0) {
    nts_pending_end();
  }
}

/* A completion from a thread of its own, 50 ms later, as a Windows Runtime
 * operation's or a URLSession task's arrives. */
static void later(void *state) {
  uv_sleep(50);
  nts_post_from_any_thread((NtsTask){complete, 0, state});
}

static void awaited(bool begun) {
  completed = false;
  if (begun) {
    nts_pending_begin();
  }
  uv_thread_t thread;
  uv_thread_create(&thread, later, begun ? (void *)1 : 0);
  nts_uv_host_run();
  bool before_join = completed;
  uv_thread_join(&thread);
  /* Whatever the thread posted after the loop returned still runs. */
  nts_uv_host_run();
  if (begun) {
    expect("an outstanding operation holds the loop until it completes",
           before_join);
    expect("the operation's end brings the count back to zero",
           nts_pending_count() == 0);
  } else {
    /* The control: nothing outstanding, so the loop returned first. */
    expect("with nothing outstanding the loop does not wait", !before_join);
    expect("the late completion still ran once the loop ran again", completed);
  }
}

int main(void) {
  uv_loop_t loop;
  uv_loop_init(&loop);
  nts_uv_host_install(&loop);
  awaited(true);
  awaited(false);
  nts_uv_host_shutdown();
  return failures != 0;
}
