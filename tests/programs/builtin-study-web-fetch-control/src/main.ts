function providedFetch(_url: string): Promise<{ status: number }> {
  return Promise.resolve({ status: 200 });
}
// Return the callback's actual observation instead of discarding it in console output.
export async function fetchControl(): Promise<number> {
  const response = await providedFetch("http://127.0.0.1:9/");
  return response.status;
}
