#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>
#include <zlib.h>
#include <zstd.h>
#include <brotli/encode.h>
#include <openssl/crypto.h>

#include "nts_node.h"
#include "shared.h"
#include "process.h"
#include "nts_node_deps_versions.h"

const uint32_t nts_closure_call_slot = 0;

int main(void) {
    if (strcmp(uv_version_string(), NTS_NODE_VERSION_UV) != 0) return 1;
    if (strcmp(OpenSSL_version(OPENSSL_VERSION_STRING), NTS_NODE_VERSION_OPENSSL) != 0) return 2;
    if (strcmp(ZSTD_versionString(), NTS_NODE_VERSION_ZSTD) != 0) return 3;
    unsigned major, minor, patch;
    if (sscanf(NTS_NODE_VERSION_BROTLI, "%u.%u.%u", &major, &minor, &patch) != 3) return 4;
    if (BrotliEncoderVersion() != ((major << 24) | (minor << 12) | patch)) return 5;
    const char *zlib = zlibVersion();
    if (strncmp(zlib, NTS_NODE_VERSION_ZLIB, strlen(zlib)) != 0) return 6;

    NtsArray *names = nts_process_version_names();
    NtsArray *values = nts_process_version_values();
    if (names->header.length != values->header.length) return 7;
    for (size_t i = 0; i < names->header.length; i++) {
        char *key = nts_node_to_utf8_alloc(NTS_ITEMS(names, NtsString *)[i], NULL);
        if (strcmp(key, "node") == 0 || strcmp(key, "uv") == 0 || strcmp(key, "openssl") == 0 ||
            strcmp(key, "brotli") == 0 || strcmp(key, "zlib") == 0 || strcmp(key, "zstd") == 0) {
            char *value = nts_node_to_utf8_alloc(NTS_ITEMS(values, NtsString *)[i], NULL);
            printf("%s=%s\n", key, value);
            free(value);
        }
        free(key);
    }
    return 0;
}
