import type { InputOwner } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";

type PrivateInputSide = "players" | "enemy-player";

export function shouldRedactInputOwner(inputOwner: InputOwner = globalScene.inputOwner): boolean {
  if (!globalScene.twoPlayerMode || inputOwner === "none" || inputOwner === "both") {
    return false;
  }

  if (globalScene.twoPlayerLocalInputSeat === "both") {
    return false;
  }

  if (globalScene.canProxyComputerPartnerInput()) {
    return false;
  }

  if (globalScene.twoPlayerEnemyPlayerMode) {
    const localSide = getEnemyPlayerModeInputSide(globalScene.twoPlayerLocalInputSeat);
    const ownerSide = getEnemyPlayerModeInputSide(inputOwner);

    if (localSide && ownerSide) {
      return localSide !== ownerSide;
    }
  }

  return globalScene.twoPlayerLocalInputSeat !== inputOwner;
}

export function shouldRedactCombatInputOwner(inputOwner: InputOwner = globalScene.inputOwner): boolean {
  return isPrivateCombatInputActive() && shouldRedactInputOwner(inputOwner);
}

function isPrivateCombatInputActive(): boolean {
  const misc = globalScene.currentBattle?.mysteryEncounter?.misc;
  return !!misc?.shinyBadgeDuelActive || globalScene.twoPlayerEnemyPlayerMode;
}

function getEnemyPlayerModeInputSide(inputOwner: InputOwner): PrivateInputSide | undefined {
  if (inputOwner === "ep") {
    return "enemy-player";
  }

  if (typeof inputOwner === "number") {
    return "players";
  }
}
