#include "program.h"
#include <stdio.h>
int main(void) {
  double value = free_header_symbol(42);
  printf("free C symbol: %.0f\n", value);
  return value != 43;
}
