import React from "react";
import { Box } from "ink";
import type { DOMElement } from "ink";
import { useTerminalMouse } from "./TerminalMouseProvider.js";

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
  const mouse = useTerminalMouse();

  React.useEffect(() => {
    if (!active) {
      return;
    }

    return mouse.subscribe((event) => {
      if (event.type !== "scroll") {
        return;
      }

      const position = getElementPosition(ref.current);
      const dimensions = getElementDimensions(ref.current);
      if (!position || !dimensions) {
        return;
      }

      const isInside = isPointWithinRect(event, {
        left: position.left,
        top: position.top,
        width: dimensions.width,
        height: dimensions.height,
      });

      if (!isInside) {
        return;
      }

      if (event.direction === "up") {
        onWheelUp();
        return;
      }

      onWheelDown();
    });
  }, [
    active,
    mouse,
    onWheelDown,
    onWheelUp,
  ]);

  return (
    <Box ref={ref} flexDirection="column">
      {children}
    </Box>
  );
}

function getElementDimensions(element: DOMElement | null): { width: number; height: number } | null {
  if (!element?.yogaNode) {
    return null;
  }

  const layout = element.yogaNode.getComputedLayout();
  return { width: layout.width, height: layout.height };
}

function getElementPosition(element: DOMElement | null): { left: number; top: number } | null {
  if (!element?.yogaNode) {
    return null;
  }

  const layout = element.yogaNode.getComputedLayout();
  const parentOffset = getParentOffset(element);
  return {
    left: layout.left + parentOffset.x,
    top: layout.top + parentOffset.y,
  };
}

function getParentOffset(element: DOMElement): { x: number; y: number } {
  let current = element.parentNode;
  let x = 0;
  let y = 0;

  while (current) {
    if (!current.yogaNode) {
      return { x, y };
    }

    const layout = current.yogaNode.getComputedLayout();
    x += layout.left;
    y += layout.top;
    current = current.parentNode;
  }

  return { x, y };
}