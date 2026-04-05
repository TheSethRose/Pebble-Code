import type { ContextAttachmentIndexEntry } from "./contextAttachmentIndex.js";

export interface ComposerFileTag {
  id: string;
  key: string;
  source: ContextAttachmentIndexEntry["source"];
  path: string;
  displayPath: string;
  start: number;
  end: number;
}

export interface ComposerState {
  text: string;
  cursor: number;
  tags: ComposerFileTag[];
}

export interface ComposerQuery {
  kind: "slash" | "file";
  query: string;
  start: number;
  end: number;
}

let nextTagId = 0;

export function createComposerState(text = ""): ComposerState {
  return {
    text,
    cursor: text.length,
    tags: [],
  };
}

export function cloneComposerState(state: ComposerState): ComposerState {
  return {
    text: state.text,
    cursor: state.cursor,
    tags: state.tags.map((tag) => ({ ...tag })),
  };
}

export function setComposerCursor(state: ComposerState, cursor: number): ComposerState {
  return {
    ...state,
    cursor: snapCursorToBoundary(cursor, state.tags),
  };
}

export function insertComposerText(state: ComposerState, value: string): ComposerState {
  if (!value) {
    return state;
  }

  const cursor = snapCursorToBoundary(state.cursor, state.tags, "end");
  const nextText = `${state.text.slice(0, cursor)}${value}${state.text.slice(cursor)}`;
  return {
    text: nextText,
    cursor: cursor + value.length,
    tags: shiftTags(state.tags, cursor, value.length),
  };
}

export function trimComposerTrailingSpaces(
  state: ComposerState,
  maxStrip: number,
): ComposerState {
  if (maxStrip <= 0 || state.text.length === 0) {
    return state;
  }

  let removable = 0;
  for (
    let index = state.text.length - 1;
    index >= 0 && state.text[index] === " " && removable < maxStrip;
    index -= 1
  ) {
    removable += 1;
  }

  if (removable === 0) {
    return state;
  }

  const nextText = state.text.slice(0, state.text.length - removable);
  return {
    text: nextText,
    cursor: Math.min(state.cursor, nextText.length),
    tags: state.tags
      .filter((tag) => tag.end <= nextText.length)
      .map((tag) => ({ ...tag })),
  };
}

export function moveComposerCursorLeft(state: ComposerState): ComposerState {
  if (state.cursor <= 0) {
    return state;
  }

  const cursor = snapCursorToBoundary(state.cursor, state.tags);
  const tag = state.tags.find((item) => item.end === cursor);
  if (tag) {
    return { ...state, cursor: tag.start };
  }

  return { ...state, cursor: cursor - 1 };
}

export function moveComposerCursorRight(state: ComposerState): ComposerState {
  if (state.cursor >= state.text.length) {
    return state;
  }

  const cursor = snapCursorToBoundary(state.cursor, state.tags);
  const tag = state.tags.find((item) => item.start === cursor);
  if (tag) {
    return { ...state, cursor: tag.end };
  }

  return { ...state, cursor: cursor + 1 };
}

export function deleteComposerBackward(state: ComposerState): ComposerState {
  if (state.cursor <= 0) {
    return state;
  }

  const cursor = snapCursorToBoundary(state.cursor, state.tags);
  const tag = state.tags.find((item) => item.end === cursor);
  if (tag) {
    return removeTag(state, tag.id, tag.start);
  }

  return removeTextRange(state, cursor - 1, cursor, cursor - 1);
}

export function deleteComposerForward(state: ComposerState): ComposerState {
  if (state.cursor >= state.text.length) {
    return state;
  }

  const cursor = snapCursorToBoundary(state.cursor, state.tags);
  const tag = state.tags.find((item) => item.start === cursor);
  if (tag) {
    return removeTag(state, tag.id, tag.start);
  }

  return removeTextRange(state, cursor, cursor + 1, cursor);
}

export function getActiveComposerQuery(state: ComposerState): ComposerQuery | null {
  const cursor = snapCursorToBoundary(state.cursor, state.tags);
  if (isCursorInsideTag(cursor, state.tags)) {
    return null;
  }

  let start = cursor;
  while (start > 0) {
    const previous = start - 1;
    if (isTextPositionInsideTag(previous, state.tags)) {
      break;
    }

    const value = state.text[previous];
    if (!value || /\s/u.test(value)) {
      break;
    }

    start -= 1;
  }

  const token = state.text.slice(start, cursor);
  if (!token) {
    return null;
  }

  if (token.startsWith("@") && (start === 0 || /\s/u.test(state.text[start - 1] ?? ""))) {
    return {
      kind: "file",
      query: token.slice(1),
      start,
      end: cursor,
    };
  }

  if (token.startsWith("/") && start === 0 && !token.includes(" ")) {
    return {
      kind: "slash",
      query: token.slice(1),
      start,
      end: cursor,
    };
  }

  return null;
}

export function insertComposerFileTag(
  state: ComposerState,
  entry: ContextAttachmentIndexEntry,
): ComposerState {
  const query = getActiveComposerQuery(state);
  const start = query?.kind === "file" ? query.start : snapCursorToBoundary(state.cursor, state.tags, "end");
  const end = query?.kind === "file" ? query.end : start;
  const tagText = `@${entry.displayPath}`;
  const suffix = needsTrailingSpace(state.text, end) ? " " : "";

  const stripped = removeTextRange(state, start, end, start);
  const nextText = `${stripped.text.slice(0, start)}${tagText}${suffix}${stripped.text.slice(start)}`;
  const shiftedTags = shiftTags(stripped.tags, start, tagText.length + suffix.length);
  const tag: ComposerFileTag = {
    id: `tag-${nextTagId += 1}`,
    key: entry.key,
    source: entry.source,
    path: entry.path,
    displayPath: entry.displayPath,
    start,
    end: start + tagText.length,
  };

  return {
    text: nextText,
    cursor: tag.end + suffix.length,
    tags: [...shiftedTags, tag].sort((left, right) => left.start - right.start),
  };
}

export function replaceComposerRange(
  state: ComposerState,
  start: number,
  end: number,
  value: string,
): ComposerState {
  const stripped = removeTextRange(state, start, end, start);
  const nextText = `${stripped.text.slice(0, start)}${value}${stripped.text.slice(start)}`;
  return {
    text: nextText,
    cursor: start + value.length,
    tags: shiftTags(stripped.tags, start, value.length),
  };
}

function removeTag(state: ComposerState, id: string, cursor: number): ComposerState {
  const tag = state.tags.find((item) => item.id === id);
  if (!tag) {
    return state;
  }

  const nextText = `${state.text.slice(0, tag.start)}${state.text.slice(tag.end)}`;
  const delta = tag.start - tag.end;
  return {
    text: nextText,
    cursor,
    tags: state.tags
      .filter((item) => item.id !== id)
      .map((item) => item.start >= tag.end
        ? { ...item, start: item.start + delta, end: item.end + delta }
        : { ...item }),
  };
}

function removeTextRange(
  state: ComposerState,
  start: number,
  end: number,
  cursor: number,
): ComposerState {
  if (start >= end) {
    return {
      ...state,
      cursor: snapCursorToBoundary(cursor, state.tags),
    };
  }

  const clampedStart = Math.max(0, start);
  const clampedEnd = Math.min(state.text.length, end);
  const nextText = `${state.text.slice(0, clampedStart)}${state.text.slice(clampedEnd)}`;
  const delta = clampedStart - clampedEnd;
  const nextTags = state.tags
    .filter((tag) => tag.end <= clampedStart || tag.start >= clampedEnd)
    .map((tag) => tag.start >= clampedEnd
      ? { ...tag, start: tag.start + delta, end: tag.end + delta }
      : { ...tag });

  return {
    text: nextText,
    cursor: snapCursorToBoundary(Math.max(0, cursor), nextTags),
    tags: nextTags,
  };
}

function shiftTags(tags: ComposerFileTag[], from: number, delta: number): ComposerFileTag[] {
  return tags.map((tag) => tag.start >= from
    ? { ...tag, start: tag.start + delta, end: tag.end + delta }
    : { ...tag });
}

function needsTrailingSpace(text: string, index: number): boolean {
  const next = text[index] ?? "";
  return next.length === 0 || !/\s/u.test(next);
}

function snapCursorToBoundary(
  cursor: number,
  tags: ComposerFileTag[],
  bias: "nearest" | "start" | "end" = "nearest",
): number {
  const clamped = Math.max(0, cursor);
  const tag = tags.find((item) => item.start < clamped && clamped < item.end);
  if (!tag) {
    return clamped;
  }

  if (bias === "start") {
    return tag.start;
  }

  if (bias === "end") {
    return tag.end;
  }

  return clamped - tag.start <= tag.end - clamped ? tag.start : tag.end;
}

function isCursorInsideTag(cursor: number, tags: ComposerFileTag[]): boolean {
  return tags.some((tag) => tag.start < cursor && cursor < tag.end);
}

function isTextPositionInsideTag(index: number, tags: ComposerFileTag[]): boolean {
  return tags.some((tag) => tag.start <= index && index < tag.end);
}
