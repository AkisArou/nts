// The fixture's output, and zeroing weak references to watch objects end.
#ifndef NTS_MACOS_FOUNDATION_REPORT_H
#define NTS_MACOS_FOUNDATION_REPORT_H

#include <stdbool.h>

struct NSObject;

// Starts a weak reference to `object`, answering its number.
int weak_watch(struct NSObject *object);
// Whether the object watch `watch` refers to is still alive.
bool weak_alive(int watch);

#endif
