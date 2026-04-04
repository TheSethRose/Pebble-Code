import { describe, expect, test } from "bun:test";
import {
  PEBBLE_ASCII_LOGO_LINES,
  truncateMiddle,
} from "../src/ui/components/WelcomeHeader";

describe("WelcomeHeader helpers", () => {
  test("keeps the Pebble ASCII logo stable", () => {
    expect(PEBBLE_ASCII_LOGO_LINES).toHaveLength(6);
    expect(PEBBLE_ASCII_LOGO_LINES[0]).toBe("██████╗ ███████╗██████╗ ██████╗ ██╗     ███████╗");
    expect(PEBBLE_ASCII_LOGO_LINES[5]).toBe("╚═╝     ╚══════╝╚═════╝ ╚═════╝ ╚══════╝╚══════╝");
  });

  test("truncates long paths through the middle", () => {
    expect(truncateMiddle("/tmp/example-project", 18)).toBe("/tmp/exam…-project");
  });

  test("leaves short strings unchanged", () => {
    expect(truncateMiddle("/tmp/project", 40)).toBe("/tmp/project");
  });
});
