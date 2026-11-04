/*---
description: "Control: Error and URIError generic instantiations preserve absent versus own empty message properties."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-generics, ts-generic-constraints]
flags: [module]
---*/
// Control: Error and URIError generic instantiations preserve absent versus own empty message properties. Route: a constrained generic at Error and URIError.
// Node prints: construction-message-generic:ok
class Fault {
  name: string; message: string; cause: unknown; text: string;
  constructor(name: string, message: string, cause: unknown, text: string) {
    this.name = name; this.message = message; this.cause = cause; this.text = text;
  }
}
const literalOwn: boolean[] = [false, false, true, true, false, false, true, true];
let literalIndex: number = 0;
function inspect<T extends Error>(value: T, message: string, own: boolean): void {
  assert.sameValue(value.message, message);
  assert.sameValue(literalOwn[literalIndex++], own);
}
inspect<Error>(new Fault("Error", "", undefined, "Error"), "", false);
inspect<Error>(new Fault("Error", "", undefined, "Error"), "", false);
inspect<Error>(new Fault("Error", "", undefined, "Error"), "", true);
inspect<Error>(new Fault("Error", "base", undefined, "Error: base"), "base", true);
inspect<URIError>(new Fault("URIError", "", undefined, "URIError"), "", false);
inspect<URIError>(new Fault("URIError", "", undefined, "URIError"), "", false);
inspect<URIError>(new Fault("URIError", "", undefined, "URIError"), "", true);
inspect<URIError>(new Fault("URIError", "uri", undefined, "URIError: uri"), "uri", true);
console.log("construction-message-generic:ok");
