// `node:url`.
//
// Two APIs in one module, and the older one is deprecated. `URL` is the WHATWG
// class, specified in full and shared with browsers; `url.parse` is node's own
// from 2010, whose behaviour is not specified anywhere and which node's
// documentation now warns against by name.
//
// Both are here because both are used. The legacy half is in `legacy.ts`, kept
// apart so that its rules -- which are node's alone -- cannot be mistaken for
// the standard's.
//
// Where node hands `URL` to a C++ parser (`ada`), ours is TypeScript written
// from https://url.spec.whatwg.org/. It passes the Web Platform Tests corpus
// node checks itself against: 892 of 892 parses, 278 of 278 setter cases.

import { domainToASCII, domainToUnicode } from "./idna.ts";

export { URL, isURL } from "./url.ts";
export { URLSearchParams } from "./searchparams.ts";
export { fileURLToPath, pathToFileURL, urlToHttpOptions } from "./fileurl.ts";
export { domainToASCII, domainToUnicode };

export {
  Url, parse, format, resolve, resolveObject,
} from "./legacy.ts";
