// A dictionary whose members C is told were given or not, as WebIDL tells an
// implementation (`hasKeepalive()`): each such member a `Given<T>` pair in
// `types/options.d.ts`, here an untagged struct inside the one that holds it.
#ifndef NTS_NATIVE_GIVEN_OPTIONS_H
#define NTS_NATIVE_GIVEN_OPTIONS_H

#include <stdbool.h>
#include <stdint.h>

struct options {
  struct {
    bool given;
    uint8_t value;
  } keepalive;
  struct {
    bool given;
    double value;
  } priority;
  // A member without presence: zero when left out, as any field is.
  int32_t plain;
};

// Prints `label`, then each member as C received it, on one line.
void options_report(const char *label, struct options options);

#endif
