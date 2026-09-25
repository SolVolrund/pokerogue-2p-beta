export const PLAYER_DISPLAY_NAME_MAX_LENGTH = 20;

/** Keep names on one line and prevent them from being interpreted as dialogue/BBCode commands. */
export function normalizePlayerDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return Array.from(
    value
      .normalize("NFC")
      .replace(/[^\p{L}\p{M}\p{N} ._'’-]/gu, "")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, PLAYER_DISPLAY_NAME_MAX_LENGTH)
    .join("")
    .trim();
}

export function getPlayerDisplayName(value: unknown, playerIndex = 0): string {
  return normalizePlayerDisplayName(value) || `Player ${playerIndex + 1}`;
}
