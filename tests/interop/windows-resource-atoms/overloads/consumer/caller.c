#include "program.h"
#include <assert.h>
#include <stdio.h>
int main(void) {
  assert(atomCall() == 32512);
  assert(textCall() == 65);
  assert(wideCall() == 0x0394);
  assert(surrogateCall() == 0xD83D);
  assert(typeUtilityCall() == 66);
  puts("atom=32512 text=65 wide=916 surrogate=55357 last-overload=66");
}
