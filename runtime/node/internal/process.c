#include <uv.h>
#include "nts_node.h"
#include "shared.h"

/* Transcribed from node `src/node_process_methods.cc:159` (`Cwd`). */
NtsString *nts_process_cwd(void) {
    char buf[4096];
    size_t len = sizeof(buf);
    int err = uv_cwd(buf, &len);
    if (err != 0) {
        nts_node_set_errno(err);
        return nts_string_from_utf8("", 0);
    }
    nts_node_set_errno(0);
    return nts_string_from_utf8(buf, len);
}


/* `process.env[name]`, empty when unset. `win32.resolve` reads `=C:` to find a
 * drive-relative working directory; on a posix host there is none, and the
 * empty answer is what upstream's `||` falls through on. */
NtsString *nts_process_env(NtsString *name) {
    char key[1024];
    nts_node_to_utf8(name, key, sizeof key);
    char value[4096];
    size_t len = sizeof(value);
    if (uv_os_getenv(key, value, &len) != 0) {
        return nts_string_from_utf8("", 0);
    }
    return nts_string_from_utf8(value, len);
}
