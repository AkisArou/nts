/* The libnotify shim. A stub here: the fixture is about the build graph, and
   linking real libnotify would make this example need a system package.

   Scalars only -- see `scheduler.h` for why the text stays in TypeScript. */
#include "scheduler.h"

static notification_tap_fn tap_handler;

void schedule_at(int32_t id, double delay_millis) {
    (void)id;
    (void)delay_millis;
}

void cancel_by_id(int32_t id) { (void)id; }

void set_tap_handler(notification_tap_fn handler) { tap_handler = handler; }
