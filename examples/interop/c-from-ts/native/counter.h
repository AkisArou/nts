#ifndef NTS_EXAMPLE_COUNTER_H
#define NTS_EXAMPLE_COUNTER_H

/* A separately compiled library. Counter's representation stays private. */
typedef struct Counter Counter;

int counter_clamp(int value, int lo, int hi);
/* A negative initial value or an allocation failure returns NULL. */
Counter *counter_new(int initial);
int counter_bump(Counter *counter, int by);
int counter_read(Counter *counter);
void counter_destroy(Counter *counter);
/* Observes explicit cleanup in the example's caller. */
int counter_live(void);

#endif
