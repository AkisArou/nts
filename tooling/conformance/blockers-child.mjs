// Compiler execution evidence and the exact emit-jvm completion grammar.
// Pure functions: no compiler, Java, filesystem, or process-global mutation.

export function recordChild(command, args, result) {
  const error = result.error == null ? null : {
    name: result.error.name ?? "Error",
    message: result.error.message ?? String(result.error),
    code: result.error.code ?? null,
  };
  return {
    command,
    args: [...args],
    pid: result.pid ?? null,
    status: result.status ?? null,
    signal: result.signal ?? null,
    error,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function childSucceeded(child) {
  return child.status === 0 && child.signal === null && child.error === null;
}

// emit-jvm prints this ONLY after writing its class files and runtime JAR.
// An emitter can exit0 while declining bodies/classes: empty diagnostics and
// the entire positive completion line are also required. This proves neither
// Java verification nor execution/Node agreement, and never clears a fixture.
export function completedJvmClasses(child, directory) {
  if (!childSucceeded(child) || typeof child.stdout !== "string" ||
      typeof child.stderr !== "string" || child.stderr !== "") return null;
  const completion = /^wrote ([1-9][0-9]*) class\(es\) and the runtime to ([^\r\n]+)\r?\n$/.exec(child.stdout);
  if (completion === null || completion[2] !== directory) return null;
  const count = Number(completion[1]);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}
