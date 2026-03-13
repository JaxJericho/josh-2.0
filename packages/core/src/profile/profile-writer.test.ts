import { describe, expect, it } from "vitest";

import { didProfileJustReachMvpComplete } from "./profile-writer";

describe("didProfileJustReachMvpComplete", () => {
  it("returns true for a partial to complete_mvp transition", () => {
    expect(didProfileJustReachMvpComplete({
      previousProfileState: "partial",
      nextProfilePatch: {
        state: "complete_mvp",
        is_complete_mvp: true,
      },
    })).toBe(true);
  });

  it("returns false when the profile was already complete_mvp", () => {
    expect(didProfileJustReachMvpComplete({
      previousProfileState: "complete_mvp",
      nextProfilePatch: {
        state: "complete_mvp",
        is_complete_mvp: true,
      },
    })).toBe(false);
  });

  it("returns false when the profile remains partial", () => {
    expect(didProfileJustReachMvpComplete({
      previousProfileState: "partial",
      nextProfilePatch: {
        state: "partial",
        is_complete_mvp: false,
      },
    })).toBe(false);
  });

  it("returns false when the previous state was complete_full", () => {
    expect(didProfileJustReachMvpComplete({
      previousProfileState: "complete_full",
      nextProfilePatch: {
        state: "complete_mvp",
        is_complete_mvp: true,
      },
    })).toBe(false);
  });
});
