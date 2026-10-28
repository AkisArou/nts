import { profiles, loopProvider, type ProviderClaim, type ProviderSelector } from "../../../tooling/config/src/index.ts";

const source: ProviderClaim = { source: "./source.ts", members: ["alpha"] };
const compiler: ProviderClaim = { compiler: true, uses: ["construct"] };
const binding: ProviderClaim = { binding: "c:nts_loop" };
const choice: ProviderSelector = { use: "@nts/runtime", options: { adapter: "glib" } };
void [source, compiler, binding, choice];
void loopProvider("glib");
// @ts-expect-error Only an implemented adapter can be selected.
void loopProvider("banana");

// @ts-expect-error One implementation kind owns a feature.
const twoKinds: ProviderClaim = { compiler: true, source: "./source.ts" };
// @ts-expect-error A false compiler flag is not an implementation.
const falseCompiler: ProviderClaim = { compiler: false };
// @ts-expect-error A source path is package-relative.
const absoluteSource: ProviderClaim = { source: "/source.ts" };
// @ts-expect-error The shared policy cannot be mutated by an author.
profiles.native.pins["host:loop"] = { use: "another" };
void [twoKinds, falseCompiler, absoluteSource];
