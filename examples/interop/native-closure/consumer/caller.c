// Drives the closures the TypeScript compiled into, and checks what they
// captured.
#include <stdio.h>

#include "closures.h"
#include "program.h"

static int failures;

static void expect(const char *what, double got, double want) {
  if (got != want) {
    printf("FAIL %s: got %g, want %g\n", what, got, want);
    failures++;
  }
}

int main(void) {
  expect("scoped sum", sumTo(10), 55);
  expect("two contexts", twoContexts(), 610);
  expect("fewer parameters than C passes", countCalls(4), 4);
  expect("a handle in the callback", visitItems(), 10);
  // Retained: registered in one call, delivered in later ones.
  start();
  deliver(3);
  deliver(4);
  expect("retained total", total(), 7);
  expect("held while subscribed", subscribers(), 1);
  stop();
  expect("released on unsubscribe", subscribers(), 0);
  deliver(100);
  expect("nothing delivered after", total(), 7);
  if (failures)
    return 1;
  printf("capturing closures cross to C and back: OK\n");
  return 0;
}
