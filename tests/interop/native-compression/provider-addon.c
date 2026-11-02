/* Test transport only: execute the shipping managed C capability from the
 * unchanged package/WPT JavaScript harness. No codec policy lives here. */
#include "nts_web_compression.h"
#include <node_api.h>
#include <stdlib.h>

static void checked(napi_status status) {
  if (status != napi_ok)
    abort();
}
static void release_handle(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  nts_release(data);
}
static NtsHeader *handle(napi_env env, napi_value value) {
  void *pointer;
  checked(napi_get_value_external(env, value, &pointer));
  return pointer;
}
static double number(napi_env env, napi_value value) {
  double result;
  checked(napi_get_value_double(env, value, &result));
  return result;
}
static napi_value numeric(napi_env env, double value) {
  napi_value result;
  checked(napi_create_double(env, value, &result));
  return result;
}
static napi_value opened(napi_env env, napi_callback_info info) {
  napi_value args[3], result;
  size_t count = 3;
  bool decompress;
  checked(napi_get_cb_info(env, info, &count, args, NULL, NULL));
  if (count != 3)
    abort();
  checked(napi_get_value_bool(env, args[1], &decompress));
  NtsHeader *state = nts_web_compression_open(number(env, args[0]), decompress,
                                              number(env, args[2]));
  if (state == NULL)
    checked(napi_get_null(env, &result));
  else
    checked(napi_create_external(env, state, release_handle, NULL, &result));
  return result;
}
static napi_value processed(napi_env env, napi_callback_info info) {
  napi_value args[4], result;
  size_t count = 4;
  checked(napi_get_cb_info(env, info, &count, args, NULL, NULL));
  if (count != 4)
    abort();
  napi_typedarray_type kind;
  size_t length, offset;
  void *data;
  napi_value backing;
  checked(napi_get_typedarray_info(env, args[1], &kind, &length, &data,
                                   &backing, &offset));
  if (kind != napi_uint8_array)
    abort();
  NtsView *input = nts_view_from_bytes(data, (double)length);
  NtsArray *chunks = nts_web_compression_process(
      handle(env, args[0]), input, number(env, args[2]), number(env, args[3]));
  checked(napi_create_array_with_length(env, chunks->header.length, &result));
  for (uint32_t i = 0; i < chunks->header.length; i++) {
    const NtsView *chunk = NTS_ITEMS(chunks, NtsView *)[i];
    napi_value buffer, view;
    void *bytes;
    size_t size = (size_t)nts_view_byte_length(chunk);
    checked(napi_create_arraybuffer(env, size, &bytes, &buffer));
    if (size != 0)
      __builtin_memcpy(bytes, nts_view_bytes(chunk), size);
    checked(
        napi_create_typedarray(env, napi_uint8_array, size, buffer, 0, &view));
    checked(napi_set_element(env, result, i, view));
  }
  nts_release((NtsHeader *)chunks);
  nts_release((NtsHeader *)input);
  return result;
}
static napi_value control(napi_env env, napi_callback_info info) {
  napi_value arg, result;
  size_t count = 1;
  void *operation;
  checked(napi_get_cb_info(env, info, &count, &arg, NULL, &operation));
  if (count != 1)
    abort();
  NtsHeader *state = handle(env, arg);
  switch ((size_t)operation) {
  case 0:
    return numeric(env, nts_web_compression_status(state));
  case 1:
    return numeric(env, nts_web_compression_consumed(state));
  case 2:
    checked(napi_get_boolean(env, nts_web_compression_reset(state), &result));
    return result;
  default:
    nts_web_compression_close(state);
    checked(napi_get_undefined(env, &result));
    return result;
  }
}
static napi_value initialize(napi_env env, napi_value exports) {
  const char *names[] = {
      "nts_web_compression_open",   "nts_web_compression_process",
      "nts_web_compression_status", "nts_web_compression_consumed",
      "nts_web_compression_reset",  "nts_web_compression_close"};
  for (size_t i = 0; i < 6; i++) {
    napi_value function;
    napi_callback call = i == 0 ? opened : i == 1 ? processed : control;
    checked(napi_create_function(env, names[i], NAPI_AUTO_LENGTH, call,
                                 i < 2 ? NULL : (void *)(i - 2), &function));
    checked(napi_set_named_property(env, exports, names[i], function));
  }
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
