export const ID = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";

/** A valid request body, with `overrides` laid over it. */
export function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID,
    kind: "bug",
    message: "Search finds nothing\n\nTyping in the sidebar search shows no results.",
    email: "someone@example.com",
    images: [{ type: "image/png", data: "iVBORw0KGgo=" }],
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
