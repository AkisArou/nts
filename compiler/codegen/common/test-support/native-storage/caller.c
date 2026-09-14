#include "program.h"
#include <math.h>
int allocation_calls(void);
int freed_calls(void);
int live_allocations(void);
size_t last_allocation(void);
int main(void) {
  if (unused() != 3 || stack(1) != 59 || stack(2) != 59) return 1;
  const double invalid[] = {-1, 0, 0.5, 3, 4.5, INFINITY, NAN, 9007199254740992.0};
  for (size_t i = 0; i < sizeof invalid / sizeof *invalid; i++)
    if (heap(invalid[i]) != -1 || allocation_calls() != 0) return 2;
  if (heap(99) != -1 || allocation_calls() != 1 || freed_calls()) return 3;
  if (heap(4) != 37 || last_allocation() != 4 || freed_calls() != 1 || live_allocations()) return 4;
  if (fixedHeap() != 31 || last_allocation() != 12 || freed_calls() != 2 || live_allocations()) return 5;
  nullFree();
  return freed_calls() == 2 && allocation_calls() == 3 ? 0 : 6;
}
