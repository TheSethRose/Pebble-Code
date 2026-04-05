import { describe, expect, test } from "bun:test";
import {
  buildContextAttachmentToken,
  collectReferencedContextAttachments,
  hasContextAttachmentToken,
  mergeContextAttachmentEntries,
} from "../src/ui/contextAttachmentSelection";

const todoEntry = {
  key: "workspace:TODO.md",
  source: "workspace" as const,
  path: "TODO.md",
  displayPath: "TODO.md",
  description: "workspace file",
};

const appEntry = {
  key: "workspace:src/ui/App.tsx",
  source: "workspace" as const,
  path: "src/ui/App.tsx",
  displayPath: "src/ui/App.tsx",
  description: "workspace file",
};

describe("context attachment selection helpers", () => {
  test("builds a visible @ token from an entry", () => {
    expect(buildContextAttachmentToken(todoEntry)).toBe("@TODO.md");
  });

  test("matches attachment tokens only on whitespace boundaries", () => {
    expect(hasContextAttachmentToken("Summarize @src/ui/App.tsx please", appEntry)).toBe(true);
    expect(hasContextAttachmentToken("Summarizeprefix@src/ui/App.tsx", appEntry)).toBe(false);
  });

  test("dedupes known entries and keeps only the referenced attachments", () => {
    const known = mergeContextAttachmentEntries([todoEntry], [todoEntry, appEntry]);

    expect(known).toHaveLength(2);
    expect(
      collectReferencedContextAttachments(
        "Compare @src/ui/App.tsx with @TODO.md",
        known,
      ).map((entry) => entry.key),
    ).toEqual([todoEntry.key, appEntry.key]);
  });
});