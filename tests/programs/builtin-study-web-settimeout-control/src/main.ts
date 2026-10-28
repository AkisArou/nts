// Source control for builtin-study-web-settimeout. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
function sourceTimeout(callback: () => void, _delay: number): void { callback(); }

export async function webSettimeoutControl(): Promise<number> {
  return new Promise(resolve => sourceTimeout(() => resolve(1), 1));
}
