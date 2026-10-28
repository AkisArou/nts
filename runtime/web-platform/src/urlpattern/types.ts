export interface URLPatternInit {
  protocol?: string;
  username?: string;
  password?: string;
  hostname?: string;
  port?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  baseURL?: string;
}
export type URLPatternInput = string | URLPatternInit;
export interface URLPatternOptions { ignoreCase?: boolean; }
export interface URLPatternComponentResult {
  input: string;
  groups: Record<string, string | undefined>;
}
export interface URLPatternResult {
  inputs: URLPatternInput[];
  protocol: URLPatternComponentResult;
  username: URLPatternComponentResult;
  password: URLPatternComponentResult;
  hostname: URLPatternComponentResult;
  port: URLPatternComponentResult;
  pathname: URLPatternComponentResult;
  search: URLPatternComponentResult;
  hash: URLPatternComponentResult;
}
export type ComponentName = "protocol" | "username" | "password" | "hostname" |
  "port" | "pathname" | "search" | "hash";
export const componentNames: readonly ComponentName[] = [
  "protocol", "username", "password", "hostname", "port", "pathname", "search", "hash",
];
