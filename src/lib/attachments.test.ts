import { describe, expect, it } from "vitest";
import { addAttachment, extractText, MAX_ATTACHMENT_CHARS } from "@/lib/attachments";

describe("browser attachments", () => {
  it("reads plain-text files and rejects unsupported types", async () => {
    const notes = new File(["Line one\r\n\r\n\r\n\r\nLine two"], "notes.md", { type: "text/markdown" });
    expect(await extractText(notes)).toBe("Line one\n\nLine two");
    await expect(extractText(new File(["x"], "photo.heic"))).rejects.toThrow("not a supported");
    await expect(extractText(new File(["   "], "empty.txt"))).rejects.toThrow("empty");
  });

  it("trims what exceeds the shared size budget and refuses once full", () => {
    const first = addAttachment([], "a.txt", "x".repeat(MAX_ATTACHMENT_CHARS - 10));
    const second = addAttachment(first, "b.txt", "y".repeat(50));
    expect(second[1]).toMatchObject({ name: "b.txt", truncated: true });
    expect(second[1].text).toHaveLength(10);
    expect(() => addAttachment(second, "c.txt", "z")).toThrow("already full");
  });
});
