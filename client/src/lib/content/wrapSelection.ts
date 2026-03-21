/**
 * Pure function that wraps a textarea selection with markdown markers.
 * Shared between FormattingToolbar (click) and useMarkdownShortcuts (keyboard).
 *
 * Supports toggle: if the selection is already wrapped with the marker,
 * the markers are removed instead.
 */

export interface WrapResult {
  newValue: string;
  newCursorStart: number;
  newCursorEnd: number;
}

export function wrapSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  marker: string,
  blockLevel?: boolean,
): WrapResult {
  const before = value.slice(0, selectionStart);
  const selected = value.slice(selectionStart, selectionEnd);
  const after = value.slice(selectionEnd);
  const markerLen = marker.length;

  // Check if the selection is already wrapped (toggle off)
  const beforeMarker = value.slice(
    Math.max(0, selectionStart - markerLen),
    selectionStart,
  );
  const afterMarker = value.slice(
    selectionEnd,
    selectionEnd + markerLen,
  );

  if (selected.length > 0 && beforeMarker === marker && afterMarker === marker) {
    // Remove existing markers
    const unwrappedBefore = value.slice(0, selectionStart - markerLen);
    const unwrappedAfter = value.slice(selectionEnd + markerLen);
    const newValue = unwrappedBefore + selected + unwrappedAfter;
    return {
      newValue,
      newCursorStart: selectionStart - markerLen,
      newCursorEnd: selectionEnd - markerLen,
    };
  }

  // Also check if selection itself contains the markers (user selected including markers)
  if (
    selected.length > markerLen * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(markerLen, -markerLen);
    const newValue = before + inner + after;
    return {
      newValue,
      newCursorStart: selectionStart,
      newCursorEnd: selectionStart + inner.length,
    };
  }

  if (blockLevel) {
    // Code block: insert on new lines
    const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const suffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";

    if (selected.length > 0) {
      const wrapped = `${prefix}${marker}\n${selected}\n${marker}${suffix}`;
      const newValue = before + wrapped + after;
      const contentStart = before.length + prefix.length + marker.length + 1;
      return {
        newValue,
        newCursorStart: contentStart,
        newCursorEnd: contentStart + selected.length,
      };
    } else {
      // No selection: insert empty code block and place cursor inside
      const wrapped = `${prefix}${marker}\n\n${marker}${suffix}`;
      const newValue = before + wrapped + after;
      const cursorPos = before.length + prefix.length + marker.length + 1;
      return {
        newValue,
        newCursorStart: cursorPos,
        newCursorEnd: cursorPos,
      };
    }
  }

  // Inline wrapping
  if (selected.length > 0) {
    const newValue = before + marker + selected + marker + after;
    return {
      newValue,
      newCursorStart: selectionStart + markerLen,
      newCursorEnd: selectionEnd + markerLen,
    };
  } else {
    // No selection: insert markers and place cursor between them
    const newValue = before + marker + marker + after;
    const cursorPos = selectionStart + markerLen;
    return {
      newValue,
      newCursorStart: cursorPos,
      newCursorEnd: cursorPos,
    };
  }
}
