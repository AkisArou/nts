#include "digest.h"

/* FNV-1a, one byte at a time. A real one would not be this, but the fixture is
   about the build graph rather than the hash. */
uint32_t digest_step(uint32_t seed, uint32_t value) {
    return (seed ^ value) * 16777619u;
}
