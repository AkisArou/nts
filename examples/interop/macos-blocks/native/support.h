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
// Keeps a copy of `block` (`_Block_copy`), as an API that stores one does.
void hold_block(void *block);
// Releases the held copy from another thread and waits for it: the arm that
// checks a block's dispose refuses off the thread that owns its closure.
void release_held_off_thread(void);
// Whether `BLOCKS_OFF_THREAD` is set.
bool off_thread_arm(void);

#endif
