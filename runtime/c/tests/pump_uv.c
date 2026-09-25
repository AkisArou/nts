/* A foreign loop's pump consumes the wakeup a post from another thread left
 * in libuv's backend, even with nothing else alive: the descriptor goes quiet
 * after the pump and is readable again at the next post. A run loop watching
 * it for an edge -- CoreFoundation's -- otherwise slept with a completion
 * queued, once in twenty runs of macos-blocks' off-thread arm. */
#include "nts_uv_host.h"

#include <poll.h>
#include <stdio.h>
#include <uv.h>

static int failures;
static void expect(const char *name, bool yes) {
  printf("%s %s\n", yes ? "ok" : "FAIL", name);
  failures += !yes;
}

static int ran;
static void count(void *state) {
  (void)state;
  ran++;
}

static void post(void *unused) {
  (void)unused;
  nts_post_from_any_thread((NtsTask){count, 0, 0});
}

/* A completion, from a thread of its own, that has arrived by the time this
 * returns. */
static void completed_elsewhere(void) {
  uv_thread_t thread;
  uv_thread_create(&thread, post, 0);
  uv_thread_join(&thread);
}

static int backend;
static bool readable(void) {
  struct pollfd watched = {backend, POLLIN, 0};
  return poll(&watched, 1, 0) == 1;
}

int main(void) {
  uv_loop_t loop;
  uv_loop_init(&loop);
  nts_uv_host_install(&loop);
  /* As a foreign loop attaches: nothing is alive, and nothing has polled. */
  backend = nts_uv_host_backend_fd();
  expect("the descriptor is quiet before anything is posted", !readable());
  completed_elsewhere();
  expect("a post before the first pump makes the descriptor readable",
         readable());
  nts_uv_host_pump();
  expect("the pump ran the completion", ran == 1);
  expect("the pump consumed the wakeup", !readable());
  completed_elsewhere();
  expect("the next post makes the descriptor readable again", readable());
  nts_uv_host_pump();
  expect("and the pump runs it", ran == 2);
  expect("and the descriptor is quiet again", !readable());
  /* An awaited operation holds the cross-thread handle; a pump leaves it
   * held. */
  nts_pending_begin();
  nts_uv_host_pump();
  expect("a pump leaves an outstanding operation's hold on the loop",
         uv_loop_alive(&loop) != 0);
  nts_pending_end();
  expect("and the end lets it go", uv_loop_alive(&loop) == 0);
  nts_uv_host_shutdown();
  return failures != 0;
}
