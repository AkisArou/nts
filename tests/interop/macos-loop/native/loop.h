// A Cocoa-shaped program's loop without a window: the main CFRunLoop, an event
// it dispatches to TypeScript, and the controls build.sh runs it under.
#ifndef NTS_MACOS_LOOP_H
#define NTS_MACOS_LOOP_H

// One line of the log, which is the assertion.
void loop_log(const char *line);
// Turns the main run loop until `loop_stop`: `CFRunLoopRun`, from inside
// module evaluation, as `[NSApp run]` would be.
void loop_run(void);
// Stops it, after `LOOP_LINGER` milliseconds of idling if that is set.
void loop_stop(void);
// An event from the run loop: `event` called from a CFRunLoop timer, with
// nothing compiled below it on the stack.
void loop_event_later(void (*event)(void));
// The same event, dispatched synchronously from inside a task.
void loop_event_now(void (*event)(void));
// Applies `LOOP_CONTROL`: `nodrain` turns off the checkpoint after callbacks,
// `detached` takes libuv off the run loop. Either arms a give-up timer.
void loop_control(void);

#endif
