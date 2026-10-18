#include "ownership.h"

// Static objects let a bad lifetime be counted deterministically instead of
// depending on allocator reuse or an access violation. Reset rejects dead refs.
typedef struct {
  IEnumFixture iface;
  ULONG references;
} Probe;
static Probe source, result;
static unsigned counters[10];
static int mode;

static ULONG STDMETHODCALLTYPE probe_addref(IEnumFixture *self) {
  Probe *probe = (Probe *)self;
  ++counters[self == &source.iface ? 0 : 2];
  if (probe->references == 0)
    ++counters[9];
  return ++probe->references;
}
static ULONG STDMETHODCALLTYPE probe_release(IEnumFixture *self) {
  Probe *probe = (Probe *)self;
  ++counters[self == &source.iface ? 1 : 3];
  if (probe->references == 0) {
    ++counters[9];
    return 0;
  }
  return --probe->references;
}
static HRESULT STDMETHODCALLTYPE probe_query(IEnumFixture *self, REFIID iid,
                                             void **out) {
  (void)iid;
  *out = self;
  probe_addref(self);
  return S_OK;
}
static HRESULT STDMETHODCALLTYPE probe_reset(IEnumFixture *self) {
  ++counters[self == &source.iface ? 5 : 4];
  if (((Probe *)self)->references == 0) {
    ++counters[9];
    return E_FAIL;
  }
  return S_OK;
}
static HRESULT STDMETHODCALLTYPE probe_clone(IEnumFixture *self,
                                             IEnumFixture **out) {
  (void)self;
  ++counters[8];
  *out = mode == 1 || mode == 4 ? NULL : &result.iface;
  result.references = *out != NULL;
  // mode 2/4 differ only in the canary/NULL failure output. No reference is
  // transferred on failure; the native owner holds the canary's reference.
  return mode == 2 || mode == 4 ? E_FAIL : mode == 3 ? S_FALSE : S_OK;
}
static const IEnumFixtureVtbl table = {
    .QueryInterface = probe_query,
    .AddRef = probe_addref,
    .Release = probe_release,
    .Reset = probe_reset,
    .Clone = probe_clone,
};
void ownership_start(int selected, void (*callback)(IEnumFixture *, void *),
                     void *context) {
  for (unsigned i = 0; i < 10; ++i)
    counters[i] = 0;
  mode = selected;
  source.iface.lpVtbl = &table;
  source.references = 1;
  result.iface.lpVtbl = &table;
  result.references = 0;
  callback(&source.iface, context);
}
void ownership_finish(void) { probe_release(&source.iface); }
unsigned ownership_counter(unsigned index) {
  if (index == 6)
    return result.references;
  if (index == 7)
    return source.references;
  return index < 10 ? counters[index] : 999;
}

HRESULT OwnershipMake(IEnumFixture **output) {
  return probe_clone(&source.iface, output);
}
