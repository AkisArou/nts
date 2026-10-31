// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/server/utilities.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../checked.ts";
import { present } from "../checked.ts";
import { getBaseFileName } from "./_namespaces/ts.ts";
import { type Logger, LogLevel, type NormalizedPath, type ServerHost } from "./_namespaces/ts.server.ts";
/** @internal */
export class ThrottledOperations {
    constructor(host: ServerHost, logger: Logger) {
        this.host = host;
        this.pendingTimeouts = new Map<string, unknown>();
        this.logger = logger.hasLevel(LogLevel.verbose) ? logger : undefined;
    }
    declare private pendingTimeouts: Map<string, unknown>;
    declare private logger?: Logger | undefined;
    /**
     * Wait `number` milliseconds and then invoke `cb`.  If, while waiting, schedule
     * is called again with the same `operationId`, cancel this operation in favor
     * of the new one.  (Note that the amount of time the canceled operation had been
     * waiting does not affect the amount of time that the new operation waits.)
     */
    public schedule(operationId: string, delay: number, cb: () => void): void {
        const pendingTimeout = this.pendingTimeouts.get(operationId);
        if (pendingTimeout) {
            // another operation was already scheduled for this id - cancel it
            this.host.clearTimeout(pendingTimeout);
        }
        // schedule new operation, pass arguments
        this.pendingTimeouts.set(operationId, this.host.setTimeout(ThrottledOperations.run, delay, operationId, this, cb));
        if (this.logger) {
            this.logger.info(`Scheduled: ${operationId}${pendingTimeout ? ", Cancelled earlier one" : ""}`);
        }
    }
    public cancel(operationId: string): boolean {
        const pendingTimeout = this.pendingTimeouts.get(operationId);
        if (!pendingTimeout)
            return false;
        this.host.clearTimeout(pendingTimeout);
        return this.pendingTimeouts.delete(operationId);
    }
    private static run(operationId: string, self: ThrottledOperations, cb: () => void) {
        self.pendingTimeouts.delete(operationId);
        if (self.logger) {
            self.logger.info(`Running: ${operationId}`);
        }
        cb();
    }
    declare private host: ServerHost;
}
/** @internal */
export class GcTimer {
    constructor(host: ServerHost, delay: number, logger: Logger) {
        this.host = host;
        this.delay = delay;
        this.logger = logger;
    }
    declare private timerId: (unknown) | undefined;
    public scheduleCollect(): void {
        if (!this.host.gc || this.timerId !== undefined) {
            // no global.gc or collection was already scheduled - skip this request
            return;
        }
        this.timerId = this.host.setTimeout(GcTimer.run, this.delay, this);
    }
    private static run(self: GcTimer) {
        self.timerId = undefined;
        const log = self.logger.hasLevel(LogLevel.requestTime);
        const before = log && requireCompilerMember(self.host, "getMemoryUsage").getMemoryUsage(); // TODO: GH#18217
        requireCompilerMember(// TODO: GH#18217
        self.host, "gc").gc(); // TODO: GH#18217
        if (log) {
            const after = requireCompilerMember(self.host, "getMemoryUsage").getMemoryUsage(); // TODO: GH#18217
            self.logger.perftrc(`GC::before ${before}, after ${after}`);
        }
    }
    declare private host: ServerHost;
    declare private delay: number;
    declare private logger: Logger;
}
/** @internal */
export function getBaseConfigFileName(configFilePath: NormalizedPath): "tsconfig.json" | "jsconfig.json" | undefined {
    const base = getBaseFileName(configFilePath);
    return base === "tsconfig.json" || base === "jsconfig.json" ? base : undefined;
}
