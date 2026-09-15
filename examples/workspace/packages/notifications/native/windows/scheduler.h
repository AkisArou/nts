/* The Windows shim.
 *
 * The real surface is WinRT (`Windows.UI.Notifications`), which is neither C
 * nor Java -- so this is the platform where "bind the native API" has no answer
 * in this compiler at all. Android has a class-file reader and Linux has a C
 * library; Windows has neither, and a C shim is a stand-in for a bridge nobody
 * has written. Named here because a plausible header would hide it. */
#ifndef NOTIFICATIONS_SCHEDULER_H
#define NOTIFICATIONS_SCHEDULER_H

typedef void (*notification_tap_fn)(const char *id);

void schedule_at(const char *id, const char *title, const char *body, double delay_millis);
void cancel_by_id(const char *id);
void set_tap_handler(notification_tap_fn handler);

#endif
