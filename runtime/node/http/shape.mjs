export function shape(exports) {
  const http = { ...exports };
  delete http.default;
  return http;
}
