import { PlayerGender } from "#enums/player-gender";
import {
  getPlayerTrainerSpriteOption,
  PLAYER_BOY_TRAINER_SPRITES,
  PLAYER_GIRL_TRAINER_SPRITES,
  PLAYER_TRAINER_SPRITE_OPTIONS,
} from "#enums/player-trainer-sprite";
import { normalizePlayerDisplayName } from "#utils/player-display-name";

export interface PlayerCardIdentity {
  name: string;
  characterId: string;
}

export type RunPlayerAppearances = Partial<Record<0 | 1 | 2 | "ep", string>>;

// Atlas keys are stable identifiers; the selector's display order is not save data.
export function getPlayerCharacter(characterId: unknown) {
  return PLAYER_TRAINER_SPRITE_OPTIONS.find(option => option.atlasKey === characterId);
}

export const LEGACY_PLAYER_APPEARANCE_SETTINGS = new Set([
  "PLAYER_GENDER",
  "PLAYER_BOY_TRAINER_SPRITE",
  "PLAYER_GIRL_TRAINER_SPRITE",
  "GUEST_GENDER",
  "GUEST_BOY_TRAINER_SPRITE",
  "GUEST_GIRL_TRAINER_SPRITE",
  "GUEST_2_GENDER",
  "GUEST_2_BOY_TRAINER_SPRITE",
  "GUEST_2_GIRL_TRAINER_SPRITE",
]);

export function readLegacyAppearanceSettings(): Record<string, unknown> {
  try {
    const value = JSON.parse(localStorage.getItem("settings") ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function getLegacyPlayerCharacterId(
  settings: Record<string, unknown>,
  seat: 0 | 1 | 2,
  fallbackGender = seat === 1 ? PlayerGender.FEMALE : PlayerGender.MALE,
): string {
  const prefix = ["PLAYER", "GUEST", "GUEST_2"][seat];
  const savedGender = settings[`${prefix}_GENDER`];
  const female = savedGender === 1 || (savedGender !== 0 && fallbackGender === PlayerGender.FEMALE);
  const sprites = female ? PLAYER_GIRL_TRAINER_SPRITES : PLAYER_BOY_TRAINER_SPRITES;
  const cursor = settings[`${prefix}_${female ? "GIRL" : "BOY"}_TRAINER_SPRITE`];
  const sprite = typeof cursor === "number" && Number.isInteger(cursor) ? sprites[cursor] : undefined;
  return getPlayerTrainerSpriteOption(sprite ?? sprites[0]).atlasKey;
}

export function validateRunPlayerAppearances(value: RunPlayerAppearances): RunPlayerAppearances {
  const result: RunPlayerAppearances = {};
  for (const seat of [0, 1, 2, "ep"] as const) {
    const id = value[seat];
    if (id === undefined) {
      continue;
    }
    if (!getPlayerCharacter(id)) {
      throw new Error(`Unknown Player Card character '${id}'. All players need the same game build.`);
    }
    result[seat] = id;
  }
  return result;
}

/** LAN navigation may change origin. Carry cosmetics only, never progression or authentication. */
export function withPlayerCardForLobby(target: string, origin: string, identity: PlayerCardIdentity): string {
  const url = new URL(target);
  const fragment = new URLSearchParams(url.hash.slice(1));
  fragment.delete("playerCard");
  if (url.origin !== origin) {
    fragment.set(
      "playerCard",
      JSON.stringify({
        name: normalizePlayerDisplayName(identity.name),
        characterId: identity.characterId,
      }),
    );
  }
  url.hash = fragment.toString();
  return url.toString();
}

/** Consume the handoff once, before publishing the local profile to the lobby. */
export function consumePlayerCardHandoff(): PlayerCardIdentity | undefined {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const encoded = fragment.get("playerCard");
  if (encoded === null) {
    return;
  }
  fragment.delete("playerCard");
  url.hash = fragment.toString();
  window.history.replaceState(window.history.state, "", url.toString());
  if (url.searchParams.get("twoPlayer") !== "1" || encoded.length > 512) {
    return;
  }
  try {
    const value: unknown = JSON.parse(encoded);
    if (!value || typeof value !== "object" || !("characterId" in value) || !getPlayerCharacter(value.characterId)) {
      return;
    }
    return {
      characterId: value.characterId as string,
      name: normalizePlayerDisplayName("name" in value ? value.name : undefined),
    };
  } catch {
    return;
  }
}
