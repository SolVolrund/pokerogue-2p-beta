import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { updateWindowType } from "#ui/ui-theme";

export interface MysteryEncounterPlayerMenuConfig {
  playerIndex: PlayerIndex;
  overrideOptions?: MysteryEncounterOption[];
  overrideQuery?: string;
  startingCursorIndex?: number;
  slideInDescription?: boolean;
}

export function getMysteryEncounterPlayerIndexes(): PlayerIndex[] {
  return globalScene.twoPlayerMode ? globalScene.getActivePlayerIndexes() : [globalScene.activePlayerIndex];
}

export function getMysteryEncounterRequirementParty(): PlayerPokemon[] {
  if (!globalScene.twoPlayerMode) {
    return globalScene.getPlayerParty();
  }

  return getMysteryEncounterPlayerIndexes().flatMap(playerIndex => globalScene.getPlayerParty(playerIndex));
}

export function getMysteryEncounterPlayerTitle(playerIndex: PlayerIndex): string {
  return `Player ${playerIndex + 1}`;
}

export function getNextMysteryEncounterPlayerIndex(
  currentPlayerIndex: PlayerIndex,
  playerIndexes: PlayerIndex[] = getMysteryEncounterPlayerIndexes(),
): PlayerIndex | undefined {
  const currentIndex = playerIndexes.indexOf(currentPlayerIndex);
  return currentIndex >= 0 ? playerIndexes[currentIndex + 1] : undefined;
}

export function showMysteryEncounterPlayerMenu({
  playerIndex,
  overrideOptions,
  overrideQuery = "What will you do?",
  startingCursorIndex = 0,
  slideInDescription = false,
}: MysteryEncounterPlayerMenuConfig): void {
  globalScene.waitForPlayerInput(playerIndex);
  updateWindowType(playerIndex + 1);

  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription,
      overrideTitle: getMysteryEncounterPlayerTitle(playerIndex),
      overrideQuery,
      overrideOptions,
      startingCursorIndex,
    });
  });
}
