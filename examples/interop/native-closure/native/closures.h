// A C library with the two shapes C uses in place of closures: a callback
// called only during the call, with a context; and one kept past it, with a
// context and the function that releases it.
#ifndef NTS_CLOSURES_H
#define NTS_CLOSURES_H

// Calls `f(1, data)` .. `f(upto, data)` and keeps nothing.
void each_upto(void (*f)(int, void *), void *data, int upto);

// Keeps `f` and `data` until `unsubscribe`, which then calls `notify(data)`.
int subscribe(void (*f)(int, void *), void *data, void (*notify)(void *));
// Calls every subscriber with `n`.
void deliver(int n);
void unsubscribe(int handle);
// Subscribers still held.
int subscribers(void);

// An opaque item, and a walk over three of them that hands each to `f`. The
// callback takes a handle, which is what puts a struct tag inside a function
// pointer's parameter list.
struct item;
int item_weight(struct item *item);
void visit_items(void (*f)(struct item *, void *), void *data);

// The control arm: while set, `unsubscribe` forgets without calling
// `notify`, so whatever the context held is never released.
extern int closures_skip_notify;

#endif
