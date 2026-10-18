#include "desktop.h"

unsigned with_desktop(void (*callback)(IShellFolder *, void *), void *context) {
  HRESULT initialized = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
  if (FAILED(initialized))
    return 0;
  IShellFolder *folder = NULL;
  HRESULT hr = SHGetDesktopFolder(&folder);
  if (FAILED(hr) || folder == NULL) {
    CoUninitialize();
    return 0;
  }
  callback(folder, context);
  folder->lpVtbl->Release(folder);
  CoUninitialize();
  return 1;
}
