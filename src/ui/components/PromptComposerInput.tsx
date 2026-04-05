import React from "react";
import { Text, useInput } from "ink";
import chalk from "chalk";
import {
  expandPastedTextReferences,
  formatPastedTextRef,
  getPastedTextRefNumLines,
  normalizePastedText,
  parsePastedTextReferences,
  type PastedTextContent,
  shouldStagePastedText,
} from "./inputPaste.js";

const CURSOR = chalk.inverse(" ");
const PASTE_COMPLETION_TIMEOUT_MS = 60;

interface PromptComposerInputProps {
  isDisabled?: boolean;
  defaultValue?: string;
  placeholder?: string;
  suggestions?: string[];
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onPasteStateChange?: (count: number) => void;
}

interface InputState {
  previousValue: string;
  value: string;
  cursorOffset: number;
}

type InputAction =
  | { type: "move-cursor-left" }
  | { type: "move-cursor-right" }
  | { type: "insert"; text: string }
  | { type: "delete" };

function reducer(state: InputState, action: InputAction): InputState {
  switch (action.type) {
    case "move-cursor-left": {
      return {
        ...state,
        cursorOffset: Math.max(0, state.cursorOffset - 1),
      };
    }
    case "move-cursor-right": {
      return {
        ...state,
        cursorOffset: Math.min(state.value.length, state.cursorOffset + 1),
      };
    }
    case "insert": {
      return {
        ...state,
        previousValue: state.value,
        value: `${state.value.slice(0, state.cursorOffset)}${action.text}${state.value.slice(state.cursorOffset)}`,
        cursorOffset: state.cursorOffset + action.text.length,
      };
    }
    case "delete": {
      const newCursorOffset = Math.max(0, state.cursorOffset - 1);
      return {
        ...state,
        previousValue: state.value,
        value: `${state.value.slice(0, newCursorOffset)}${state.value.slice(newCursorOffset + 1)}`,
        cursorOffset: newCursorOffset,
      };
    }
  }
}

export function PromptComposerInput({
  isDisabled = false,
  defaultValue = "",
  placeholder = "",
  suggestions,
  onChange,
  onSubmit,
  onPasteStateChange,
}: PromptComposerInputProps) {
  const [state, dispatch] = React.useReducer(reducer, {
    previousValue: defaultValue,
    value: defaultValue,
    cursorOffset: defaultValue.length,
  });
  const [pastedContents, setPastedContents] = React.useState<Record<number, PastedTextContent>>({});
  const nextPasteIdRef = React.useRef(1);
  const pendingPasteChunksRef = React.useRef<string[]>([]);
  const pasteTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const suggestion = React.useMemo(() => {
    if (state.value.length === 0) {
      return undefined;
    }

    return suggestions
      ?.find((candidate) => candidate.startsWith(state.value))
      ?.replace(state.value, "");
  }, [state.value, suggestions]);

  const stagedPasteCount = React.useMemo(() => {
    return new Set(
      parsePastedTextReferences(state.value)
        .map((reference) => reference.id)
        .filter((id) => Boolean(pastedContents[id])),
    ).size;
  }, [pastedContents, state.value]);

  const moveCursorLeft = React.useCallback(() => {
    dispatch({ type: "move-cursor-left" });
  }, []);

  const moveCursorRight = React.useCallback(() => {
    dispatch({ type: "move-cursor-right" });
  }, []);

  const insert = React.useCallback((text: string) => {
    dispatch({ type: "insert", text });
  }, []);

  const deleteCharacter = React.useCallback(() => {
    dispatch({ type: "delete" });
  }, []);

  const stagePaste = React.useCallback((rawText: string) => {
    const normalizedText = normalizePastedText(rawText);
    if (!normalizedText) {
      return;
    }

    if (!shouldStagePastedText(normalizedText)) {
      insert(normalizedText);
      return;
    }

    const pasteId = nextPasteIdRef.current;
    nextPasteIdRef.current += 1;
    const numLines = getPastedTextRefNumLines(normalizedText);

    setPastedContents((current) => ({
      ...current,
      [pasteId]: {
        id: pasteId,
        type: "text",
        content: normalizedText,
      },
    }));
    insert(formatPastedTextRef(pasteId, numLines));
  }, [insert]);

  const flushPendingPaste = React.useCallback(() => {
    const combinedText = pendingPasteChunksRef.current.join("");
    pendingPasteChunksRef.current = [];

    if (pasteTimeoutRef.current) {
      clearTimeout(pasteTimeoutRef.current);
      pasteTimeoutRef.current = null;
    }

    if (combinedText.length > 0) {
      stagePaste(combinedText);
    }
  }, [stagePaste]);

  const queuePaste = React.useCallback((input: string) => {
    pendingPasteChunksRef.current.push(input);

    if (pasteTimeoutRef.current) {
      clearTimeout(pasteTimeoutRef.current);
    }

    pasteTimeoutRef.current = setTimeout(() => {
      flushPendingPaste();
    }, PASTE_COMPLETION_TIMEOUT_MS);
  }, [flushPendingPaste]);

  const submit = React.useCallback(() => {
    const visibleValue = suggestion ? `${state.value}${suggestion}` : state.value;
    onSubmit?.(expandPastedTextReferences(visibleValue, pastedContents));
  }, [onSubmit, pastedContents, state.value, suggestion]);

  React.useEffect(() => {
    if (state.value !== state.previousValue) {
      onChange?.(state.value);
    }
  }, [onChange, state.previousValue, state.value]);

  React.useEffect(() => {
    onPasteStateChange?.(stagedPasteCount);
  }, [onPasteStateChange, stagedPasteCount]);

  React.useEffect(() => {
    return () => {
      if (pasteTimeoutRef.current) {
        clearTimeout(pasteTimeoutRef.current);
      }
      onPasteStateChange?.(0);
    };
  }, [onPasteStateChange]);

  const renderedPlaceholder = React.useMemo(() => {
    if (isDisabled) {
      return placeholder ? chalk.dim(placeholder) : "";
    }

    return placeholder.length > 0
      ? `${chalk.inverse(placeholder[0] ?? "")}${chalk.dim(placeholder.slice(1))}`
      : CURSOR;
  }, [isDisabled, placeholder]);

  const renderedValue = React.useMemo(() => {
    if (isDisabled) {
      return state.value;
    }

    let index = 0;
    let result = state.value.length > 0 ? "" : CURSOR;
    for (const char of state.value) {
      result += index === state.cursorOffset ? chalk.inverse(char) : char;
      index += 1;
    }

    if (suggestion) {
      if (state.cursorOffset === state.value.length) {
        result += `${chalk.inverse(suggestion[0] ?? "")}${chalk.dim(suggestion.slice(1))}`;
      } else {
        result += chalk.dim(suggestion);
      }
      return result;
    }

    if (state.value.length > 0 && state.cursorOffset === state.value.length) {
      result += CURSOR;
    }

    return result;
  }, [isDisabled, state.cursorOffset, state.value, suggestion]);

  useInput((input, key) => {
    if (
      key.upArrow
      || key.downArrow
      || (key.ctrl && input === "c")
      || key.tab
      || (key.shift && key.tab)
    ) {
      return;
    }

    if (pendingPasteChunksRef.current.length > 0 && (key.return || key.leftArrow || key.rightArrow || key.backspace || key.delete)) {
      flushPendingPaste();
      return;
    }

    if (key.return) {
      submit();
      return;
    }

    if (key.leftArrow) {
      moveCursorLeft();
      return;
    }

    if (key.rightArrow) {
      moveCursorRight();
      return;
    }

    if (key.backspace || key.delete) {
      deleteCharacter();
      return;
    }

    const looksLikePaste = !key.ctrl
      && !key.meta
      && !key.escape
      && (pendingPasteChunksRef.current.length > 0 || input.includes("\n") || input.includes("\r") || input.length > 1);

    if (looksLikePaste) {
      queuePaste(input);
      return;
    }

    insert(input);
  }, { isActive: !isDisabled });

  return <Text>{state.value.length > 0 ? renderedValue : renderedPlaceholder}</Text>;
}
