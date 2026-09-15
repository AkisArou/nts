/* A digest, in portable C. No platform in it, which is the point. */
#ifndef CRYPTO_CORE_DIGEST_H
#define CRYPTO_CORE_DIGEST_H
#include <stdint.h>
#include <stddef.h>

uint32_t digest32(const uint8_t *bytes, size_t length);

#endif
