#include "support.h"

#include <CoreFoundation/CoreFoundation.h>
#include <objc/runtime.h>
#include <Block.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

// libobjc's weak-reference entry points, which no public header declares.
id objc_initWeak(id *location, id value);
id objc_loadWeakRetained(id *location);
void objc_release(id value);
id objc_retainAutoreleasedReturnValue(id value);
void *objc_autoreleasePoolPush(void);
void objc_autoreleasePoolPop(void *pool);

int made_by_block(void *block) {
  void *pool = objc_autoreleasePoolPush();
  id (^maker)(void) = block;
  id made = objc_retainAutoreleasedReturnValue(maker());
  int watch = weak_watch((struct NSObject *)made);
  objc_release(made);
  objc_autoreleasePoolPop(pool);
  return watch;
}

void report(const char *line) {
  fputs(line, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

void loop_run(void) { CFRunLoopRun(); }

void loop_stop(void) { CFRunLoopStop(CFRunLoopGetMain()); }

static id watches[16];
static int watched;
int weak_watch(struct NSObject *object);

int weak_watch(struct NSObject *object) {
  if (watched == 16) abort();
  objc_initWeak(&watches[watched], (id)object);
  return watched++;
}

static void *held;

void hold_block(void *block) { held = _Block_copy(block); }

static struct NSObject *passed;
static int passed_n;

static void *call_held(void *unused) {
  (void)unused;
  ((void (^)(struct NSObject *, int))held)(passed, passed_n);
  _Block_release(held);
  held = NULL;
  return NULL;
}

bool off_thread_arm(void) { return getenv("BLOCKS_OFF_THREAD") != NULL; }

int console_arm(void) {
  const char *arm = getenv("BLOCKS_CONSOLE");
  return arm == NULL ? 0 : strcmp(arm, "unheld") == 0 ? 2 : 1;
}

void call_held_off_thread(struct NSObject *value, int n) {
  passed = value;
  passed_n = n;
  pthread_t thread;
  pthread_create(&thread, NULL, call_held, NULL);
  pthread_join(thread, NULL);
}

bool on_main_thread(void) { return pthread_main_np() != 0; }

typedef struct Completion {
  void *block;
  bool fail;
} Completion;

static void *complete(void *state) {
  Completion *completion = state;
  void (^handler)(struct NSObject *, struct NSError *) = completion->block;
  if (completion->fail) {
    const void *keys[] = {kCFErrorLocalizedDescriptionKey};
    const void *values[] = {CFSTR("the item was not there")};
    CFErrorRef error = CFErrorCreateWithUserInfoKeysAndValues(
        NULL, CFSTR("nts"), 7, keys, values, 1);
    handler(NULL, (struct NSError *)error);
    CFRelease(error);
  } else {
    handler((struct NSObject *)CFSTR("the item"), NULL);
  }
  _Block_release(completion->block);
  free(completion);
  return NULL;
}

static void *complete_pair(void *block) {
  void (^handler)(struct NSObject *, struct NSObject *, struct NSError *) = block;
  handler((struct NSObject *)CFSTR("left"), (struct NSObject *)CFSTR("right"), NULL);
  _Block_release(block);
  return NULL;
}

typedef struct Later {
  void *block;
  int ms;
} Later;

static void *complete_after(void *state) {
  Later *later = state;
  usleep((useconds_t)later->ms * 1000);
  void (^handler)(struct NSObject *, struct NSError *) = later->block;
  handler((struct NSObject *)CFSTR("later"), NULL);
  _Block_release(later->block);
  free(later);
  return NULL;
}

void complete_later(int ms, void *block) {
  Later *later = malloc(sizeof *later);
  if (!later) abort();
  later->block = _Block_copy(block);
  later->ms = ms;
  pthread_t thread;
  pthread_create(&thread, NULL, complete_after, later);
  pthread_detach(thread);
}

void complete_pair_off_thread(void *block) {
  void *held = _Block_copy(block);
  pthread_t thread;
  pthread_create(&thread, NULL, complete_pair, held);
  pthread_detach(thread);
}

void complete_off_thread(bool fail, void *block) {
  Completion *completion = malloc(sizeof *completion);
  if (!completion) abort();
  completion->block = _Block_copy(block);
  completion->fail = fail;
  pthread_t thread;
  pthread_create(&thread, NULL, complete, completion);
  pthread_detach(thread);
}

bool weak_alive(int watch) {
  id object = objc_loadWeakRetained(&watches[watch]);
  if (object) objc_release(object);
  return object != 0;
}
