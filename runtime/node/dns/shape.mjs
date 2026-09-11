export function shape(exports) {
  // Node's `dns` publishes its error codes and hint flags on the module object
  // alongside the functions, and `test-dns-promises-exists.js` reads them by
  // name. The resolver half -- `resolve*`, `Resolver`, `setServers`,
  // `getServers` -- is absent here and is *not* stubbed: a name that exists and
  // throws is worse than one that does not exist, because `'resolve4' in dns`
  // would then answer true and a program would take the wrong branch.
  const dns = { ...exports };
  delete dns.default;
  delete dns.LookupAddress;
  delete dns.LookupOptions;
  return dns;
}
