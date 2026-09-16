/* A digest, in portable C. No platform in it, which is the point.
 *
 * **One step at a time, taking scalars.** The first version took
 * `const uint8_t *` and a length, and the TypeScript passed a `Uint8Array` to
 * it -- which was written before `nts bind-c` existed to say what the parameter
 * actually is. A generated binding types it `ConstPtr<c_uint8>`, and a
 * `Uint8Array` is not one: the buffer would have to be native storage the
 * program owns. That is a real thing this compiler can do and a different
 * fixture from this one, which is about the build graph. */
#ifndef CRYPTO_CORE_DIGEST_H
#define CRYPTO_CORE_DIGEST_H
#include <stdint.h>

uint32_t digest_step(uint32_t seed, uint32_t value);

#endif
