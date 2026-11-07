// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/typescript/typescript.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { present } from "../checked.ts";
import { Debug, LogLevel } from "./_namespaces/ts.ts";
// enable deprecation logging
declare const console: { error(text: string): void; warn(text: string): void; log(text: string): void } | undefined;
if (typeof console !== "undefined") {
    Debug.loggingHost = {
        log(level, s) {
            switch (level) {
                case LogLevel.Error:
                    return (console)!.error(s);
                case LogLevel.Warning:
                    return (console)!.warn(s);
                case LogLevel.Info:
                    return (console)!.log(s);
                case LogLevel.Verbose:
                    return (console)!.log(s);
            }
        },
    };
}
export * from "./_namespaces/ts.ts";
