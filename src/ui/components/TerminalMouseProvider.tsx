import React from "react";
import { useStdin } from "ink";

const ANSI_MOUSE_ENABLE = "\u001B[?1000h\u001B[?1003h\u001B[?1015h\u001B[?1006h";
const ANSI_MOUSE_DISABLE = "\u001B[?1003l\u001B[?1006l\u001B[?1015l\u001B[?1000l";
const COMPLETE_SGR_MOUSE_SEQUENCE = /^\u001B\[<(\d+);(\d+);(\d+)([Mm])/;

export type TerminalMouseEvent =
  | { type: "scroll"; direction: "up" | "down"; x: number; y: number }
  | { type: "move"; x: number; y: number }
  | { type: "press" | "release" | "drag"; x: number; y: number };

interface TerminalMouseContextValue {
  subscribe: (listener: (event: TerminalMouseEvent) => void) => () => void;
}

interface InputSegment {
  type: "text" | "mouse";
  value: string;
  event?: TerminalMouseEvent;
}

const TerminalMouseContext = React.createContext<TerminalMouseContextValue | null>(null);

export function splitMouseInputSegments(value: string): InputSegment[] {
  return extractMouseInput(value).segments;
}

export function extractMouseInput(value: string, carry = ""): {
  segments: InputSegment[];
  pending: string;
} {
  const source = carry + value;
  if (source.length === 0) {
    return { segments: [], pending: "" };
  }

  const segments: InputSegment[] = [];
  let textBuffer = "";
  let index = 0;

  const flushText = () => {
    if (textBuffer.length === 0) {
      return;
    }

    segments.push({ type: "text", value: textBuffer });
    textBuffer = "";
  };

  while (index < source.length) {
    const remaining = source.slice(index);

    if (!remaining.startsWith("\u001B")) {
      textBuffer += source[index]!;
      index += 1;
      continue;
    }

    const completeMatch = remaining.match(COMPLETE_SGR_MOUSE_SEQUENCE);
    if (completeMatch) {
      flushText();

      const [raw, rawCode, rawX, rawY, rawSuffix] = completeMatch;
      const code = Number(rawCode);
      const x = Number(rawX);
      const y = Number(rawY);
      const suffix = rawSuffix ?? "M";
      const event = toTerminalMouseEvent(code, x, y, suffix);

      segments.push({ type: "mouse", value: raw, event });
      index += raw.length;
      continue;
    }

    if (isIncompleteMouseSequence(remaining)) {
      flushText();
      return { segments, pending: remaining };
    }

    textBuffer += remaining[0]!;
    index += 1;
  }

  flushText();
  return { segments, pending: "" };
}

function isIncompleteMouseSequence(value: string): boolean {
  if (value === "\u001B[<") {
    return true;
  }

  if (!value.startsWith("\u001B[<")) {
    return false;
  }

  return /^\u001B\[<\d*(?:;\d*){0,2}[Mm]?$/.test(value);
}

export function TerminalMouseProvider({ children }: { children: React.ReactNode }) {
  const { stdin } = useStdin();
  const listenersRef = React.useRef(new Set<(event: TerminalMouseEvent) => void>());

  React.useEffect(() => {
    const input = stdin as NodeJS.ReadStream & {
      read: (size?: number) => string | Buffer | null;
    };
    const stdout = process.stdout;
    const originalRead = input.read.bind(input);
    let pendingMouseInput = "";

    input.read = ((size?: number) => {
      let textOutput = "";
      let templateChunk: string | Buffer | null = null;

      while (true) {
        const chunk = originalRead(size);

        if (chunk === null) {
          if (textOutput.length > 0) {
            return Buffer.isBuffer(templateChunk) ? Buffer.from(textOutput, "utf8") : textOutput;
          }

          if (pendingMouseInput.length > 0) {
            const flushed = pendingMouseInput;
            pendingMouseInput = "";
            return Buffer.isBuffer(templateChunk) ? Buffer.from(flushed, "utf8") : flushed;
          }

          return null;
        }

        templateChunk ??= chunk;

        const raw = typeof chunk === "string"
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString("utf8")
            : String(chunk ?? "");

        const { segments, pending } = extractMouseInput(raw, pendingMouseInput);
        pendingMouseInput = pending;

        for (const segment of segments) {
          if (segment.type === "text") {
            textOutput += segment.value;
            continue;
          }

          if (!segment.event) {
            continue;
          }

          for (const listener of listenersRef.current) {
            listener(segment.event);
          }
        }

        if (textOutput.length > 0) {
          return Buffer.isBuffer(templateChunk) ? Buffer.from(textOutput, "utf8") : textOutput;
        }
      }
    }) as typeof input.read;

    stdout.write(ANSI_MOUSE_ENABLE);

    return () => {
      input.read = originalRead;
      stdout.write(ANSI_MOUSE_DISABLE);
    };
  }, [stdin]);

  const contextValue = React.useMemo<TerminalMouseContextValue>(() => ({
    subscribe(listener) {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
  }), []);

  return (
    <TerminalMouseContext.Provider value={contextValue}>
      {children}
    </TerminalMouseContext.Provider>
  );
}

export function useTerminalMouse() {
  const context = React.useContext(TerminalMouseContext);
  if (!context) {
    throw new Error("useTerminalMouse must be used inside TerminalMouseProvider");
  }
  return context;
}

function toTerminalMouseEvent(code: number, x: number, y: number, suffix: string): TerminalMouseEvent | undefined {
  if (code === 64) {
    return { type: "scroll", direction: "up", x, y };
  }

  if (code === 65) {
    return { type: "scroll", direction: "down", x, y };
  }

  if (code === 35) {
    return { type: "move", x, y };
  }

  if (code >= 32) {
    return { type: "drag", x, y };
  }

  return { type: suffix === "M" ? "press" : "release", x, y };
}