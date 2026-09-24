/* The Windows Runtime at the boundary: HSTRING, COM reference counts, class
 * activation and HRESULTs, for a program whose bindings call WinRT or COM.
 *
 * Declared in nts_runtime.h under `_WIN32`, so the Win64 signature table the
 * LLVM backend reads is clang's answer for these too; compiled only into a
 * Windows program. Everything the compiler emits calls these rather than the
 * Windows API directly, so the emitted code needs no Windows header. */
#include "nts_runtime.h"

#include <roapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <winstring.h>

/* A `string` as an HSTRING for one call: a copy (`WindowsCreateString`),
 * deleted by `nts_hstring_release` once the call returns. NULL is the empty
 * HSTRING, which WinRT spells NULL too.
 *
 * A copy, not `WindowsCreateStringReference` over the string's own units:
 * the fast-pass reference needs a header that outlives the call, and whether
 * saving the copy is worth that is a measurement not yet made. */
void *nts_string_to_hstring(const NtsString *s) {
  if (s == 0 || s->length == 0) {
    return 0;
  }
  const uint16_t *units = nts_string_to_utf16(s);
  HSTRING made = 0;
  HRESULT hr = WindowsCreateString((const wchar_t *)units, s->length, &made);
  nts_utf16_release(s, units);
  if (FAILED(hr)) {
    fprintf(stderr, "nts: WindowsCreateString failed (0x%08lx)\n",
            (unsigned long)hr);
    abort();
  }
  return made;
}

void nts_hstring_release(const NtsString *s, void *h) {
  (void)s;
  WindowsDeleteString((HSTRING)h);
}

/* An HSTRING a WinRT method returned, as a `string`: copied, and the HSTRING
 * deleted, since the caller owned it. NULL is the empty string. */
NtsString *nts_string_from_hstring(void *h) {
  UINT32 length = 0;
  const wchar_t *units = WindowsGetStringRawBuffer((HSTRING)h, &length);
  NtsString *made = nts_str_alloc((const uint16_t *)units, length);
  WindowsDeleteString((HSTRING)h);
  return made;
}

/* The object a WinRT method wrote to its result slot -- a pointer to the
 * interface pointer, `void *` so that every interface's converts -- which the
 * caller now owns: the call through which the compiler reads a COM result, so
 * that the ownership pass sees a +1 value produced by a call and releases it.
 */
void *nts_com_take(void *slot) { return *(void **)slot; }

/* `IUnknown::AddRef` and `Release`, which are slots 1 and 2 of every COM
 * object's table and not symbols. NULL is left alone. */
typedef struct {
  HRESULT(STDMETHODCALLTYPE *query_interface)(void *, const IID *, void **);
  ULONG(STDMETHODCALLTYPE *add_ref)(void *);
  ULONG(STDMETHODCALLTYPE *release)(void *);
} NtsUnknownTable;

void *nts_com_addref(void *object) {
  if (object != 0) {
    (*(const NtsUnknownTable **)object)->add_ref(object);
  }
  return object;
}

static uint32_t releases;

void nts_com_release(void *object) {
  if (object != 0) {
    releases++;
    (*(const NtsUnknownTable **)object)->release(object);
  }
}

/* How many references the program has given back: a test's view of whether
 * the counting provider releases what it took. */
uint32_t nts_com_releases(void) { return releases; }

/* The Windows Runtime on this thread, once: single-threaded, the apartment a
 * thread with a message loop is, and the one XAML requires. A thread already
 * initialized otherwise keeps what it has. */
static void nts_winrt_initialize(void) {
  static int initialized;
  if (initialized) {
    return;
  }
  initialized = 1;
  HRESULT hr = RoInitialize(RO_INIT_SINGLETHREADED);
  if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
    fprintf(stderr, "nts: RoInitialize failed (0x%08lx)\n", (unsigned long)hr);
    abort();
  }
}

static int nts_parse_iid(const NtsString *text, IID *out);

/* `object` as the interface `iid` names, by `QueryInterface`: a reference of
 * its own, which the caller releases. An object without the interface ends
 * the process naming it -- the binding said its class implements it, and a
 * wrong table is not something to call through. */
void *nts_com_query(void *object, const NtsString *iid) {
  IID wanted;
  if (!nts_parse_iid(iid, &wanted)) {
    fprintf(stderr,
            "nts: @ntsQuery names an interface ID that does not parse\n");
    abort();
  }
  void *answer = 0;
  HRESULT hr = (*(const NtsUnknownTable **)object)
                   ->query_interface(object, &wanted, &answer);
  if (FAILED(hr) || answer == 0) {
    const uint16_t *units = nts_string_to_utf16(iid);
    fprintf(stderr,
            "nts: the object does not implement the interface %ls (0x%08lx)\n",
            (const wchar_t *)units, (unsigned long)hr);
    abort();
  }
  return answer;
}

/* `{5F6B544A-2F53-48E1-91A3-F78B50A6345C}` or without the braces. */
static int nts_parse_iid(const NtsString *text, IID *out) {
  char buffer[40];
  uint32_t n = 0;
  for (uint32_t at = 0; at < text->length && n + 1 < sizeof buffer; at++) {
    uint16_t unit = nts_unit(text, at);
    if (unit != '{' && unit != '}') {
      buffer[n++] = (char)unit;
    }
  }
  buffer[n] = 0;
  unsigned long data1;
  unsigned int data2, data3, bytes[8];
  if (sscanf(buffer, "%8lx-%4x-%4x-%2x%2x-%2x%2x%2x%2x%2x%2x", &data1, &data2,
             &data3, &bytes[0], &bytes[1], &bytes[2], &bytes[3], &bytes[4],
             &bytes[5], &bytes[6], &bytes[7]) != 11) {
    return 0;
  }
  out->Data1 = data1;
  out->Data2 = (unsigned short)data2;
  out->Data3 = (unsigned short)data3;
  for (int i = 0; i < 8; i++) {
    out->Data4[i] = (unsigned char)bytes[i];
  }
  return 1;
}

/* One activated factory: its class and the interface asked for, as UTF-16
 * units the cache owns -- a call site's strings may be released once the
 * call returns -- and the object. */
typedef struct NtsFactory {
  uint16_t *key;
  uint32_t length;
  void *factory;
  struct NtsFactory *next;
} NtsFactory;

static uint32_t activations;

/* How many factories have been activated, for a test that the cache below
 * hits: a cache that never hits returns the right factory every time. */
uint32_t nts_winrt_activations(void) { return activations; }

/* `class` and `iid` as one key, `class` then a NUL then `iid`, in `into` when
 * it is large enough; the length either way. */
static uint32_t nts_factory_key(const NtsString *class_name,
                                const NtsString *iid, uint16_t *into,
                                uint32_t room) {
  uint32_t length = class_name->length + 1 + iid->length;
  if (into != 0 && length <= room) {
    uint32_t at = 0;
    for (uint32_t i = 0; i < class_name->length; i++) {
      into[at++] = nts_unit(class_name, i);
    }
    into[at++] = 0;
    for (uint32_t i = 0; i < iid->length; i++) {
      into[at++] = nts_unit(iid, i);
    }
  }
  return length;
}

/* A runtime class's activation factory, as the interface `iid` names --
 * `IJsonValueStatics` for `Windows.Data.Json.JsonValue` -- activated once and
 * kept for the life of the process, as C++/WinRT's factory cache keeps it.
 * Borrowed: the caller neither adds a reference nor releases one.
 *
 * A class that cannot be activated ends the process naming it: the binding
 * said it exists, and there is no value to go on with. */
void *nts_winrt_factory(const NtsString *class_name, const NtsString *iid) {
  static NtsFactory *factories;
  uint16_t probe[256];
  uint32_t length = nts_factory_key(class_name, iid, probe, 256);
  uint16_t *key = length <= 256 ? probe : malloc(length * sizeof *key);
  if (key == 0) {
    abort();
  }
  if (key != probe) {
    nts_factory_key(class_name, iid, key, length);
  }
  for (NtsFactory *known = factories; known != 0; known = known->next) {
    if (known->length == length &&
        memcmp(known->key, key, length * sizeof *key) == 0) {
      if (key != probe) {
        free(key);
      }
      return known->factory;
    }
  }
  nts_winrt_initialize();
  IID wanted;
  if (!nts_parse_iid(iid, &wanted)) {
    fprintf(stderr,
            "nts: a WinRT binding names an interface ID that does not parse\n");
    abort();
  }
  const uint16_t *units = nts_string_to_utf16(class_name);
  HSTRING name = 0;
  WindowsCreateString((const wchar_t *)units, class_name->length, &name);
  nts_utf16_release(class_name, units);
  void *factory = 0;
  HRESULT hr = RoGetActivationFactory(name, &wanted, &factory);
  WindowsDeleteString(name);
  if (FAILED(hr)) {
    fprintf(stderr,
            "nts: the Windows Runtime has no class the binding names "
            "(0x%08lx)\n",
            (unsigned long)hr);
    abort();
  }
  activations++;
  NtsFactory *kept = malloc(sizeof *kept);
  if (kept == 0) {
    abort();
  }
  if (key == probe) {
    key = malloc(length * sizeof *key);
    if (key == 0) {
      abort();
    }
    memcpy(key, probe, length * sizeof *key);
  }
  kept->key = key;
  kept->length = length;
  kept->factory = factory;
  kept->next = factories;
  factories = kept;
  return factory;
}

/* The message an `Error` thrown for a failed HRESULT carries: the code, and
 * the system's text for it where it has one. `malloc`'d; the caller frees. */
char *nts_hresult_message(int32_t hr) {
  char text[512] = {0};
  DWORD written =
      FormatMessageA(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                     0, (DWORD)hr, 0, text, sizeof text, 0);
  while (written > 0 &&
         (text[written - 1] == '\n' || text[written - 1] == '\r' ||
          text[written - 1] == ' ' || text[written - 1] == '.')) {
    text[--written] = 0;
  }
  char *message = malloc(written + 32);
  if (message == 0) {
    abort();
  }
  if (written > 0) {
    snprintf(message, written + 32, "HRESULT 0x%08lx: %s",
             (unsigned long)(uint32_t)hr, text);
  } else {
    snprintf(message, written + 32, "HRESULT 0x%08lx",
             (unsigned long)(uint32_t)hr);
  }
  return message;
}
