import { describe, expect, test } from "bun:test";
import { getEyeLine } from "../src/ui/components/PebbleMascot";
import { getPebbleMood } from "../src/ui/mascotMood";
import type { AppState, DisplayMessage } from "../src/ui/types";

function createState(overrides: Partial<AppState> = {}): AppState {
  return {
    messages: [],
    isProcessing: false,
    statusText: "",
    error: null,
    activeSessionId: null,
    ...overrides,
  };
}

function createMessage(role: DisplayMessage["role"], content = "test"): DisplayMessage {
  return { role, content };
}

describe("getPebbleMood", () => {
  test("uses sleepy when the transcript is empty", () => {
    expect(getPebbleMood(createState())).toBe("sleepy");
  });

  test("uses shocked while processing", () => {
    expect(getPebbleMood(createState({ isProcessing: true }))).toBe("shocked");
  });

  test("uses sad when an error is present", () => {
    expect(getPebbleMood(createState({ error: "Nope." }))).toBe("sad");
  });

  test("uses happy after a successful assistant reply", () => {
    expect(
      getPebbleMood(createState({
        messages: [createMessage("user"), createMessage("assistant")],
      })),
    ).toBe("happy");
  });

  test("uses neutral when the conversation has started but no reply has landed yet", () => {
    expect(
      getPebbleMood(createState({
        messages: [createMessage("user")],
      })),
    ).toBe("neutral");
  });
});

describe("Pebble mascot eyes", () => {
  test("returns mood-specific eyes when not blinking", () => {
    expect(getEyeLine("neutral", false)).toBe(" ▐ .. ▌");
    expect(getEyeLine("happy", false)).toBe(" ▐ ^^ ▌");
    expect(getEyeLine("sad", false)).toBe(" ▐ .. ▌");
    expect(getEyeLine("shocked", false)).toBe(" ▐ oo ▌");
    expect(getEyeLine("sleepy", false)).toBe(" ▐ -- ▌");
  });

  test("returns blink line for non-sleepy moods", () => {
    expect(getEyeLine("neutral", true)).toBe(" ▐ -- ▌");
    expect(getEyeLine("happy", true)).toBe(" ▐ -- ▌");
    expect(getEyeLine("shocked", true)).toBe(" ▐ -- ▌");
  });

  test("sleepy eyes unchanged during blink", () => {
    expect(getEyeLine("sleepy", true)).toBe(" ▐ -- ▌");
    expect(getEyeLine("sleepy", false)).toBe(" ▐ -- ▌");
  });
});