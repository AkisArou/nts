#include "digest.h"

/* FNV-1a. A real one would not be this, but the fixture is about the build
   graph rather than the hash. */
uint32_t digest32(const uint8_t *bytes, size_t length) {
    uint32_t hash = 2166136261u;
    for (size_t i = 0; i < length; i++) {
        hash ^= bytes[i];
        hash *= 16777619u;
    }
    return hash;
}
