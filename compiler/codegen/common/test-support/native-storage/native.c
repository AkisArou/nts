#include <stdint.h>
#include <stdlib.h>
struct StorageState {
  uint8_t flag;
  double value;
  int count;
  int *next;
};
int witness(struct StorageState *p, int phase) {
  if ((uintptr_t)p % _Alignof(struct StorageState)) return 0;
  for (int i = 0; i < 2; i++) {
    if (p[i].flag || p[i].next) return 0;
    if (phase == 0 && (p[i].value != 0 || p[i].count != 0)) return 0;
  }
  if (phase == 1 && (p[0].value != 2.5 || p[1].value != 3.5 ||
                    p[0].count != 0 || p[1].count != 17)) return 0;
  return 1;
}
static int calls, frees, alive;
static size_t last;
void *__real_malloc(size_t size);
void __real_free(void *p);
void *__wrap_malloc(size_t size) {
  calls++;
  last = size;
  if (size == 99) return NULL;
  void *p = __real_malloc(size);
  if (p) alive++;
  return p;
}
void __wrap_free(void *p) {
  if (p) { frees++; alive--; }
  __real_free(p);
}
int allocation_calls(void) { return calls; }
int freed_calls(void) { return frees; }
int live_allocations(void) { return alive; }
size_t last_allocation(void) { return last; }

int readHeap(int *p) { return p[0]; }
