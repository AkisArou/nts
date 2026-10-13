// Collections under load: string-keyed counting in a Map, a Set of numbers,
// and reads from a string-keyed record. Against node running the same
// TypeScript.
const words: string[] = [];
for (let i = 0; i < 1000; i++) words.push("w" + ((i * 7919) % 1000));
const record: Record<string, number> = {};
for (let i = 0; i < 64; i++) record["k" + i] = i;
const recordKeys: string[] = [];
for (let i = 0; i < 64; i++) recordKeys.push("k" + ((i * 37) % 64));

export function countWords(n: number): number {
  const counts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const word = words[i % 1000];
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts.size + (counts.get("w7") ?? 0);
}

export function numbersSeen(n: number): number {
  const seen = new Set<number>();
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const v = (i * 2654435761) % 4096;
    if (seen.has(v)) hits++;
    else seen.add(v);
  }
  return hits + seen.size;
}

export function recordReads(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += record[recordKeys[i & 63]] ?? 0;
  return total;
}
