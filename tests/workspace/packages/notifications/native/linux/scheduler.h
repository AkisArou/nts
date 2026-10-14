/* libnotify over D-Bus, behind a C shim.
 *
 * **Scalars, and the reason is a gap rather than a preference.** A real shim
 * takes `const char *` for the id and the title, and a generated binding types
 * that `ConstPtr<c_char>` -- which a JavaScript string is not. Marshalling one
 * into native storage is a thing this compiler can do and does not do for you:
 * `examples/interop/native-open` takes a `Ptr<c_char>` as a parameter rather
 * than converting a string, because there is nothing to convert it with.
 *
 * So the handle is an integer, which is what most notification APIs use anyway,
 * and the text stays on the TypeScript side until strings can cross. The
 * honest version of this file is three `const char *` parameters and a
 * `packages/notifications/src/linux.ts` that cannot call it. */
#ifndef NOTIFICATIONS_SCHEDULER_H
#define NOTIFICATIONS_SCHEDULER_H

#include <stdint.h>

typedef void (*notification_tap_fn)(int32_t id);

void schedule_at(int32_t id, double delay_millis);
void cancel_by_id(int32_t id);
void set_tap_handler(notification_tap_fn handler);

#endif
