/* The Apple shim.
 *
 * The real API is UNUserNotificationCenter, which is Objective-C. This compiler
 * binds C headers and Java class files, so this is a C surface that an
 * Objective-C translation unit has to implement. That bridge is a real gap and
 * the fixture names it rather than hiding it behind a plausible header. */
#ifndef NOTIFICATIONS_SCHEDULER_H
#define NOTIFICATIONS_SCHEDULER_H

typedef void (*notification_tap_fn)(const char *id);

void schedule_at(const char *id, const char *title, const char *body, double delay_millis);
void cancel_by_id(const char *id);
void set_tap_handler(notification_tap_fn handler);

#endif
