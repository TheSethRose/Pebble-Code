const ANSI_ESCAPE_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/gu;

export const LONG_PASTE_CHARACTER_THRESHOLD = 160;

export interface PastedTextContent {
  id: number;
  type: "text";
  content: string;
}

export interface ParsedPasteReference {
  id: number;
  match: string;
  index: number;
}

export function normalizePastedText(rawText: string): string {
  return rawText
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "    ");
}

export function getPastedTextRefNumLines(text: string): number {
  return (text.match(/\n/g) ?? []).length;
}

export function formatPastedTextRef(id: number, numLines: number): string {
  if (numLines === 0) {
    return `[Pasted text #${id}]`;
  }

  return `[Pasted text #${id} +${numLines} lines]`;
}

export function parsePastedTextReferences(input: string): ParsedPasteReference[] {
  const referencePattern = /\[Pasted text #(\d+)(?: \+\d+ lines)?\]/g;
  const matches = [...input.matchAll(referencePattern)];

  return matches
    .map((match) => ({
      id: Number.parseInt(match[1] ?? "0", 10),
      match: match[0],
      index: match.index ?? -1,
    }))
    .filter((match) => Number.isFinite(match.id) && match.id > 0 && match.index >= 0);
}

export function expandPastedTextReferences(
  input: string,
  pastedContents: Record<number, PastedTextContent>,
): string {
  const references = parsePastedTextReferences(input);
  let expanded = input;

  for (let index = references.length - 1; index >= 0; index -= 1) {
    const reference = references[index];
    if (!reference) {
      continue;
    }

    const pastedContent = pastedContents[reference.id];
    if (!pastedContent || pastedContent.type !== "text") {
      continue;
    }

    expanded = `${expanded.slice(0, reference.index)}${pastedContent.content}${expanded.slice(reference.index + reference.match.length)}`;
  }

  return expanded;
}

export function shouldStagePastedText(text: string): boolean {
  return getPastedTextRefNumLines(text) > 0 || text.length >= LONG_PASTE_CHARACTER_THRESHOLD;
}
