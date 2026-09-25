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
struct NSError;
// Calls `block` once on a new thread, as a completion handler on a background
// queue is: with an object and no error, or, when `fail`, with no object and
// an `NSError` whose description is "the item was not there".
void complete_off_thread(bool fail, void *block);
// Calls `block` once on a new thread with two objects and no error: a handler
// Swift imports as `async throws -> (A, B)`.
void complete_pair_off_thread(void *block);
// Calls `block` with an object from a new thread, `ms` milliseconds from now.
void complete_later(int ms, void *block);
// Calls `block`, an `id (^)(void)`, as ARC code does -- its result retained
// out of the pool it may be autoreleased into -- watches the object, then
// gives it back and drains the pool: the watch says whether anything else
// still counts it.
int made_by_block(void *block);
// Calls `block`, a `void (^)(BOOL, short)`, with (YES, 7) and then (NO, -3):
// arguments narrower than an int, which the platform widens.
void call_with_flags(void *block);
// Whether `BLOCKS_OFF_THREAD` is set.
bool off_thread_arm(void);
// `BLOCKS_CONSOLE`: 0 unset, 1 "held", 2 "unheld".
int console_arm(void);

#endif
