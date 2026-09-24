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

/* `IUnknown::Release`, uncounted: the runtime's own references. */
static void nts_unknown_release(void *object) {
  (*(const NtsUnknownTable **)object)->release(object);
}

/* The program's releases, which the counting provider emits: counted, so a
 * test can see the provider give back what it took. */
void nts_com_release(void *object) {
  if (object != 0) {
    releases++;
    nts_unknown_release(object);
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

/* A run of UTF-16 units: a string's, lent for a call, or a literal's. */
typedef struct {
  const uint16_t *units;
  uint32_t length;
} NtsUnits;

static int nts_parse_iid(NtsUnits text, IID *out);

/* A delegate object: the layout the adapter reads (`NtsComDelegate`), then
 * this object's own table -- `Invoke` differs by signature, so the table is
 * per object rather than per type -- its count, and the interface it is.
 *
 * Not agile, and says so: `QueryInterface` answers `IUnknown` and the
 * delegate's own interface, never `IAgileObject`. The closure it calls is
 * the owning thread's, and a source that would call it from another thread
 * has to marshal to this one; one that calls it here directly is what the
 * bridge checks, ending the process by name. */
typedef struct {
  NtsComDelegate head;
  const void *slots[4];
  volatile LONG count;
  IID iid;
} NtsDelegateObject;

static uint32_t delegates;

/* {00000000-0000-0000-C000-000000000046}, spelled here so that no `uuid`
 * library is linked for one constant. */
static const IID nts_iid_unknown = {
    0x00000000, 0x0000, 0x0000, {0xC0, 0, 0, 0, 0, 0, 0, 0x46}};

static ULONG STDMETHODCALLTYPE nts_delegate_add_ref(void *self) {
  return (ULONG)InterlockedIncrement(&((NtsDelegateObject *)self)->count);
}

static ULONG STDMETHODCALLTYPE nts_delegate_release(void *self) {
  NtsDelegateObject *delegate = self;
  LONG left = InterlockedDecrement(&delegate->count);
  if (left == 0) {
    if (!nts_is_owner_thread()) {
      fprintf(stderr, "nts: a delegate was released off the thread that owns "
                      "its closure\n");
      abort();
    }
    nts_closure_unlend(delegate->head.context);
    delegates--;
    free(delegate);
  }
  return (ULONG)left;
}

static HRESULT STDMETHODCALLTYPE nts_delegate_query(void *self, const IID *iid,
                                                    void **out) {
  NtsDelegateObject *delegate = self;
  if (IsEqualGUID(iid, &nts_iid_unknown) || IsEqualGUID(iid, &delegate->iid)) {
    nts_delegate_add_ref(self);
    *out = self;
    return S_OK;
  }
  *out = 0;
  return E_NOINTERFACE;
}

void *nts_com_delegate(void *invoke, void *bridge, void *context,
                       const NtsString *iid) {
  NtsDelegateObject *delegate = malloc(sizeof *delegate);
  if (delegate == 0) {
    fprintf(stderr, "nts: out of memory making a delegate\n");
    abort();
  }
  const uint16_t *units = nts_string_to_utf16(iid);
  int parsed = nts_parse_iid((NtsUnits){units, iid->length}, &delegate->iid);
  nts_utf16_release(iid, units);
  if (!parsed) {
    fprintf(stderr, "nts: a delegate's interface ID does not parse\n");
    abort();
  }
  delegate->slots[0] = (const void *)nts_delegate_query;
  delegate->slots[1] = (const void *)nts_delegate_add_ref;
  delegate->slots[2] = (const void *)nts_delegate_release;
  delegate->slots[3] = invoke;
  delegate->head.table = delegate->slots;
  delegate->head.bridge = bridge;
  delegate->head.context = context;
  delegate->count = 1;
  delegates++;
  return delegate;
}

uint32_t nts_com_delegates(void) { return delegates; }

/* `object` as the interface `iid` names, by `QueryInterface`: a reference of
 * its own, which the caller releases. An object without the interface ends
 * the process naming it -- the binding said its class implements it, and a
 * wrong table is not something to call through. */
void *nts_com_query(void *object, const NtsString *iid) {
  IID wanted;
  const uint16_t *units = nts_string_to_utf16(iid);
  int parsed = nts_parse_iid((NtsUnits){units, iid->length}, &wanted);
  nts_utf16_release(iid, units);
  if (!parsed) {
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
static int nts_parse_iid(NtsUnits text, IID *out) {
  char buffer[40];
  uint32_t n = 0;
  for (uint32_t at = 0; at < text.length && n + 1 < sizeof buffer; at++) {
    uint16_t unit = text.units[at];
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
static uint32_t nts_factory_key(NtsUnits class_name, NtsUnits iid,
                                uint16_t *into, uint32_t room) {
  uint32_t length = class_name.length + 1 + iid.length;
  if (into != 0 && length <= room) {
    memcpy(into, class_name.units, class_name.length * sizeof *into);
    into[class_name.length] = 0;
    memcpy(into + class_name.length + 1, iid.units, iid.length * sizeof *into);
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
static void *nts_factory(NtsUnits class_name, NtsUnits iid) {
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
  HSTRING name = 0;
  WindowsCreateString((const wchar_t *)class_name.units, class_name.length,
                      &name);
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

void *nts_winrt_factory(const NtsString *class_name, const NtsString *iid) {
  const uint16_t *name = nts_string_to_utf16(class_name);
  const uint16_t *id = nts_string_to_utf16(iid);
  void *factory = nts_factory((NtsUnits){name, class_name->length},
                              (NtsUnits){id, iid->length});
  nts_utf16_release(iid, id);
  nts_utf16_release(class_name, name);
  return factory;
}

/* A runtime class made by its default constructor, as the interface `iid`
 * names: `IActivationFactory::ActivateInstance` (slot 6) on the class's cached
 * factory, then `QueryInterface` from the `IInspectable` that answers. A
 * reference the caller owns. */
void *nts_winrt_activate(const NtsString *class_name, const NtsString *iid) {
  static const uint16_t activation[] = u"00000035-0000-0000-C000-000000000046";
  const uint16_t *name = nts_string_to_utf16(class_name);
  void *factory = nts_factory((NtsUnits){name, class_name->length},
                              (NtsUnits){activation, 36});
  nts_utf16_release(class_name, name);
  typedef HRESULT(STDMETHODCALLTYPE * Activate)(void *, void **);
  void *made = 0;
  HRESULT hr = ((Activate)(*(void ***)factory)[6])(factory, &made);
  if (FAILED(hr) || made == 0) {
    fprintf(stderr,
            "nts: the runtime class could not be constructed (0x%08lx)\n",
            (unsigned long)hr);
    abort();
  }
  void *answer = nts_com_query(made, iid);
  nts_unknown_release(made);
  return answer;
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
