#include "program.h"
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
  // A direct correctness control, including embedded NUL and a non-ASCII byte.
  uint8_t sample[] = {'a', 0, 'z', 0xc3, 'Q'};
  const uint8_t expected[] = {'A', 0, 'Z', 0xc3, 'Q'};
  if (uppercaseAscii(sample, sizeof sample) != 2 ||
      memcmp(sample, expected, sizeof sample) != 0)
    return 1;
  if (argc == 1) {
    puts("native buffer: passed");
    return 0;
  }
  if (argc != 3)
    return 2;
  FILE *input = fopen(argv[1], "rb");
  if (!input)
    return 3;
  FILE *output = fopen(argv[2], "wb");
  if (!output) {
    fclose(input);
    return 4;
  }
  uint8_t buffer[4096];
  size_t length;
  int failed = 0;
  while ((length = fread(buffer, 1, sizeof buffer, input)) != 0) {
    uppercaseAscii(buffer, (double)length);
    if (fwrite(buffer, 1, length, output) != length) {
      failed = 1;
      break;
    }
  }
  failed |= ferror(input) != 0;
  failed |= fclose(input) != 0;
  failed |= fclose(output) != 0;
  return failed ? 5 : 0;
}
