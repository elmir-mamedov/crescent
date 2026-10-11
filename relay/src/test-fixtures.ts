export const ID = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";

/** The smallest files the image checks accept: each type's signature and nothing else. */
export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

/** A valid report's text, with `overrides` laid over it. */
export function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID,
    kind: "bug",
    message: "Search finds nothing\n\nTyping in the sidebar search shows no results.",
    email: "someone@example.com",
    diagnostics: {
      version: "0.2.0",
      install: "installed",
      os: "macOS (Darwin 25.6.0, arm64)",
      node: "v24.1.0",
      browser: "Mozilla/5.0 Chrome/141",
      page: "/engineering/runbooks/deploy",
    },
    ...overrides,
  };
}

/** A file of `size` bytes that passes for `type`: its signature, then zeros. */
export function fakeImage(signature: Uint8Array, size: number): Uint8Array {
  const data = new Uint8Array(size);
  data.set(signature);
  return data;
}
