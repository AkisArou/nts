#include "scheduler.h"

/* Stand-in. The fixture is about the build graph, not the notification. */
void schedule_at(const char *id, const char *title, const char *body, double delay_millis) { (void)id; (void)title; (void)body; (void)delay_millis; }
void cancel_by_id(const char *id) { (void)id; }
void set_tap_handler(notification_tap_fn handler) { (void)handler; }
