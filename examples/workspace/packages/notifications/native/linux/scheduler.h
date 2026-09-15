/* The Linux shim.
 *
 * libnotify over D-Bus. This is the one platform where a C surface is the
 * honest one -- libnotify is a C library, so nothing is standing in for
 * anything. Compare `apple/scheduler.h`, where it is. */
#ifndef NOTIFICATIONS_SCHEDULER_H
#define NOTIFICATIONS_SCHEDULER_H

typedef void (*notification_tap_fn)(const char *id);

void schedule_at(const char *id, const char *title, const char *body, double delay_millis);
void cancel_by_id(const char *id);
void set_tap_handler(notification_tap_fn handler);

#endif
