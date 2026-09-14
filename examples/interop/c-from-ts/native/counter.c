#include "counter.h"
#include <stdlib.h>

struct Counter {
  int value;
};

static int live;

int counter_clamp(int value, int lo, int hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

Counter *counter_new(int initial) {
  if (initial < 0)
    return NULL;
  Counter *counter = malloc(sizeof(*counter));
  if (counter == NULL)
    return NULL;
  counter->value = initial;
  ++live;
  return counter;
}

int counter_bump(Counter *counter, int by) {
  counter->value += by;
  return counter->value;
}

int counter_read(Counter *counter) { return counter->value; }

void counter_destroy(Counter *counter) {
  if (counter == NULL)
    return;
  --live;
  free(counter);
}

int counter_live(void) { return live; }
