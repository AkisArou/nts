// The shared test/build JVM policy; application launchers keep their own flags.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
export const VM_FLAGS = readFileSync(new URL("../../runtime/jvm/test-vm-flags.txt", import.meta.url), "utf8").trim().split(/\s+/);
export function vmToolFlags(program: string): string[] {
  const tool = basename(program).replace(/\.(exe|bat)$/, "");
  if (tool === "java") return [...VM_FLAGS];
  if (["javac", "javap", "jar", "jmod", "jdeps", "javadoc", "jlink", "keytool"].includes(tool)) return VM_FLAGS.map(flag => `-J${flag}`);
  // Android scripts prepend the JVM dash; JDK launchers forward it verbatim.
  if (["d8", "r8", "apksigner"].includes(tool)) return VM_FLAGS.map(flag => `-J${flag.replace(/^-/, "")}`);
  return [];
}
