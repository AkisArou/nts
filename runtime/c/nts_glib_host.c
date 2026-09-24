/* Before any header, as `nts_uv_host.h` asks. */
#if defined(__linux__) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE
#endif

#include "nts_glib_host.h"

#include "nts_runtime.h"
#include "nts_uv_host.h"

#include <glib.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* The source, and the poll record for libuv's descriptor inside it. */
typedef struct {
  GSource source;
  gpointer tag;
  /* Whether the descriptor is watched now; see `nts_glib_prepare`. */
  bool watching;
} NtsGlibSource;

/* Changed only when it changes: modifying a watch wakes the context, and
 * doing it on every prepare kept an idle loop from ever sleeping. */
static void nts_glib_watch(NtsGlibSource *self, bool watch) {
  if (self->watching != watch) {
    g_source_modify_unix_fd(&self->source, self->tag, watch ? G_IO_IN : 0);
    self->watching = watch;
  }
}

static NtsGlibSource *nts_glib_source;

/* Due now, or as soon as libuv's next timer is: that is the whole of what a
 * prepare answers. A task posted from compiled code starts libuv's idle handle,
 * which makes the timeout 0 -- so a queued task is picked up on the next
 * iteration instead of after the next unrelated event. */
/*
 * Except inside a callback. A handler that turns GLib's loop itself -- a
 * modal dialog, a menu, drag and drop, `g_main_context_iteration` -- would
 * otherwise have libuv's tasks run in there, starting with the handler's
 * frames still below them, where JavaScript runs the handler to completion
 * first. So while one is on the stack the source is never ready and does not
 * even watch libuv's descriptor, which staying readable would make that
 * nested loop spin; the next prepare outside the callback watches it again. */
static gboolean nts_glib_prepare(GSource *source, gint *timeout) {
  NtsGlibSource *self = (NtsGlibSource *)source;
  if (nts_in_callback()) {
    nts_glib_watch(self, false);
    *timeout = -1;
    return FALSE;
  }
  nts_glib_watch(self, true);
  int due = nts_uv_host_backend_timeout();
  *timeout = due;
  return due == 0;
}

static gboolean nts_glib_check(GSource *source) {
  NtsGlibSource *self = (NtsGlibSource *)source;
  if (nts_in_callback()) {
    return FALSE;
  }
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
  self->watching = true;
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

void nts_glib_host_run(void) {
  /* libuv's own answer to "anything alive?", which the source's prepare
   * already asks: -1 is nothing. */
  while (nts_uv_host_backend_timeout() >= 0 || nts_closures_owed() > 0) {
    g_main_context_iteration(NULL, TRUE);
  }
}

void nts_glib_host_detach(void) {
  if (!nts_glib_source) {
    return;
  }
  g_source_destroy(&nts_glib_source->source);
  g_source_unref(&nts_glib_source->source);
  nts_glib_source = NULL;
}
