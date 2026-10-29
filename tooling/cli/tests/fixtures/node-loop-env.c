#include <node_api.h>
#include <stddef.h>
#include <uv.h>

#include "nts_node.h"

static uv_loop_t loop_a, loop_b, loop_worker;
static int tag_a, tag_b;
static napi_env env_a = (napi_env)&tag_a;
static napi_env env_b = (napi_env)&tag_b;
static napi_cleanup_hook hooks[2];
static void *origins[2];
static unsigned hook_count;
static int worker_result;

napi_status napi_get_uv_event_loop(napi_env env, uv_loop_t **loop) {
    *loop = env == env_a ? &loop_a : &loop_b;
    return napi_ok;
}

napi_status napi_add_env_cleanup_hook(napi_env env, napi_cleanup_hook hook,
                                     void *data) {
    (void)env;
    if (hook_count >= 2) return napi_generic_failure;
    hooks[hook_count] = hook;
    origins[hook_count++] = data;
    return napi_ok;
}

static void worker(void *unused) {
    (void)unused;
    nts_node_set_loop(&loop_worker);
    worker_result = nts_node_loop() != &loop_worker;
}

int main(void) {
    nts_napi_set_env(env_a);
    if (nts_node_loop() != &loop_a) return 1;
    nts_napi_set_env(env_b);
    if (nts_node_loop() != &loop_b || hook_count != 2) return 2;
    hooks[0](origins[0]);
    if (nts_node_loop() != &loop_b) return 3;
    uv_thread_t thread;
    if (uv_thread_create(&thread, worker, NULL) != 0) return 4;
    if (uv_thread_join(&thread) != 0 || worker_result != 0) return 5;
    if (nts_node_loop() != &loop_b) return 6;
    hooks[1](origins[1]);
    if (nts_node_loop() != uv_default_loop()) return 7;
    return 0;
}
