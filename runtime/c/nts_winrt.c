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
NtsString *nts_string_copy_hstring(void *h) {
  UINT32 length = 0;
  const wchar_t *units = WindowsGetStringRawBuffer((HSTRING)h, &length);
  return nts_str_alloc((const uint16_t *)units, length);
}

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
 * Agile, as C++/WinRT's delegates are: `QueryInterface` answers
 * `IAgileObject`, so a source calls it on whatever thread it completes on
 * rather than marshalling to this one -- which in a single-threaded
 * apartment would wait on a message loop to pump. The closure is still the
 * owning thread's: an `Invoke` there calls it, and one anywhere else is
 * carried there (`nts_com_carry`), as the last `Release` is. */
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

/* The delegate's end, on the thread owning its closure. */
static void nts_delegate_free(void *self) {
  NtsDelegateObject *delegate = self;
  nts_closure_unlend(delegate->head.context);
  delegates--;
  free(delegate);
}

static ULONG STDMETHODCALLTYPE nts_delegate_add_ref(void *self) {
  return (ULONG)InterlockedIncrement(&((NtsDelegateObject *)self)->count);
}

static ULONG STDMETHODCALLTYPE nts_delegate_release(void *self) {
  NtsDelegateObject *delegate = self;
  LONG left = InterlockedDecrement(&delegate->count);
  if (left == 0) {
    if (nts_is_owner_thread()) {
      nts_delegate_free(delegate);
    } else {
      /* The closure's count is the owning thread's: its give-back is
       * carried there, and so is the object, which counts delegates. */
      nts_post_from_any_thread(
          (NtsTask){nts_delegate_free, nts_delegate_free, delegate});
    }
  }
  return (ULONG)left;
}

static HRESULT STDMETHODCALLTYPE nts_delegate_query(void *self, const IID *iid,
                                                    void **out) {
  NtsDelegateObject *delegate = self;
  /* {94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90}: callable on any thread. */
  static const IID agile = {0x94EA2B94,
                            0xE9CC,
                            0x49E0,
                            {0xC0, 0xFF, 0xEE, 0x64, 0xCA, 0x8F, 0x5B, 0x90}};
  if (IsEqualGUID(iid, &nts_iid_unknown) || IsEqualGUID(iid, &agile) ||
      IsEqualGUID(iid, &delegate->iid)) {
    nts_delegate_add_ref(self);
    *out = self;
    return S_OK;
  }
  *out = 0;
  return E_NOINTERFACE;
}

/* One carried `Invoke`: the delegate and the arguments' copy, with the
 * offsets of the objects in it, which the carry holds a count of. */
typedef struct {
  void *delegate;
  void (*run)(void *delegate, void *arguments);
  const uint32_t *objects;
  uint32_t count;
  unsigned char arguments[];
} NtsCarried;

static void nts_carried_give_back(void *state) {
  NtsCarried *carried = state;
  for (uint32_t at = 0; at < carried->count; at++) {
    nts_com_release(*(void **)(carried->arguments + carried->objects[at]));
  }
  nts_com_release(carried->delegate);
  free(carried);
}

/* The give-back follows the call and is not skipped by it: a handler that
 * throws does not unwind through here, since the bridge ends the process at
 * the boundary, naming it (windows-winrt's `throw` arm). */
static void nts_carried_run(void *state) {
  NtsCarried *carried = state;
  carried->run(carried->delegate, carried->arguments);
  nts_carried_give_back(state);
}

void nts_com_carry(void *delegate, const void *arguments, size_t size,
                   const uint32_t *objects, uint32_t count,
                   void (*run)(void *delegate, void *arguments)) {
  NtsCarried *carried = malloc(sizeof *carried + size);
  if (carried == 0) {
    fprintf(stderr, "nts: out of memory carrying a delegate's call\n");
    abort();
  }
  carried->delegate = delegate;
  carried->run = run;
  carried->objects = objects;
  carried->count = count;
  memcpy(carried->arguments, arguments, size);
  nts_com_addref(delegate);
  for (uint32_t at = 0; at < count; at++) {
    nts_com_addref(*(void **)(carried->arguments + objects[at]));
  }
  nts_post_from_any_thread(
      (NtsTask){nts_carried_run, nts_carried_give_back, carried});
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

/* The outer object a class the program writes over a composable class is
 * (`nts_com_compose`): a face per interface it answers itself -- its
 * identity, WinUI's metadata provider where asked for, and one per
 * interface it overrides -- each a table and the way back to the object,
 * its count, and the base class's object it aggregates (`inner`, the
 * non-delegating `IInspectable`). Everything it does not answer is the
 * inner's. `instance` is the base's default interface on the aggregate: what
 * the program holds and `this` is, not held here, since its count is this
 * object's. Measured first as a C oracle on the VM
 * (~/.cache/nts/windows/oracles/winui-aggregation.c). */
typedef struct NtsComOuter NtsComOuter;
typedef struct {
  const void *const *table;
  NtsComOuter *outer;
  /* The inner's own implementation of this face's interface, which a slot
   * the class does not override forwards to: found on the first forward. */
  void *volatile base;
} NtsComFace;
struct NtsComOuter {
  volatile LONG count;
  void *inner;
  void *instance;
  void *provider;
  /* The object holding the class's fields, made with the instance and given
   * back with it; null for a class without. */
  void *state;
  NtsComClass *cls;
  NtsComFace identity;
  NtsComFace metadata;
  NtsComFace faces[];
};

static NtsComOuter *nts_com_outer_of(void *face) {
  return ((NtsComFace *)face)->outer;
}

void *nts_com_outer_instance(void *face) {
  return nts_com_outer_of(face)->instance;
}

void *nts_com_outer_base(void *face) {
  NtsComFace *at = face;
  if (at->base != 0) {
    return at->base;
  }
  NtsComOuter *outer = at->outer;
  const NtsComInterface *answered = &outer->cls->interfaces[at - outer->faces];
  IID iid = nts_iid(answered->iid_low, answered->iid_high);
  void *base = 0;
  typedef HRESULT(STDMETHODCALLTYPE * Query)(void *, const IID *, void **);
  HRESULT hr = ((Query)(*(void ***)outer->inner)[0])(outer->inner, &iid, &base);
  if (FAILED(hr) || base == 0) {
    fprintf(stderr,
            "nts: %s's base does not implement an interface it overrides "
            "(0x%08lx)\n",
            outer->cls->name, (unsigned long)hr);
    abort();
  }
  /* The reference the query took is this object's -- an aggregated
   * interface counts on its outer object -- so it is given back at once, and
   * the pointer lives as long as the inner, which this object holds. */
  ((ULONG(STDMETHODCALLTYPE *)(void *))(*(void ***)base)[2])(base);
  InterlockedCompareExchangePointer((void *volatile *)&at->base, base, 0);
  return at->base;
}

void *nts_com_state(void *instance) {
  /* `IUnknown` is the object's identity, which an aggregated interface asks
   * its outer object for: this runtime's identity face. */
  static const IID unknown = {0, 0, 0, {0xC0, 0, 0, 0, 0, 0, 0, 0x46}};
  void *identity = 0;
  typedef HRESULT(STDMETHODCALLTYPE * Query)(void *, const IID *, void **);
  HRESULT hr = ((Query)(*(void ***)instance)[0])(instance, &unknown, &identity);
  if (FAILED(hr) || identity == 0 ||
      (*(void ***)identity)[0] != (void *)nts_com_outer_query) {
    fprintf(stderr, "nts: a field read of an object this program did not "
                    "compose\n");
    abort();
  }
  NtsComOuter *outer = nts_com_outer_of(identity);
  /* Lent: the instance holds the outer object, and the query's reference is
   * given back at once. */
  InterlockedDecrement(&outer->count);
  return outer->state;
}

void *nts_com_base(void *instance, uint64_t iid_low, uint64_t iid_high) {
  IID iid = nts_iid(iid_low, iid_high);
  void *answer = 0;
  typedef HRESULT(STDMETHODCALLTYPE * Query)(void *, const IID *, void **);
  typedef ULONG(STDMETHODCALLTYPE * Count)(void *);
  HRESULT hr = ((Query)(*(void ***)instance)[0])(instance, &iid, &answer);
  if (FAILED(hr) || answer == 0) {
    fprintf(stderr,
            "nts: `super` names an interface the object does not implement "
            "(0x%08lx)\n",
            (unsigned long)hr);
    abort();
  }
  /* A class overriding the interface answers its own face, with the base's
   * implementation behind it; one overriding none of it, the inner's own,
   * which is the base's. Either reference counts on the outer object. */
  if ((*(void ***)answer)[0] != (void *)nts_com_outer_query) {
    return answer;
  }
  void *base = nts_com_outer_base(answer);
  ((Count)(*(void ***)base)[1])(base);
  ((Count)(*(void ***)answer)[2])(answer);
  return base;
}

/* {AF86E2E0-B12D-4C6A-9C5A-D7AA65101E90} and IXamlMetadataProvider's
 * {A96251F0-2214-5D53-8746-CE99A2593CD7}. */
static const IID nts_iid_inspectable = {
    0xAF86E2E0,
    0xB12D,
    0x4C6A,
    {0x9C, 0x5A, 0xD7, 0xAA, 0x65, 0x10, 0x1E, 0x90}};
static const IID nts_iid_xaml_metadata = {
    0xA96251F0,
    0x2214,
    0x5D53,
    {0x87, 0x46, 0xCE, 0x99, 0xA2, 0x59, 0x3C, 0xD7}};

int32_t nts_com_outer_query(void *face, const void *iid, void **out) {
  NtsComOuter *outer = nts_com_outer_of(face);
  const IID *wanted = iid;
  NtsComFace *answer = 0;
  if (IsEqualGUID(wanted, &nts_iid_unknown) ||
      IsEqualGUID(wanted, &nts_iid_inspectable)) {
    answer = &outer->identity;
  } else if (outer->provider != 0 &&
             IsEqualGUID(wanted, &nts_iid_xaml_metadata)) {
    answer = &outer->metadata;
  } else {
    for (uint32_t at = 0; at < outer->cls->count; at++) {
      IID own = nts_iid(outer->cls->interfaces[at].iid_low,
                        outer->cls->interfaces[at].iid_high);
      if (IsEqualGUID(wanted, &own)) {
        answer = &outer->faces[at];
        break;
      }
    }
  }
  if (answer != 0) {
    InterlockedIncrement(&outer->count);
    *out = answer;
    return S_OK;
  }
  return (*(const NtsUnknownTable **)outer->inner)
      ->query_interface(outer->inner, wanted, out);
}

uint32_t nts_com_outer_addref(void *face) {
  return (uint32_t)InterlockedIncrement(&nts_com_outer_of(face)->count);
}

uint32_t nts_com_outer_release(void *face) {
  NtsComOuter *outer = nts_com_outer_of(face);
  LONG left = InterlockedDecrement(&outer->count);
  if (left == 0) {
    /* Held against a re-entrant release while the base tears down. */
    outer->count = 1;
    if (outer->provider != 0) {
      nts_unknown_release(outer->provider);
    }
    nts_unknown_release(outer->inner);
    if (outer->state != 0) {
      nts_release((NtsHeader *)outer->state);
    }
    free(outer);
  }
  return (uint32_t)left;
}

int32_t nts_com_outer_iids(void *face, uint32_t *count, void **iids) {
  (void)face;
  *count = 0;
  *iids = 0;
  return S_OK;
}

int32_t nts_com_outer_name(void *face, void **name) {
  const char *text = nts_com_outer_of(face)->cls->name;
  wchar_t wide[256];
  int length = MultiByteToWideChar(CP_UTF8, 0, text, -1, wide, 256);
  return WindowsCreateString(wide, length > 0 ? (UINT32)length - 1 : 0,
                             (HSTRING *)name);
}

int32_t nts_com_outer_trust(void *face, int32_t *level) {
  (void)face;
  *level = 0; /* BaseTrust */
  return S_OK;
}

/* IXamlMetadataProvider's three methods, forwarded to WinUI's own
 * (`XamlControlsXamlMetaDataProvider`), which is what a XAML project
 * generates for an application with no types of its own. `GetXamlType`
 * takes a `TypeName` -- an HSTRING and an int, sixteen bytes, which Win64
 * passes by pointer -- and it is passed on as it came. */
static HRESULT STDMETHODCALLTYPE nts_com_metadata_type(void *face, void *type,
                                                       void **out) {
  void *provider = nts_com_outer_of(face)->provider;
  return ((HRESULT(STDMETHODCALLTYPE *)(void *, void *, void **))(
      *(void ***)provider)[6])(provider, type, out);
}
static HRESULT STDMETHODCALLTYPE nts_com_metadata_full(void *face, HSTRING name,
                                                       void **out) {
  void *provider = nts_com_outer_of(face)->provider;
  return ((HRESULT(STDMETHODCALLTYPE *)(void *, HSTRING, void **))(
      *(void ***)provider)[7])(provider, name, out);
}
static HRESULT STDMETHODCALLTYPE nts_com_metadata_xmlns(void *face,
                                                        UINT32 *count,
                                                        void **out) {
  void *provider = nts_com_outer_of(face)->provider;
  return ((HRESULT(STDMETHODCALLTYPE *)(void *, UINT32 *, void **))(
      *(void ***)provider)[8])(provider, count, out);
}

static const void *const nts_com_identity_table[] = {
    (const void *)nts_com_outer_query,   (const void *)nts_com_outer_addref,
    (const void *)nts_com_outer_release, (const void *)nts_com_outer_iids,
    (const void *)nts_com_outer_name,    (const void *)nts_com_outer_trust};
static const void *const nts_com_metadata_table[] = {
    (const void *)nts_com_outer_query,   (const void *)nts_com_outer_addref,
    (const void *)nts_com_outer_release, (const void *)nts_com_outer_iids,
    (const void *)nts_com_outer_name,    (const void *)nts_com_outer_trust,
    (const void *)nts_com_metadata_type, (const void *)nts_com_metadata_full,
    (const void *)nts_com_metadata_xmlns};

/* A runtime class activated by name as `iid`, for the runtime's own use:
 * WinUI's metadata provider. NULL where it cannot be. */
static void *nts_com_activate_named(const wchar_t *name, const IID *iid) {
  HSTRING_HEADER header;
  HSTRING reference = 0;
  void *made = 0;
  if (FAILED(WindowsCreateStringReference(name, (UINT32)wcslen(name), &header,
                                          &reference)) ||
      FAILED(RoActivateInstance(reference, (IInspectable **)&made)) ||
      made == 0) {
    return 0;
  }
  void *answer = 0;
  HRESULT hr =
      (*(const NtsUnknownTable **)made)->query_interface(made, iid, &answer);
  nts_unknown_release(made);
  return SUCCEEDED(hr) ? answer : 0;
}

void *nts_com_compose(NtsComClass *cls) {
  if (cls->factory == 0) {
    NtsString *base = nts_string_from_cstring(cls->base);
    IID wanted = nts_iid(cls->factory_low, cls->factory_high);
    cls->factory = nts_factory(base, &wanted);
    nts_release((NtsHeader *)base);
  }
  NtsComOuter *outer =
      calloc(1, sizeof *outer + (size_t)cls->count * sizeof(NtsComFace));
  if (outer == 0) {
    fprintf(stderr, "nts: out of memory composing %s\n", cls->name);
    abort();
  }
  outer->count = 1;
  outer->cls = cls;
  outer->identity = (NtsComFace){nts_com_identity_table, outer};
  outer->metadata = (NtsComFace){nts_com_metadata_table, outer};
  for (uint32_t at = 0; at < cls->count; at++) {
    outer->faces[at] = (NtsComFace){cls->interfaces[at].table, outer};
  }
  /* The fields hold their initial values before the base is made, so an
   * override the base calls while it composes reads them as JavaScript's
   * would. */
  if (cls->make_state != 0) {
    outer->state = cls->make_state();
  }
  if (cls->xaml_metadata) {
    outer->provider = nts_com_activate_named(
        L"Microsoft.UI.Xaml.XamlTypeInfo.XamlControlsXamlMetaDataProvider",
        &nts_iid_xaml_metadata);
  }
  typedef HRESULT(STDMETHODCALLTYPE * Create)(void *, void *, void **, void **);
  HRESULT hr = ((Create)(*(void ***)cls->factory)[cls->create_slot])(
      cls->factory, &outer->identity, &outer->inner, &outer->instance);
  if (FAILED(hr) || outer->inner == 0 || outer->instance == 0) {
    fprintf(stderr, "nts: %s could not be composed over %s (0x%08lx)\n",
            cls->name, cls->base, (unsigned long)hr);
    abort();
  }
  /* The instance's reference is this object's count, taken by the factory;
   * the creation reference is given back, leaving the program's. */
  InterlockedDecrement(&outer->count);
  return outer->instance;
}

/* The classes the program registered when it loaded, by name. A handful,
 * each composed where its `new` is written, so a list is the whole of it. */
typedef struct NtsComRegistered {
  NtsComClass *cls;
  struct NtsComRegistered *next;
} NtsComRegistered;
static NtsComRegistered *nts_com_registered;

void nts_com_register(NtsComClass *cls) {
  NtsComRegistered *entry = malloc(sizeof *entry);
  if (entry == 0) {
    abort();
  }
  entry->cls = cls;
  entry->next = nts_com_registered;
  nts_com_registered = entry;
}

void *nts_com_compose_named(const NtsString *name) {
  for (NtsComRegistered *at = nts_com_registered; at != 0; at = at->next) {
    const char *registered = at->cls->name;
    size_t length = strlen(registered);
    if (length == name->length && !(name->flags & NTS_TWO_BYTE) &&
        memcmp(NTS_ELEMENTS(name, unsigned char), registered, length) == 0) {
      return nts_com_compose(at->cls);
    }
  }
  fprintf(stderr, "nts: no class the program wrote over a Windows Runtime "
                  "class is registered under that name\n");
  abort();
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
