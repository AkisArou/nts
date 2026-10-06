#ifndef NTS_CHROMIUM_HOST_APP_H_
#define NTS_CHROMIUM_HOST_APP_H_

/* An app: a program whose entry module exports `main(document: Document)`,
 * and optionally `unload()`, run in a document that opts in with
 * `<meta name="nts-app">`. One app per document; reload and navigation end
 * it and start the next document's own. The C/C++ boundary of app.c. */

#ifdef __cplusplus
extern "C" {
#endif

typedef struct NtsChromiumApp NtsChromiumApp;
typedef struct NtsDomContext NtsDomContext;

/* Starts the document's app: a host for its program (host.h), the context's
 * callbacks attached, Blink's checkpoints and idle-time collection
 * installed, then the program's `main(document)` in one entry. */
NtsChromiumApp* nts_chromium_app_start(NtsDomContext* context);

/* The document is ending: the program's `unload()`, if it exports one, runs
 * in an entry while the document can still be read. The caller then closes
 * the DOM context -- which gives back every closure it holds -- and only
 * then destroys the app. */
void nts_chromium_app_unload(NtsChromiumApp* app);

/* Ends the program's environment; nothing of the program may remain. */
void nts_chromium_app_destroy(NtsChromiumApp* app);

#ifdef __cplusplus
}
#endif
#endif
