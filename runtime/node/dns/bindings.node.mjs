// The `nts_dns_*` bindings, stood in for by node's own resolver.
//
// # This makes the interpreted lane test the TypeScript, not the resolver
//
// `nts_dns_getaddrinfo` here is `dns.lookup` there. So on the interpreted lane
// this module's TypeScript runs over **node's** resolver, and a comparison
// against node measures the argument parsing, the option handling, the result
// shaping and the callback ordering -- not whether the resolution is right.
//
// That is the same arrangement `zlib` has, where the stand-in imports
// `node:zlib` and the compression engine is only compared on the compiled lane.
// It is stated here because the alternative is to discover it later and call it
// a result: a stand-in that *is* the subject makes a lane pass for nothing, and
// `run.mjs --sabotage` is what distinguishes the two -- blanking this module
// still breaks every test, because the TypeScript above is what is under test.
//
// The resolver itself is compared only on the compiled lane, where the binding
// is `getaddrinfo` rather than node's.
import { lookup, lookupService } from "node:dns";
import { getSystemErrorName } from "node:util";

const errnoOf = (error) => {
  if (error === null || error === undefined) return 0;
  if (typeof error.errno === "number") return error.errno;
  return -1;
};

globalThis.nts_dns_getaddrinfo = (hostname, family, hints, order, callback) => {
  lookup(
    hostname,
    { family, hints, verbatim: order === 0 },
    (error, address, resolvedFamily) => {
      if (error) callback(errnoOf(error), "", 0);
      else callback(0, address, resolvedFamily);
    },
  );
};

globalThis.nts_dns_getaddrinfo_all = (hostname, family, hints, order, callback) => {
  lookup(
    hostname,
    { family, hints, all: true, verbatim: order === 0 },
    (error, addresses) => {
      if (error) {
        callback(errnoOf(error), [], []);
        return;
      }
      callback(0, addresses.map((a) => a.address), addresses.map((a) => a.family));
    },
  );
};

globalThis.nts_dns_getnameinfo = (address, port, callback) => {
  lookupService(address, port, (error, hostname, service) => {
    if (error) callback(errnoOf(error), "", "");
    else callback(0, hostname, service);
  });
};

// `uv_err_name`. Node exposes the same table through `util.getSystemErrorName`,
// which is the mapping this profile already uses for every other errno.
globalThis.nts_dns_errname = (errno) => {
  try {
    return getSystemErrorName(errno);
  } catch {
    return "UNKNOWN";
  }
};
