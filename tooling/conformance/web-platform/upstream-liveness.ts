// The legacy runner shares the adapter's liveness instrument and outcome shape.
import { runInContext, type Context } from "node:vm";
import { WptHungError, WptInactivityGuard } from "../../../runtime/web-platform/test/wpt/hung.ts";
import type { WptActivity, WptDeadlineScheduler, WptResult } from "../../../runtime/web-platform/test/wpt/harness.ts";

export class UpstreamWptExecution {
  private readonly interrupted = Promise.withResolvers<never>();
  private readonly guard: WptInactivityGuard;
  private readonly vmMilliseconds: number;
  private readonly file: string;
  private hung: WptHungError | undefined;
  constructor(file: string, options: {
    deadlineScheduler?: WptDeadlineScheduler; inactivityMilliseconds?: number; vmMilliseconds?: number;
  } = {}) {
    this.file = file;
    this.guard = new WptInactivityGuard((activity, result) => this.interrupt(activity, result),
      options.deadlineScheduler, options.inactivityMilliseconds);
    this.vmMilliseconds = options.vmMilliseconds ?? 300000;
    void this.interrupted.promise.catch(() => {});
  }
  progress(test = "<registration>", phase: WptActivity["phase"] = "test", result?: WptResult): void {
    if (this.hung) throw this.hung;
    this.guard.renew({ file: this.file, test, phase }, result);
  }
  private interrupt(activity: WptActivity, result?: WptResult): WptHungError {
    if (!this.hung) {
      this.hung = new WptHungError(activity.file, activity.test, activity.phase, result);
      this.guard.close();
      this.interrupted.reject(this.hung);
    }
    return this.hung;
  }
  async observe<T>(name: string, outcome: Promise<T>): Promise<T> {
    this.progress(name);
    const value = await Promise.race([outcome, this.interrupted.promise]);
    if (!this.hung) this.progress(name);
    return value;
  }
  async observeSettlement(name: string, outcome: Promise<unknown>, cleanups: (() => unknown)[]): Promise<{
    body?: WptResult; cleanupErrors: unknown[]; hung?: WptHungError;
  }> {
    let body: WptResult;
    const cleanupErrors: unknown[] = [];
    try { await this.observe(name, outcome); body = { name, status: "pass" }; }
    catch (error) {
      if (error instanceof WptHungError) return { cleanupErrors, hung: error };
      body = { name, status: "fail", error };
    }
    for (let index = cleanups.length - 1; index >= 0; index--) {
      try {
        this.progress(name, "cleanup", body);
        await Promise.race([Promise.resolve(cleanups[index]!()), this.interrupted.promise]);
      } catch (error) {
        if (error instanceof WptHungError) return { body, cleanupErrors, hung: error };
        cleanupErrors.push(error);
      }
    }
    return { body, cleanupErrors };
  }
  async settle(name: string, outcome: Promise<unknown>, cleanups: (() => unknown)[]): Promise<void> {
    const observation = await this.observeSettlement(name, outcome, cleanups);
    if (observation.body?.status === "fail") throw observation.body.error;
    if (observation.cleanupErrors.length) throw observation.cleanupErrors[0];
    if (observation.hung) throw observation.hung;
  }
  vm(source: string, context: Context, filename: string): unknown {
    this.progress("<fixture script>", "registration");
    try { return runInContext(source, context, { filename, timeout: this.vmMilliseconds }); }
    catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
        const hung = new WptHungError(filename, "<fixture script>", "VM execution");
        this.hung = hung; this.guard.close(); this.interrupted.reject(hung);
        throw hung;
      }
      throw error;
    }
  }
  close(): void { this.guard.close(); }
}
