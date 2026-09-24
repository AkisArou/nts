/* Before any header, as `nts_uv_host.h` asks. */
#if defined(__linux__) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE
#endif

#include "nts_glib_host.h"

#include "nts_uv_host.h"

#include <glib.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* The source, and the poll record for libuv's descriptor inside it. */
typedef struct {
  GSource source;
  gpointer tag;
} NtsGlibSource;

static NtsGlibSource *nts_glib_source;

/* Due now, or as soon as libuv's next timer is: that is the whole of what a
 * prepare answers. A task posted from compiled code starts libuv's idle handle,
 * which makes the timeout 0 -- so a queued task is picked up on the next
 * iteration instead of after the next unrelated event. */
static gboolean nts_glib_prepare(GSource *source, gint *timeout) {
  (void)source;
  int due = nts_uv_host_backend_timeout();
  *timeout = due;
  return due == 0;
}

static gboolean nts_glib_check(GSource *source) {
  NtsGlibSource *self = (NtsGlibSource *)source;
  if (g_source_query_unix_fd(source, self->tag) != 0) {
    return TRUE;
  }
  return nts_uv_host_backend_timeout() == 0;
}

static gboolean nts_glib_dispatch(GSource *source, GSourceFunc callback,
                                  gpointer data) {
  (void)source;
  (void)callback;
  (void)data;
  nts_uv_host_pump();
  return G_SOURCE_CONTINUE;
}

static GSourceFuncs nts_glib_funcs = {
    .prepare = nts_glib_prepare,
    .check = nts_glib_check,
    .dispatch = nts_glib_dispatch,
};

void nts_glib_host_attach(void) {
  if (nts_glib_source) {
    return;
  }
  GSource *source = g_source_new(&nts_glib_funcs, sizeof(NtsGlibSource));
  NtsGlibSource *self = (NtsGlibSource *)source;
  self->tag = g_source_add_unix_fd(source, nts_uv_host_backend_fd(), G_IO_IN);
  /* The default priority, which is what GLib gives ordinary event sources and
   * GJS gives its own promise jobs: timers and promise work interleave with
   * input rather than starving it or being starved by it. */
  g_source_set_priority(source, G_PRIORITY_DEFAULT);
  g_source_set_name(source, "nts libuv");
  g_source_attach(source, NULL);
  nts_glib_source = self;
}

char *nts_gerror_take_message(struct _GError *error) {
  GError *reported = error;
  const char *text =
      reported->message != NULL ? reported->message : "unknown GLib error";
  size_t length = strlen(text);
  char *message = malloc(length + 1);
  if (message == NULL) {
    fprintf(stderr, "nts: out of memory\n");
    abort();
  }
  memcpy(message, text, length + 1);
  g_error_free(reported);
  return message;
}

void nts_glib_host_detach(void) {
  if (!nts_glib_source) {
    return;
  }
  g_source_destroy(&nts_glib_source->source);
  g_source_unref(&nts_glib_source->source);
  nts_glib_source = NULL;
}
