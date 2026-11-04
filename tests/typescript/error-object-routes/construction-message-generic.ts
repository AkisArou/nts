/*---
description: "Error and URIError generic instantiations preserve absent versus own empty message properties."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-generics, ts-generic-constraints]
flags: [module]
---*/
// Error and URIError generic instantiations preserve absent versus own empty message properties. Route: a constrained generic at Error and URIError.
// Node prints: construction-message-generic:ok
function inspect<T extends Error>(value: T, message: string, own: boolean): void {
  assert.sameValue(value.message, message);
  assert.sameValue(Object.hasOwn(value, "message"), own);
}
inspect<Error>(new Error(), "", false);
inspect<Error>(new Error(undefined), "", false);
inspect<Error>(new Error(""), "", true);
inspect<Error>(new Error("base"), "base", true);
inspect<URIError>(new URIError(), "", false);
inspect<URIError>(new URIError(undefined), "", false);
inspect<URIError>(new URIError(""), "", true);
inspect<URIError>(new URIError("uri"), "uri", true);
console.log("construction-message-generic:ok");
