#include "closures.h"

#include <stddef.h>

void each_upto(void (*f)(int, void *), void *data, int upto) {
  for (int n = 1; n <= upto; n++)
    f(n, data);
}

#define SLOTS 64

static struct {
  void (*f)(int, void *);
  void *data;
  void (*notify)(void *);
} slots[SLOTS];

int closures_skip_notify;

int subscribe(void (*f)(int, void *), void *data, void (*notify)(void *)) {
  for (int at = 0; at < SLOTS; at++) {
    if (slots[at].f == NULL) {
      slots[at].f = f;
      slots[at].data = data;
      slots[at].notify = notify;
      return at;
    }
  }
  return -1;
}

void deliver(int n) {
  for (int at = 0; at < SLOTS; at++) {
    if (slots[at].f != NULL)
      slots[at].f(n, slots[at].data);
  }
}

void unsubscribe(int handle) {
  if (handle < 0 || handle >= SLOTS || slots[handle].f == NULL)
    return;
  void (*notify)(void *) = slots[handle].notify;
  void *data = slots[handle].data;
  slots[handle].f = NULL;
  if (notify != NULL && !closures_skip_notify)
    notify(data);
}

int subscribers(void) {
  int count = 0;
  for (int at = 0; at < SLOTS; at++)
    count += slots[at].f != NULL;
  return count;
}

struct item {
  int weight;
};

static struct item items[3] = {{2}, {3}, {5}};

int item_weight(struct item *item) { return item->weight; }

void visit_items(void (*f)(struct item *, void *), void *data) {
  for (int at = 0; at < 3; at++)
    f(&items[at], data);
}
