// src/types/shims.d.ts

// Let TS accept `import { createHash } from "node:crypto"`
declare module "node:crypto" {
  export * from "crypto";
}

// Minimal process/env typing so TS is happy even if Node types aren't loaded
declare var process: {
  env: Record<string, string | undefined>;
};
