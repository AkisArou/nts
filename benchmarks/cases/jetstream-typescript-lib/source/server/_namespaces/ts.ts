// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/server/_namespaces/ts.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
/* Generated file to emulate the ts namespace. */
export * from "../../compiler/_namespaces/ts.ts";
export * from "../../jsTyping/_namespaces/ts.ts";
export * from "../../services/_namespaces/ts.ts";
// Pull this in here so that plugins loaded by the server see compat wrappers.
export * from "../../deprecatedCompat/_namespaces/ts.ts";
import * as server from "./ts.server.ts";
export { server };
