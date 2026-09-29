// How `compiled-axis.sh` prints a module, read once: by compiled-axis-floor.mjs,
// which holds each module to its row, and emitted-diff.ts, which runs the
// axis over the modules a change touched. Two readers of four row shapes would
// be two derivations of which modules were measured.

/** module -> { real } or { unmeasured: why }, from compiled-axis.sh's output. */
export function readAxis(text) {
  const rows = new Map();
  for (const line of text.split("\n")) {
    const name = /^([a-z_]+)\s+/.exec(line)?.[1];
    if (!name || name === "TOTAL") continue;
    const files = /\d+ file\(s\): (\d+) passed/.exec(line);
    const realHollow = /(\d+) real, \d+ hollow/.exec(line);
    const nothing = /PUBLISHES NOTHING -- (\d+) real pass/.exec(line);
    if (files) rows.set(name, { real: Number(files[1]) });
    else if (realHollow) rows.set(name, { real: Number(realHollow[1]) });
    else if (nothing) rows.set(name, { real: Number(nothing[1]), publishesNothing: true });
    else if (/WILL NOT LOAD/.test(line)) rows.set(name, { unmeasured: line.replace(/^\S+\s+/, "").trim() });
  }
  return rows;
}
