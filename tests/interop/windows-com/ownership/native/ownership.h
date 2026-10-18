#ifndef NTS_COM_OWNERSHIP_H
#define NTS_COM_OWNERSHIP_H
#define CINTERFACE
#include <unknwn.h>

typedef struct IEnumFixture IEnumFixture;
typedef struct {
  HRESULT(STDMETHODCALLTYPE *QueryInterface)(IEnumFixture *, REFIID, void **);
  ULONG(STDMETHODCALLTYPE *AddRef)(IEnumFixture *);
  ULONG(STDMETHODCALLTYPE *Release)(IEnumFixture *);
  HRESULT(STDMETHODCALLTYPE *Reset)(IEnumFixture *);
  HRESULT(STDMETHODCALLTYPE *Clone)(IEnumFixture *, IEnumFixture **);
} IEnumFixtureVtbl;
struct IEnumFixture {
  const IEnumFixtureVtbl *lpVtbl;
};
HRESULT OwnershipMake(IEnumFixture **output);

// The native owner keeps source alive until finish, including escaped borrows.
void ownership_start(int mode, void (*callback)(IEnumFixture *, void *),
                     void *context);
void ownership_finish(void);
unsigned ownership_counter(unsigned index);
#endif
