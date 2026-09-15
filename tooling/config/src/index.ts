/**
 * Types and builders for `nts.config.ts`, per RFC §34.
 *
 * A build is composed from independent dimensions rather than selected from a
 * list of presets (RFC §6). Three of them are kept apart throughout, because
 * collapsing any two produces a config that cannot say something real:
 * **artifact kind**, **target**, and **backend**. `Backend` has three variants,
 * so iOS is not a backend -- it is LLVM plus a triple plus a host.
 *
 * Every builder returns plain data. Nothing executes beyond constructing
 * objects, so a resolved config can be read, cached and hashed.
 */

export * from "./native.ts";
export * from "./product.ts";
export * from "./target.ts";
export * from "./workspace.ts";
