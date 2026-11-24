#include "program.h"
#include <assert.h>
#include <stdio.h>
int main(void) {
  assert(lib_atomCall() == 32512);
  assert(lib_textCall() == 65);
  assert(lib_wideCall() == 0x0394);
  assert(lib_surrogateCall() == 0xD83D);
  assert(lib_typeUtilityCall() == 66);
  puts("atom=32512 text=65 wide=916 surrogate=55357 last-overload=66");
  assert(lib_enumerated() == 4);
  puts("callback: #23/NTS_NAMED #0/#1 U+0394U+D83D/#65535 NTS_NAMED/#32512, no "
       "atom read through");
}
