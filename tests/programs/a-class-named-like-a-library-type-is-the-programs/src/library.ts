// The library's own `Set`, in a module that does not shadow it.
export function librarySize(count: number): number {
  const library = new Set<number>();
  for (let i = 0; i < count; i++) {
    library.add(i % 4);
  }
  return library.size;
}
