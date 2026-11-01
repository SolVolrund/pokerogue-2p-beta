import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import type { Pokemon } from "#field/pokemon";
import { HauntingSkullModifier, type HauntingSkullStage, HauntingSpiritModifier } from "#modifiers/modifier";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedInt } from "#utils/common";
import { getModifierType } from "#utils/modifier-utils";
import i18next from "i18next";

export function getHauntingSkull(player: PlayerIndex): HauntingSkullModifier | undefined {
  return globalScene.findModifierForPlayer(m => m instanceof HauntingSkullModifier, player) as
    | HauntingSkullModifier
    | undefined;
}

export function getSpiritCount(player: PlayerIndex, greater = false): number {
  return globalScene
    .getPlayerModifiers(player)
    .filter((m): m is HauntingSpiritModifier => m instanceof HauntingSpiritModifier && m.greater === greater)
    .reduce((sum, m) => sum + m.getStackCount(), 0);
}

export function isReadyForGreatHaunt(player: PlayerIndex): boolean {
  const skull = getHauntingSkull(player);
  return skull?.stage === "portent" || skull?.stage === "malefic";
}

export function hasMaleficSkull(pokemon: Pokemon): boolean {
  if (!pokemon.isPlayer()) {
    return false;
  }
  const owner = globalScene.getPlayerIndexForPokemon(pokemon);
  return owner !== undefined && getHauntingSkull(owner)?.stage === "malefic";
}

// Temporarily disable party-wide haunting without disabling the skull's spirit bonuses.
const MALEFIC_SKULL_HAUNTING_ENABLED = false;

export function isHauntedByMaleficSkull(pokemon: Pokemon): boolean {
  return MALEFIC_SKULL_HAUNTING_ENABLED && hasMaleficSkull(pokemon);
}

export function getHauntingStatMultiplier(pokemon: Pokemon): number {
  if (!hasMaleficSkull(pokemon)) {
    return 1;
  }
  const owner = globalScene.getPlayerIndexForPokemon(pokemon)!;
  return 1 + (getSpiritCount(owner) + getSpiritCount(owner, true) * 2) / 200;
}

function grantItem(player: PlayerIndex, type: ModifierTypeFunc): boolean {
  const modifier = getModifierType(type).newModifier();
  // Automatic spirit drops stop at the cap instead of becoming substitute rewards.
  if (
    modifier instanceof HauntingSpiritModifier
    && getSpiritCount(player, modifier.greater) >= modifier.getMaxStackCount()
  ) {
    return false;
  }
  if (!globalScene.addModifier(modifier, true, false, false, true, undefined, player)) {
    throw new Error(`Unable to grant seasonal reward to player ${player}`);
  }
  return true;
}

function upgradeSkull(player: PlayerIndex, stage: HauntingSkullStage): void {
  const skull = getHauntingSkull(player);
  const type = getModifierType(stage === "portent" ? modifierTypes.PORTENT_SKULL : modifierTypes.MALEFIC_SKULL);
  // Replace in place: the player never briefly loses the skull's derived effects.
  if (skull) {
    skull.stage = stage;
    skull.type = type;
  }
}

/** Synchronous inventory transaction; presentation is handled by the reward phase. */
export function grantHauntingVictoryRewards(): string[] {
  const scene = globalScene;
  const state = scene.seasonalEncounters;
  const tower = state.tower;
  const battle = scene.currentBattle;
  const haunted = !!tower || !!battle.trainer?.haunted;
  const key = state.getBattleRewardKey(battle.waveIndex);
  const messages: string[] = [];
  for (const player of scene.getBattleParticipantPlayerIndexes()) {
    if (state.hasRewardedPlayer(key, player)) {
      continue;
    }
    const skull = getHauntingSkull(player);
    const playerName = scene.getPlayerDisplayName(player);
    if (haunted && !skull) {
      grantItem(player, modifierTypes.OMINOUS_SKULL);
      messages.push(i18next.t("battle:hauntingSkullFound", { playerName }));
    } else if (skull) {
      let spirit: "lesser" | "greater" | undefined = haunted ? (tower?.boss ? "greater" : "lesser") : undefined;
      if (!haunted && skull.stage === "malefic") {
        scene.executeWithSeedOffset(
          () => {
            if (randSeedInt(100) < 15) {
              spirit = randSeedInt(100) < 10 ? "greater" : "lesser";
            }
          },
          7319 + player * 113,
          scene.waveSeed,
        );
      }
      if (spirit) {
        const type = spirit === "greater" ? modifierTypes.GREATER_SPIRIT : modifierTypes.LESSER_SPIRIT;
        if (grantItem(player, type)) {
          messages.push(
            i18next.t("battle:hauntingSpiritCaptured", {
              playerName,
              spiritName: getModifierType(type).name,
              skullName: skull.type.name,
            }),
          );
        }
        if (skull.stage === "ominous" && getSpiritCount(player) >= 9) {
          upgradeSkull(player, "portent");
          messages.push(i18next.t("battle:hauntingSkullChanged", { playerName, skullName: skull.type.name }));
        }
        if (spirit === "greater" && skull.stage === "portent") {
          upgradeSkull(player, "malefic");
          messages.push(i18next.t("battle:hauntingSkullChanged", { playerName, skullName: skull.type.name }));
        }
      }
    }
    state.markPlayerRewarded(key, player);
    scene.updateModifiers(true, true, player);
  }
  if (tower?.boss && !tower.completed) {
    tower.completed = true;
    state.resolveHauntings();
    messages.push(i18next.t("battle:hauntingEnded"));
  }
  return messages;
}
