#include <uv.h>

#include "nts_node.h"

/* Separate from process.c so a native test can use the loop without pulling
 * Node-API imports into an otherwise standalone program. One owner thread per
 * environment; another Node worker has its own installed loop. */
static _Thread_local uv_loop_t *hosted_loop;

void nts_node_set_loop(uv_loop_t *loop) { hosted_loop = loop; }

uv_loop_t *nts_node_loop(void) {
    if (hosted_loop != NULL) return hosted_loop;
    uv_loop_t *loop = nts_host_loop();
    return loop != NULL ? loop : uv_default_loop();
}
