/* Observe the offset delivered to libuv, without filesystem size limits.
 * Link with --wrap=uv_fs_read; fs.c and this caller compile separately against
 * fs.h. A conversion through double must fail on 2^53 + 1. */
#include "../fs.h"
#include <stdint.h>
#include <uv.h>

const uint32_t nts_closure_call_slot = 0;
static int64_t captured;
static unsigned calls;

int __wrap_uv_fs_read(uv_loop_t *loop, uv_fs_t *request, uv_file file,
                     const uv_buf_t buffers[], unsigned count, int64_t offset,
                     uv_fs_cb callback) {
    (void)loop;
    (void)request;
    (void)file;
    (void)buffers;
    (void)count;
    (void)callback;
    captured = offset;
    calls++;
    return UV_EBADF;
}

int main(void) {
    const int64_t offsets[] = {INT64_C(9007199254740993), INT64_MAX - 1, -1};
    for (unsigned i = 0; i < sizeof(offsets) / sizeof(offsets[0]); i++) {
        nts_fs_read_bigint_async(0, 0, (__int128)offsets[i], NULL);
        if (calls != i + 1 || captured != offsets[i]) return 1;
    }
    nts_fs_read_async(0, 0, 3.75, NULL);
    return calls != 4 || captured != 3;
}
