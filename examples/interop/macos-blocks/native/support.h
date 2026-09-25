// Output, the main run loop, and zeroing weak references.
#ifndef NTS_MACOS_BLOCKS_SUPPORT_H
#define NTS_MACOS_BLOCKS_SUPPORT_H

#include <stdbool.h>

struct NSObject;

void report(const char *line);
// `CFRunLoopRun`, until `loop_stop`.
void loop_run(void);
void loop_stop(void);
int weak_watch(struct NSObject *object);
bool weak_alive(int watch);
// Keeps a copy of `block` (`_Block_copy`), as an API that stores a completion
// handler does. `block` takes an object and an `int`.
void hold_block(void *block);
// Calls the held copy with `value` and `n` on another thread, then releases it
// there, and waits for that thread: a completion handler called and let go on
// a background queue.
void call_held_off_thread(struct NSObject *value, int n);
// Whether this is the main thread.
bool on_main_thread(void);
// Whether `BLOCKS_OFF_THREAD` is set.
bool off_thread_arm(void);

#endif
