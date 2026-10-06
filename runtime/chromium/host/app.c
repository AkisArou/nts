#include "app.h"

#include <stdlib.h>

/* Written by tooling/chromium/app.ts from the program's header: the C symbol
   of the app's `main` (an export named `main` is escaped), whether it takes
   over the caller's reference to the document, and `unload`'s symbol when the
   program exports one. */
#include "app_entry.h"
#include "dom_abi.h"
#include "dom_bridge.h"
#include "host.h"
#include "program.h"

struct NtsChromiumApp {
  NtsChromiumHost* host;
  NtsDomContext* context;
};

static void run_main(void* state) {
  (void)state;
  NtsDomDocument* document = nts_dom_document();
#if NTS_APP_MAIN_TAKES_DOCUMENT
  /* program.h: `main` takes over the caller's reference; give it its own. */
  nts_dom_retain(document);
#endif
  NTS_APP_MAIN((struct NtsDomDocument*)document);
}

NtsChromiumApp* nts_chromium_app_start(NtsDomContext* context) {
  NtsChromiumApp* app = calloc(1, sizeof(*app));
  if (!app)
    NTS_CHROMIUM_HOST_FAIL();
  app->host = nts_chromium_host_create();
  app->context = context;
  nts_chromium_host_attach(app->host, context);
  nts_chromium_host_install(app->host, context);
  NtsChromiumHostScope scope = nts_chromium_host_enter(app->host);
  if (nts_blink_dom_entry(context, run_main, app) || nts_raising())
    NTS_CHROMIUM_HOST_FAIL();
  nts_chromium_host_leave(&scope);
  return app;
}

#ifdef NTS_APP_UNLOAD
static void run_unload(void* state) {
  (void)state;
  NTS_APP_UNLOAD();
}
#endif

void nts_chromium_app_unload(NtsChromiumApp* app) {
#ifdef NTS_APP_UNLOAD
  NtsChromiumHostScope scope = nts_chromium_host_enter(app->host);
  /* A document already closed refuses the entry, and there is nothing left
     for `unload` to read. */
  nts_blink_dom_entry(app->context, run_unload, app);
  if (nts_raising())
    NTS_CHROMIUM_HOST_FAIL();
  nts_chromium_host_leave(&scope);
#else
  (void)app;
#endif
}

void nts_chromium_app_destroy(NtsChromiumApp* app) {
  if (!app)
    return;
  nts_chromium_host_destroy(app->host, NULL, NULL);
  free(app);
}
