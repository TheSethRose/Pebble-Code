import React, { useEffect, useState, useMemo } from "react";
import { Box, Text } from "ink";

export type PebbleMood = "neutral" | "happy" | "sad" | "shocked" | "sleepy";

const PEBBLE_TOP = "  ▁▁▁▁";

const PEBBLE_EYES: Record<PebbleMood, string> = {
  neutral: " ▐ .. ▌",
  happy: " ▐ ^^ ▌",
  sad: " ▐ .. ▌",
  shocked: " ▐ oo ▌",
  sleepy: " ▐ -- ▌",
};

const PEBBLE_MOUTHS: Record<PebbleMood, string> = {
  neutral: " ▐▁▄▄▁▌",
  happy: " ▐▁▃▃▁▌",
  sad: " ▐▁▁▁▁▌",
  shocked: " ▐▁▅▅▁▌",
  sleepy: " ▐▁▂▂▁▌",
};

const BLINK_EYES = " ▐ -- ▌";
const BLINK_INTERVAL_MS = 4000;
const BLINK_DURATION_MS = 150;

export function getEyeLine(mood: PebbleMood, isBlinking: boolean): string {
  if (isBlinking && mood !== "sleepy") return BLINK_EYES;
  return PEBBLE_EYES[mood];
}

interface PebbleMascotProps {
  mood: PebbleMood;
  color?: string;
}

export function PebbleMascot({ mood, color = "gray" }: PebbleMascotProps) {
  const [isBlinking, setIsBlinking] = useState(false);

  useEffect(() => {
    if (mood === "sleepy") return;

    const id = setInterval(() => {
      setIsBlinking(true);
      const tid = setTimeout(() => setIsBlinking(false), BLINK_DURATION_MS);
      return () => clearTimeout(tid);
    }, BLINK_INTERVAL_MS);

    return () => {
      clearInterval(id);
      setIsBlinking(false);
    };
  }, [mood]);

  const lines = useMemo(
    () => [PEBBLE_TOP, getEyeLine(mood, isBlinking), PEBBLE_MOUTHS[mood]],
    [mood, isBlinking],
  );

  return (
    <Box flexDirection="column" alignItems="flex-start">
      {lines.map((line, index) => (
        <Text key={`${mood}-${index}`} color={color}>
          {line}
        </Text>
      ))}
    </Box>
  );
}