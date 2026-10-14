// The generated factory.
import { AdwGroupNode } from "./adwchildren.ts";
import type { HostNode } from "./host.ts";

export function createNode(type: string): HostNode | null {
  switch (type) {
    case "Start":
    case "End":
    case "Other":
      return new AdwGroupNode(type);
  }
  return null;
}
