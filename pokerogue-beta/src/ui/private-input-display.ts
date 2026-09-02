import type { InputOwner } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";

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

  return globalScene.twoPlayerLocalInputSeat !== inputOwner;
}

export function shouldRedactCombatInputOwner(inputOwner: InputOwner = globalScene.inputOwner): boolean {
  return isPrivateCombatInputActive() && shouldRedactInputOwner(inputOwner);
}

function isPrivateCombatInputActive(): boolean {
  const misc = globalScene.currentBattle?.mysteryEncounter?.misc;
  return !!misc?.shinyBadgeDuelActive;
}
