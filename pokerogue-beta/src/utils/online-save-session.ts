import type { SessionSaveData } from "#types/save-data";
import type { OnlineMembership } from "#utils/online-lobby-client";

export interface OnlineSaveControl {
  type: string;
  loadId?: string;
  snapshot?: string;
  snapshotHash?: string;
  stateHash?: string;
  startId?: string;
  seed?: string;
  message?: string;
}

/** Per-tab bridge between title UI and its authenticated game socket. */
export const onlineSaveSession = {
  localMenu: false,
  loading: false,
  send: undefined as ((message: OnlineSaveControl) => boolean) | undefined,
  receive: undefined as ((message: OnlineSaveControl) => void) | undefined,
};

export function validateOnlineSessionSave(save: SessionSaveData, member: OnlineMembership): void {
  const { setup, partySize } = member.lobby;
  const count = save.multiplayerPlayerCount ?? (save.players?.[2]?.party?.length ? 3 : 2);
  if (
    (!save.twoPlayerMode && !save.players?.length && !save.twoPlayerEnemyPlayerMode)
    || count !== setup.playerCount
    || !!save.twoPlayerEnemyPlayerMode !== setup.enemyPlayer
    || (save.twoPlayerPartySize ?? 6) !== partySize
    || (save.twoPlayerVsMode && (setup.enemyPlayer || count < 2))
    || save.twoPlayerComputerPartner
    || save.computerPartnerKey
    || save.computerPartnerPlayerIndexes?.length
    || Object.values(save.computerPartnerKeys ?? {}).some(Boolean)
    || save.players?.slice(1).some(player => player.party?.some(pokemon => pokemon.computerPartnerAce))
  ) {
    throw new Error(
      "This save does not match the lobby's player count, EP mode, or team size. Create a matching lobby first.",
    );
  }
  if (
    !save.seed
    || !Number.isInteger(save.waveIndex)
    || save.waveIndex < 1
    || !save.arena
    || !Array.isArray(save.enemyParty)
    || !Array.isArray(save.players)
    || save.players.slice(0, count).length !== count
    || save.players.slice(0, count).some(player => !Array.isArray(player.party) || player.party.length === 0)
  ) {
    throw new Error("This save is missing multiplayer run data and cannot be resumed Online.");
  }
}

export async function hashOnlineSave(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Compare restored gameplay state, excluding local menus, input prompts, and save-slot numbers. */
export function onlineLoadedState(summary: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      [
        "seed",
        "waveSeed",
        "waveIndex",
        "battleType",
        "double",
        "biome",
        "twoPlayerEnemyPlayerMode",
        "twoPlayerVsMode",
        "vsEnemyModifiersByPlayer",
        "vsEnemyTokenPurchaseStateByPlayer",
        "fieldOwners",
        "players",
        "enemies",
        "enemyModifiers",
      ].map(key => [key, summary[key]]),
    ),
  );
}
