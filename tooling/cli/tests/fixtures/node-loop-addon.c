#include <node_api.h>
#include <stdlib.h>
#include <uv.h>

#include "nts_node.h"

typedef struct {
    uv_work_t request;
    napi_env env;
    napi_deferred deferred;
    int answer;
} Job;

static void work(uv_work_t *request) {
    Job *job = request->data;
    job->answer = 42;
}

static void after(uv_work_t *request, int status) {
    Job *job = request->data;
    napi_handle_scope scope;
    if (napi_open_handle_scope(job->env, &scope) != napi_ok) abort();
    napi_value answer;
    if (napi_create_int32(job->env, status == 0 ? job->answer : status, &answer) != napi_ok) abort();
    if (napi_resolve_deferred(job->env, job->deferred, answer) != napi_ok) abort();
    if (napi_close_handle_scope(job->env, scope) != napi_ok) abort();
    free(job);
}

static napi_value start(napi_env env, napi_callback_info info) {
    (void)info;
    Job *job = calloc(1, sizeof(*job));
    if (job == NULL) abort();
    job->env = env;
    job->request.data = job;
    napi_value promise;
    if (napi_create_promise(env, &job->deferred, &promise) != napi_ok) abort();
    if (uv_queue_work(nts_node_loop(), &job->request, work, after) != 0) abort();
    return promise;
}

static napi_value same_loop(napi_env env, napi_callback_info info) {
    (void)info;
    uv_loop_t *host;
    napi_value result;
    if (napi_get_uv_event_loop(env, &host) != napi_ok) abort();
    if (napi_get_boolean(env, host == nts_node_loop(), &result) != napi_ok) abort();
    return result;
}

static napi_value private_default(napi_env env, napi_callback_info info) {
    (void)info;
    uv_loop_t *host;
    napi_value result;
    if (napi_get_uv_event_loop(env, &host) != napi_ok) abort();
    if (napi_get_boolean(env, host != uv_default_loop(), &result) != napi_ok) abort();
    return result;
}

NAPI_MODULE_INIT() {
    nts_napi_set_env(env);
    const napi_property_descriptor properties[] = {
        {.utf8name = "start", .method = start, .attributes = napi_default},
        {.utf8name = "sameLoop", .method = same_loop, .attributes = napi_default},
        {.utf8name = "privateDefault", .method = private_default, .attributes = napi_default},
    };
    if (napi_define_properties(env, exports, 3, properties) != napi_ok) abort();
    return exports;
}
