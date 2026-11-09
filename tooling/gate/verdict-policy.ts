// Standing verdict policy shared by ordinary landings and full runs. A skip
// stays a named SKIPPED result; acceptance never turns it into a PASS.
export const STANDING_GATE_POLICY = Object.freeze({
  NTS_GATE_ACCEPT_SKIP: "on-device",
});

/** Exact program disagreements, kept visible until their outcome task is fixed. */
export const PROGRAM_DISAGREEMENTS: Readonly<Record<string, string>> = Object.freeze({
  "typed-array-aliasing": "node 26 answers 302 for a resizable ArrayBuffer with maxByteLength 2^31-1 or 2^32-1; nts throws RangeError. The old 2 GiB address-space oracle bound made node fail too",
});

/**
 * Programs that run on another platform. An Apple or Windows interop project
 * builds on this host and runs on a Mac or a Windows machine; with none
 * reachable, or a toolchain or SDK missing, its build prints a SKIP line
 * saying so and exits 0, and its step passes without having run there. Each
 * platform names the step that runs its programs and the lines that mean they
 * did not run.
 */
export const PLATFORM_PROGRAMS: Readonly<Record<string, { step: string; notRun: RegExp }>> = Object.freeze({
  apple: { step: "interop", notRun: /\bSKIP (macos|ios|interop-on-mac)/ },
  windows: { step: "interop", notRun: /\bSKIP (windows|winui)-/ },
});

export type UnrunPolicy = { readonly platforms: readonly string[]; readonly policy: string };

/**
 * The platforms whose programs may stay unrun: a run whose only refusals for
 * them are their platform skips is not held for them. No Mac or Windows
 * machine is bought yet.
 */
export const PLATFORMS_UNRUN_OK: UnrunPolicy = Object.freeze({ platforms: Object.freeze(["apple", "windows"]), policy: "user policy 2026-10-23" });

export type UnrunPlatform = { platform: string; line: string; accepted: boolean };

/** The platforms whose programs `step`'s log says did not run, each with its first such line, and whether `policy` lets it stay unrun. */
export function unrunPlatforms(step: string, log: string, policy: UnrunPolicy = PLATFORMS_UNRUN_OK): UnrunPlatform[] {
  const lines = log.split("\n");
  return Object.entries(PLATFORM_PROGRAMS).filter(([, programs]) => programs.step === step).flatMap(([platform, programs]) => {
    const line = lines.find(text => programs.notRun.test(text));
    return line === undefined ? [] : [{ platform, line: line.trim(), accepted: policy.platforms.includes(platform) }];
  });
}
