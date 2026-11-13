import { afterEach, describe, expect, it, vi } from "vitest";

// Server failure logging: name and message only, secrets redacted, bounded length.
// Synthetic values only; no credentials are used.
vi.mock("server-only", () => ({}));

const { describeError, logServerFailure } = await import("../../src/server/logging");

afterEach(() => vi.restoreAllMocks());

describe("describeError", () => {
  it("returns the error name and message", () => {
    expect(describeError(new TypeError("Missing or invalid environment variable: APP_ENV")))
      .toBe("TypeError: Missing or invalid environment variable: APP_ENV");
  });

  it("redacts a connection-string password in the message", () => {
    const described = describeError(
      new Error("connect failed for postgresql://app_runtime:synthetic-p4ss@db.example:6543/postgres"),
    );

    expect(described).not.toContain("synthetic-p4ss");
    expect(described).toContain("[REDACTED:");
  });

  it("redacts a bearer token in the message", () => {
    const described = describeError(new Error("upstream rejected Authorization: Bearer synthetictoken1234567890abcdef"));

    expect(described).not.toContain("synthetictoken1234567890abcdef");
  });

  it("truncates a long message", () => {
    const described = describeError(new Error("x".repeat(5000)));

    expect(described.length).toBeLessThan(400);
    expect(described.endsWith("…")).toBe(true);
  });

  it("does not stringify a thrown non-error value", () => {
    expect(describeError({ secret: "synthetic-secret" })).toBe("Non-error value thrown");
    expect(describeError("synthetic-secret")).toBe("Non-error value thrown");
  });
});

describe("logServerFailure", () => {
  it("writes one line naming the operation and never the stack", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("Synthetic failure");

    logServerFailure("GitHub sign-in start", error);

    expect(consoleError).toHaveBeenCalledOnce();
    const [line, ...rest] = consoleError.mock.calls[0];
    expect(rest).toEqual([]);
    expect(line).toBe("[server] GitHub sign-in start failed: Error: Synthetic failure");
    expect(line).not.toContain(error.stack?.split("\n")[1] ?? "unreachable");
  });
});
