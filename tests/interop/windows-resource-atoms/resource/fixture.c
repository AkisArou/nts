// Minimal entry for the resource fixture. No CRT, allocation, or dependencies.
int __stdcall nts_resource_entry(void *module, unsigned long reason,
                                 void *reserved) {
  (void)module;
  (void)reason;
  (void)reserved;
  return 1;
}
