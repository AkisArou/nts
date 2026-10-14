// Output, and zeroing weak references.
#ifndef NTS_MACOS_CLASSES_SUPPORT_H
#define NTS_MACOS_CLASSES_SUPPORT_H

#include <stdbool.h>

struct NSObject;
struct NSString;

void report_string(const char *label, struct NSString *text);
int weak_watch(struct NSObject *object);
bool weak_alive(int watch);
/* How many objects of the program's own are alive, after a collection. */
int live_objects(void);
/* Observe `object` by key-value observing, answering whether that replaced
 * its class; and stop. */
bool kvo_observe(struct NSObject *object);
void kvo_forget(struct NSObject *object);
/* Read `key` by key-value coding in a pool of its own, answering a watch on
 * the value. */
int kvc_watch(struct NSObject *object, const char *key);

#endif
