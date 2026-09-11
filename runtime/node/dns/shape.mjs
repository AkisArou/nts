// The public object `node:dns` publishes, and the `dns/promises` subpath.
//
// Node's `dns` publishes its error codes and hint flags on the module object
// alongside the functions, and `test-dns-promises-exists.js` reads them by name.
// The resolver half -- `resolve*`, `Resolver`, `setServers`, `getServers` -- is
// absent here and is *not* stubbed: a name that exists and throws is worse than
// one that does not exist, because `'resolve4' in dns` would then answer true and
// a program would take the wrong branch.

/**
 * `dns.promises`, from whatever the lane carried.
 *
 * The TypeScript builds this object itself, so on the interpreted lane
 * `exports.promises` is already the real thing and this is not reached. On the
 * compiled lane it is: `promiseLookup` and `promiseLookupService` return
 * `Promise<an object>`, which the Node-API wrapper cannot carry outward -- see
 * `blockers/a-promise-returned-across-the-wrapper` -- so the backend declines the
 * whole namespace and 26 names that *did* cross end up with nowhere to live.
 *
 * Assembling it here is the same mechanism `path/shape.mjs` uses to build
 * `path.posix` out of the flat exports, and it is shaping rather than stubbing:
 * every member is a value the lane actually produced. What does not cross is
 * **absent**, not faked. On the compiled lane `dns.promises.lookup` is
 * `undefined`, which is truthful and is what `dns.lookup` already is there.
 */
function assemblePromises(shaped) {
  const promises = {};
  for (const [name, value] of Object.entries(shaped)) {
    // The constants and the result-order pair are what `node:dns/promises`
    // shares with `node:dns`. The callback-taking `lookup` and `lookupService`
    // are deliberately not copied: the promises namespace is not the callback
    // one, and a callback function reached through it would be a lie about its
    // signature.
    if (name === "lookup" || name === "lookupService") continue;
    promises[name] = value;
  }
  return promises;
}

export function shape(exports) {
  const dns = { ...exports };
  delete dns.default;
  delete dns.LookupAddress;
  delete dns.LookupOptions;
  if (dns.promises === undefined) {
    dns.promises = assemblePromises(dns);
  }
  return dns;
}

/**
 * `require('dns/promises')` is `dns.promises`, and node's own test asserts that
 * identity before it reads a single constant off either.
 */
export function subpaths(_exports, shaped) {
  return { "dns/promises": shaped.promises };
}
