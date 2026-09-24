// The fixture's output, and zeroing weak references to watch objects end.
#ifndef NTS_MACOS_FOUNDATION_REPORT_H
#define NTS_MACOS_FOUNDATION_REPORT_H

#include <stdbool.h>

struct NSObject;

// Prints `line` and a newline to stdout.
void report(const char *line);
// Starts a weak reference to `object`, answering its number.
int weak_watch(struct NSObject *object);
// Whether the object watch `watch` refers to is still alive.
bool weak_alive(int watch);

#endif
