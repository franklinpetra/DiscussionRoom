import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";
import {
  conversationInputSchema,
  projectInputSchema,
  signUpSchema,
  workspaceNameSchema,
} from "@/lib/validation";

describe("account and notebook input validation", () => {
  it("requires a strong password at account creation", () => {
    const base = { displayName: "Ada", email: "ada@example.test" };
    expect(signUpSchema.safeParse({ ...base, password: "short" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, password: "long-enough-passphrase" }).success).toBe(true);
  });

  it("trims and bounds workspace names", () => {
    expect(workspaceNameSchema.parse("  Research room  ")).toBe("Research room");
    expect(workspaceNameSchema.safeParse("x").success).toBe(false);
  });

  it("requires UUID ownership references for projects and conversations", () => {
    expect(
      projectInputSchema.safeParse({
        workspaceId: "not-a-uuid",
        name: "Project One",
      }).success,
    ).toBe(false);
    expect(
      conversationInputSchema.safeParse({
        workspaceId: "10000000-0000-4000-8000-000000000001",
        projectId: "20000000-0000-4000-8000-000000000002",
        title: "A useful discussion",
      }).success,
    ).toBe(true);
  });
});

describe("auth callback redirect validation", () => {
  it("allows local application paths", () => {
    expect(safeNextPath("/app/workspaces")).toBe("/app/workspaces");
  });

  it.each([
    null,
    "",
    "https://attacker.example",
    "//attacker.example",
    "/\\attacker.example",
  ])("falls back to the app for unsafe destination %s", (destination) => {
    expect(safeNextPath(destination)).toBe("/app");
  });
});
