import React from "react";
import { Box } from "ink";
import type { DOMElement } from "ink";
import {
  useElementDimensions,
  useElementPosition,
  useMouse,
} from "@zenobius/ink-mouse";

interface Point {
  x: number;
  y: number;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface MouseScrollableRegionProps {
  children: React.ReactNode;
  active?: boolean;
  onWheelUp: () => void;
  onWheelDown: () => void;
}

export function isPointWithinRect(point: Point, rect: Rect): boolean {
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  return point.x >= rect.left
    && point.x < rect.left + rect.width
    && point.y >= rect.top
    && point.y < rect.top + rect.height;
}

export function MouseScrollableRegion({
  children,
  active = true,
  onWheelUp,
  onWheelDown,
}: MouseScrollableRegionProps) {
  const ref = React.useRef<DOMElement>(null);
  const mouse = useMouse();
  const position = useElementPosition(ref, [children]);
  const dimensions = useElementDimensions(ref, [children]);

  React.useEffect(() => {
    if (!active) {
      return;
    }

    const handleScroll = (
      point: { x: number; y: number },
      direction: "scrollup" | "scrolldown" | null,
    ) => {
      if (!direction) {
        return;
      }

      const isInside = isPointWithinRect(point, {
        left: position.left,
        top: position.top,
        width: dimensions.width,
        height: dimensions.height,
      });

      if (!isInside) {
        return;
      }

      if (direction === "scrollup") {
        onWheelUp();
        return;
      }

      onWheelDown();
    };

    mouse.events.on("scroll", handleScroll);

    return () => {
      mouse.events.off("scroll", handleScroll);
    };
  }, [
    active,
    dimensions.height,
    dimensions.width,
    mouse.events,
    onWheelDown,
    onWheelUp,
    position.left,
    position.top,
  ]);

  return (
    <Box ref={ref} flexDirection="column">
      {children}
    </Box>
  );
}