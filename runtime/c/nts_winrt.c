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

/* A `string` as an HSTRING for one call: a fast-pass reference
 * (`WindowsCreateStringReference`), which copies nothing and, once the pool
 * below holds a frame, allocates nothing -- over the string's own units when
 * it is stored two bytes wide, or over a copy widened into the frame when it
 * is stored one byte wide, as every ASCII string is. A callee that keeps the
 * string makes its own copy (`WindowsDuplicateString`), which is the
 * reference's contract. NULL is the empty HSTRING, which WinRT spells NULL
 * too. Given back by `nts_hstring_release` once the call returns.
 *
 * It was a copy (`WindowsCreateString`) of a copy (`nts_string_to_utf16`
 * widens a one-byte string into a `malloc`): a string argument cost 64-74 ns
 * on the VM where C making the same call through the same slot costs 22.
 *
 * The references in use are a list, and the one being released is found by
 * its handle rather than by assuming a fast-pass HSTRING is its header's
 * address, which is true and documented nowhere. The list is as long as the
 * strings one call passes. */
#define NTS_HSTRING_INLINE 64

typedef struct NtsHstringFrame {
  HSTRING_HEADER header;
  HSTRING handle;
  uint16_t *heap;
  struct NtsHstringFrame *next;
  uint16_t units[NTS_HSTRING_INLINE + 1];
} NtsHstringFrame;

static _Thread_local NtsHstringFrame *nts_hstring_free;
static _Thread_local NtsHstringFrame *nts_hstring_used;

void *nts_string_to_hstring(const NtsString *s) {
  if (s == 0 || s->length == 0) {
    return 0;
  }
  NtsHstringFrame *frame = nts_hstring_free;
  if (frame != 0) {
    nts_hstring_free = frame->next;
  } else if ((frame = malloc(sizeof *frame)) == 0) {
    fprintf(stderr, "nts: out of memory\n");
    abort();
  }
  frame->heap = 0;
  const uint16_t *units = 0;
  if ((s->flags & NTS_TWO_BYTE) && NTS_ELEMENTS(s, uint16_t)[s->length] == 0) {
    units = NTS_ELEMENTS(s, uint16_t);
  } else {
    uint16_t *into = frame->units;
    if (s->length > NTS_HSTRING_INLINE &&
        (into = frame->heap = malloc(((size_t)s->length + 1u) * 2u)) == 0) {
      fprintf(stderr, "nts: out of memory\n");
      abort();
    }
    if (s->flags & NTS_TWO_BYTE) {
      memcpy(into, NTS_ELEMENTS(s, uint16_t), (size_t)s->length * 2u);
    } else {
      const unsigned char *bytes = NTS_ELEMENTS(s, unsigned char);
      for (uint32_t at = 0; at < s->length; at++) {
        into[at] = bytes[at];
      }
    }
    into[s->length] = 0;
    units = into;
  }
  HRESULT hr = WindowsCreateStringReference((const wchar_t *)units, s->length,
                                            &frame->header, &frame->handle);
  if (FAILED(hr)) {
    fprintf(stderr, "nts: WindowsCreateStringReference failed (0x%08lx)\n",
            (unsigned long)hr);
    abort();
  }
  frame->next = nts_hstring_used;
  nts_hstring_used = frame;
  return frame->handle;
}

void nts_hstring_release(const NtsString *s, void *h) {
  (void)s;
  if (h == 0) {
    return;
  }
  for (NtsHstringFrame **link = &nts_hstring_used; *link != 0;
       link = &(*link)->next) {
    NtsHstringFrame *frame = *link;
    if (frame->handle == (HSTRING)h) {
      *link = frame->next;
      free(frame->heap);
      frame->next = nts_hstring_free;
      nts_hstring_free = frame;
      return;
    }
  }
  fprintf(stderr, "nts: an HSTRING released that was not lent\n");
  abort();
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

/* An IID from the two words the compiler passes: its sixteen bytes as they
 * lie in memory, low word first. The compiler knows every IID a program
 * names, so none is parsed here -- a parse from text cost 440 ns a call,
 * measured, against 12.5 ns for the `QueryInterface` it served. */
static IID nts_iid(uint64_t low, uint64_t high) {
  IID iid;
  memcpy(&iid, &low, sizeof low);
  memcpy((unsigned char *)&iid + sizeof low, &high, sizeof high);
  return iid;
}

/* `iid` as `5F6B544A-2F53-48E1-91A3-F78B50A6345C`, for a message. */
static void nts_print_iid(FILE *to, const IID *iid) {
  fprintf(to, "%08lX-%04X-%04X-%02X%02X-%02X%02X%02X%02X%02X%02X",
          (unsigned long)iid->Data1, iid->Data2, iid->Data3, iid->Data4[0],
          iid->Data4[1], iid->Data4[2], iid->Data4[3], iid->Data4[4],
          iid->Data4[5], iid->Data4[6], iid->Data4[7]);
}

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
                       uint64_t iid_low, uint64_t iid_high) {
  NtsDelegateObject *delegate = malloc(sizeof *delegate);
  if (delegate == 0) {
    fprintf(stderr, "nts: out of memory making a delegate\n");
    abort();
  }
  delegate->iid = nts_iid(iid_low, iid_high);
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
static void *nts_query(void *object, const IID *iid) {
  void *answer = 0;
  HRESULT hr = (*(const NtsUnknownTable **)object)
                   ->query_interface(object, iid, &answer);
  if (FAILED(hr) || answer == 0) {
    fprintf(stderr, "nts: the object does not implement the interface ");
    nts_print_iid(stderr, iid);
    fprintf(stderr, " (0x%08lx)\n", (unsigned long)hr);
    abort();
  }
  return answer;
}

void *nts_com_query(void *object, uint64_t iid_low, uint64_t iid_high) {
  IID wanted = nts_iid(iid_low, iid_high);
  return nts_query(object, &wanted);
}

/* One activated factory: its class's name as UTF-16, which the cache owns,
 * the interface it was asked as, and the object. */
typedef struct NtsFactory {
  uint16_t *name;
  uint32_t length;
  IID iid;
  void *factory;
  struct NtsFactory *next;
} NtsFactory;

static uint32_t activations;

/* How many factories have been activated, for a test that the cache below
 * hits: a cache that never hits returns the right factory every time. */
uint32_t nts_winrt_activations(void) { return activations; }

/* Whether `s` is the class name `name`, compared in `s`'s own width: a
 * class name is ASCII and so stored one byte wide, and widening it to
 * compare was a `malloc` and a copy on every static call. */
static int nts_same_name(const NtsString *s, const uint16_t *name,
                         uint32_t length) {
  if (s->length != length) {
    return 0;
  }
  if (s->flags & NTS_TWO_BYTE) {
    return memcmp(NTS_ELEMENTS(s, uint16_t), name, (size_t)length * 2u) == 0;
  }
  const unsigned char *bytes = NTS_ELEMENTS(s, unsigned char);
  for (uint32_t at = 0; at < length; at++) {
    if (bytes[at] != name[at]) {
      return 0;
    }
  }
  return 1;
}

/* A runtime class's activation factory, as the interface `iid` names --
 * `IJsonValueStatics` for `Windows.Data.Json.JsonValue` -- activated once and
 * kept for the life of the process, as C++/WinRT's factory cache keeps it.
 * Borrowed: the caller neither adds a reference nor releases one.
 *
 * A class that cannot be activated ends the process naming it: the binding
 * said it exists, and there is no value to go on with. */
/* The Windows App SDK's release a program is bound against: 1.8, as
 * `MddBootstrapInitialize2` spells a major and minor version. The compiler's
 * `WINAPPSDK_VERSION` says the same, and a test holds the two together. */
#define NTS_WINAPPSDK_MAJOR_MINOR 0x00010008u

/* The Windows App SDK's runtime, found for this process once: an unpackaged
 * program asks the bootstrapper, which ships beside it, to add the installed
 * framework package to its package graph -- after which `Microsoft.*` classes
 * activate like any other. Loaded rather than linked, so a program that uses
 * no `Microsoft.*` class carries no dependency on it, and one that does and
 * lacks it is told which file is missing. */
static void nts_winappsdk_bootstrap(void) {
  static int bootstrapped;
  if (bootstrapped) {
    return;
  }
  bootstrapped = 1;
  HMODULE bootstrapper =
      LoadLibraryW(L"Microsoft.WindowsAppRuntime.Bootstrap.dll");
  if (bootstrapper == 0) {
    fprintf(stderr, "nts: Microsoft.WindowsAppRuntime.Bootstrap.dll is not "
                    "beside the program, which uses the Windows App SDK\n");
    abort();
  }
  typedef HRESULT(WINAPI * Initialize)(UINT32, PCWSTR, UINT64, int);
  Initialize initialize = (Initialize)(void (*)(void))GetProcAddress(
      bootstrapper, "MddBootstrapInitialize2");
  /* Any installed 1.8 runtime (minimum version 0), and no dialog offering to
   * install one: a program run unattended fails with the HRESULT instead. */
  HRESULT hr = initialize == 0
                   ? E_NOINTERFACE
                   : initialize(NTS_WINAPPSDK_MAJOR_MINOR, L"", 0, 0);
  if (FAILED(hr)) {
    fprintf(stderr,
            "nts: the Windows App SDK 1.8 runtime could not be found "
            "(0x%08lx); install it from "
            "https://aka.ms/windowsappsdk/1.8/latest/"
            "windowsappruntimeinstall-x64.exe\n",
            (unsigned long)hr);
    abort();
  }
}

static void *nts_factory(const NtsString *class_name, const IID *wanted) {
  static NtsFactory *factories;
  for (NtsFactory **link = &factories; *link != 0; link = &(*link)->next) {
    NtsFactory *known = *link;
    if (IsEqualGUID(&known->iid, wanted) &&
        nts_same_name(class_name, known->name, known->length)) {
      /* To the front: a program's loops call a few classes' statics. */
      *link = known->next;
      known->next = factories;
      factories = known;
      return known->factory;
    }
  }
  nts_winrt_initialize();
  NtsFactory *kept = malloc(sizeof *kept);
  uint16_t *name = malloc(((size_t)class_name->length + 1u) * 2u);
  if (kept == 0 || name == 0) {
    abort();
  }
  for (uint32_t at = 0; at < class_name->length; at++) {
    name[at] = (class_name->flags & NTS_TWO_BYTE)
                   ? NTS_ELEMENTS(class_name, uint16_t)[at]
                   : NTS_ELEMENTS(class_name, unsigned char)[at];
  }
  name[class_name->length] = 0;
  static const uint16_t microsoft[] = {'M', 'i', 'c', 'r', 'o',
                                       's', 'o', 'f', 't', '.'};
  if (class_name->length > 10 &&
      memcmp(name, microsoft, sizeof microsoft) == 0) {
    nts_winappsdk_bootstrap();
  }
  HSTRING_HEADER header;
  HSTRING reference = 0;
  void *factory = 0;
  HRESULT hr = WindowsCreateStringReference(
      (const wchar_t *)name, class_name->length, &header, &reference);
  if (SUCCEEDED(hr)) {
    hr = RoGetActivationFactory(reference, wanted, &factory);
  }
  if (FAILED(hr)) {
    fprintf(stderr,
            "nts: the Windows Runtime has no class the binding names "
            "(0x%08lx)\n",
            (unsigned long)hr);
    abort();
  }
  activations++;
  kept->name = name;
  kept->length = class_name->length;
  kept->iid = *wanted;
  kept->factory = factory;
  kept->next = factories;
  factories = kept;
  return factory;
}

void *nts_winrt_factory(const NtsString *class_name, uint64_t iid_low,
                        uint64_t iid_high) {
  IID wanted = nts_iid(iid_low, iid_high);
  return nts_factory(class_name, &wanted);
}

/* A runtime class made by its default constructor, as the interface `iid`
 * names: `IActivationFactory::ActivateInstance` (slot 6) on the class's cached
 * factory, then `QueryInterface` from the `IInspectable` that answers. A
 * reference the caller owns. */
void *nts_winrt_activate(const NtsString *class_name, uint64_t iid_low,
                         uint64_t iid_high) {
  /* `IActivationFactory`: {00000035-0000-0000-C000-000000000046}. */
  static const IID activation = {
      0x00000035, 0x0000, 0x0000, {0xC0, 0, 0, 0, 0, 0, 0, 0x46}};
  void *factory = nts_factory(class_name, &activation);
  typedef HRESULT(STDMETHODCALLTYPE * Activate)(void *, void **);
  void *made = 0;
  HRESULT hr = ((Activate)(*(void ***)factory)[6])(factory, &made);
  if (FAILED(hr) || made == 0) {
    fprintf(stderr,
            "nts: the runtime class could not be constructed (0x%08lx)\n",
            (unsigned long)hr);
    abort();
  }
  IID wanted = nts_iid(iid_low, iid_high);
  void *answer = nts_query(made, &wanted);
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
