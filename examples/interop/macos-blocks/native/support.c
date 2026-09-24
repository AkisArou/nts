#include "support.h"

#include <CoreFoundation/CoreFoundation.h>
#include <objc/runtime.h>
#include <Block.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>

// libobjc's weak-reference entry points, which no public header declares.
id objc_initWeak(id *location, id value);
id objc_loadWeakRetained(id *location);
void objc_release(id value);

void report(const char *line) {
  fputs(line, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

void loop_run(void) { CFRunLoopRun(); }

void loop_stop(void) { CFRunLoopStop(CFRunLoopGetMain()); }

static id watches[16];
static int watched;

int weak_watch(struct NSObject *object) {
  if (watched == 16) abort();
  objc_initWeak(&watches[watched], (id)object);
  return watched++;
}

static void *held;

void hold_block(void *block) { held = _Block_copy(block); }

static void *release_held(void *unused) {
  (void)unused;
  _Block_release(held);
  return NULL;
}

bool off_thread_arm(void) { return getenv("BLOCKS_OFF_THREAD") != NULL; }

void release_held_off_thread(void) {
  pthread_t thread;
  pthread_create(&thread, NULL, release_held, NULL);
  pthread_join(thread, NULL);
}

bool weak_alive(int watch) {
  id object = objc_loadWeakRetained(&watches[watch]);
  if (object) objc_release(object);
  return object != 0;
}
