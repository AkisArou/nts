#include <stdio.h>

double runRecordingHostChecks(void);

int main(void) {
  const double checks = runRecordingHostChecks();
  printf("recording HostConfig native: %.0f checks passed\n", checks);
  return checks == 15.0 ? 0 : 1;
}
