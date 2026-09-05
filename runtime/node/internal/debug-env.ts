// The process-wide `NODE_DEBUG` selector, from node v24.20.0
// `lib/internal/util/debuglog.js`.

declare function nts_process_env(name: string): string;

const selectors = nts_process_env("NODE_DEBUG").toUpperCase().split(",");

/** Match one anchored selector, where `*` is the only metacharacter. */
function selectorMatches(selector: string, section: string): boolean {
  let selectorIndex = 0;
  let sectionIndex = 0;
  let starIndex = -1;
  let retrySectionIndex = -1;

  while (sectionIndex < section.length) {
    if (
      selectorIndex < selector.length &&
      selector.charCodeAt(selectorIndex) === section.charCodeAt(sectionIndex)
    ) {
      selectorIndex++;
      sectionIndex++;
      continue;
    }
    if (selectorIndex < selector.length && selector.charCodeAt(selectorIndex) === 42) {
      starIndex = selectorIndex;
      selectorIndex++;
      retrySectionIndex = sectionIndex;
      continue;
    }
    if (starIndex === -1) return false;
    selectorIndex = starIndex + 1;
    retrySectionIndex++;
    sectionIndex = retrySectionIndex;
  }

  while (selectorIndex < selector.length && selector.charCodeAt(selectorIndex) === 42) {
    selectorIndex++;
  }
  return selectorIndex === selector.length;
}

/** Whether the initial `NODE_DEBUG` value enables an exact debug section. */
export function debugSectionEnabled(section: string): boolean {
  const upperSection = section.toUpperCase();
  for (const selector of selectors) {
    if (selectorMatches(selector, upperSection)) return true;
  }
  return false;
}
