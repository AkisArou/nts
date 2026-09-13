/* A tiny C library, standing in for GTK/sqlite/libcurl.
 *
 * Deliberately has one of each shape that matters:
 *   - a scalar function whose C types are NOT TypeScript's (`int`, not double)
 *   - an opaque handle with a create/destroy pair (ownership)
 *   - a borrowed accessor that must NOT be destroyed (aliasing)
 *   - a callback (the shape GTK signals need)
 *   - an out-parameter (the shape errno-style APIs need)
 */
#ifndef COUNTER_H
#define COUNTER_H

typedef struct Counter Counter;

int counter_clamp(int value, int lo, int hi);

Counter *counter_new(const char *name);   /* owned: caller must destroy */
void counter_destroy(Counter *c);
const char *counter_name(const Counter *c); /* borrowed: do NOT free */
int counter_bump(Counter *c, int by);

typedef void (*counter_watcher)(int value, void *user);
void counter_on_change(Counter *c, counter_watcher cb, void *user);

int counter_read_into(const Counter *c, int *out); /* 0 on success */

#endif
