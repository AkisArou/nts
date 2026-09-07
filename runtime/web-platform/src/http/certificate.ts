/**
 * dNSName matching for connection reuse.
 *
 * Reusing one HTTP/2 connection for a second origin is sound only when the peer's
 * certificate actually covers that origin. Matching on hostname alone, or trusting
 * that two names "look related", is a cross-origin routing defect rather than a
 * performance shortcut, so these rules are deliberately narrow.
 */

/** Lowercases and strips one trailing root label, which is the same name. */
function normalizeName(name: string): string {
  const lower = name.toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

/**
 * Whether one presented dNSName covers a host.
 *
 * A wildcard is accepted only as the complete leftmost label of a name with at least
 * three labels, and it matches exactly one label. `*.example.com` therefore covers
 * `a.example.com` but not `example.com` and not `a.b.example.com`, and `*.com` is
 * refused outright. Partial-label wildcards such as `f*.example.com` are not honoured:
 * they are permitted by some readings of RFC 6125 and rejected by mainstream TLS
 * stacks, and the safe reading is the one that reuses fewer connections.
 */
export function dnsNameCovers(presented: string, host: string): boolean {
  const name = normalizeName(presented);
  const target = normalizeName(host);
  if (name === "" || target === "") return false;
  if (!name.startsWith("*.")) return name === target;

  const suffix = name.slice(2);
  if (suffix === "") return false;
  // `*.com` would cover an entire registry; require a label beneath the wildcard.
  if (suffix.indexOf(".") < 0) return false;
  if (suffix.indexOf("*") >= 0) return false;
  if (!target.endsWith("." + suffix)) return false;
  const label = target.slice(0, target.length - suffix.length - 1);
  // Exactly one label, and never an empty one.
  return label !== "" && label.indexOf(".") < 0;
}

/** Whether any presented dNSName covers the host. */
export function certificateCovers(names: readonly string[], host: string): boolean {
  for (const name of names) if (dnsNameCovers(name, host)) return true;
  return false;
}
