/** Both the port and the TypeScript revision determine parser evidence. */
export function checkerPin(version: string): string {
  const native = /^frontend tsrs \S+ \(([0-9a-f]{40})\)$/m.exec(version)?.[1];
  const typescript = /^TypeScript commit ([0-9a-f]{40})$/m.exec(version)?.[1];
  if (!native || !typescript) throw new Error("nts version did not report both native checker and TypeScript commits; parser evidence cannot be audited");
  const patches = [...version.matchAll(/^tsrs local patch ([a-z0-9-]+) ([0-9a-f]{64})$/gm)];
  if (version.split("\n").filter((line) => line.startsWith("tsrs local patch ")).length !== patches.length
    || new Set(patches.map((patch) => patch[1])).size !== patches.length) throw new Error("invalid carried checker patch identity");
  return `tsrs:${native}/typescript:${typescript}${patches.map((patch) => `/patch:${patch[1]}:${patch[2]}`).join("")}`;
}
