/**
 * Types and builders for `nts.config.ts`, per RFC §34.
 *
 * A build is composed from independent dimensions rather than selected from a
 * list of presets (RFC §6). This module is the surface that composition is
 * written against; the compiler validates the result and rejects combinations
 * that cannot be built, such as a bundled-private shared library asking for a
 * memory provider that needs a process-global heap (RFC §27.3).
 *
 * Every builder here returns plain data. Nothing executes at config load beyond
 * constructing objects, so a config can be read, cached, and hashed without
 * running arbitrary code.
 */

export * from "./build.ts";
export * from "./memory.ts";
export * from "./product.ts";
