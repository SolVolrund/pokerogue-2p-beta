import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { BaseStatModifier } from "#modifiers/modifier";
import { ModifierTypeGenerator } from "#modifiers/modifier-type";
import {
  CLASSIC_FINAL_BOSS_MULTIPLAYER_SCALING_STATS,
  CLASSIC_FINAL_BOSS_PHASE_TWO_VITAMIN_STACKS,
  isClassicFinalBossPhaseTwo,
  isMewtwoFinalBossBoss,
  isUnownRealFinalBossWave,
} from "#utils/classic-final-boss-utils";
import { getModifierType } from "#utils/modifier-utils";

/** Grants a one-time, additive defensive bonus, separate from player-count scaling. */
export function applyClassicFinalBossBulkBonus(pokemon: Pokemon): boolean {
  const battle = globalScene.currentBattle;
  if (!battle?.isClassicFinalBoss || !pokemon.isEnemy() || !pokemon.isBoss()
    || pokemon.customPokemonData.finalBossBulkBonusApplied) {
    return false;
  }

  let eligible = false;
  if (battle.mewGauntletState?.pokemonId === pokemon.id) {
    eligible = battle.mewGauntletState.phase >= 2;
  } else {
    switch (pokemon.species.speciesId) {
      case SpeciesId.NECROZMA:
      case SpeciesId.ARCEUS:
        eligible = isClassicFinalBossPhaseTwo(pokemon);
        break;
      case SpeciesId.UNOWN:
        eligible = isUnownRealFinalBossWave(battle.waveIndex, globalScene.gameMode.modeId)
          && battle.unownFinalBossState?.bossPokemonId === pokemon.id
          && pokemon.hasSpecies(SpeciesId.UNOWN, "schooling");
        break;
      case SpeciesId.MEWTWO:
        eligible = isMewtwoFinalBossBoss(battle.mewtwoFinalBossState, pokemon)
          && [SpeciesFormKey.MEGA_X, SpeciesFormKey.MEGA_Y, "armored"].includes(pokemon.getFormKey());
        break;
    }
  }
  if (!eligible) {
    return false;
  }

  const generator = getModifierType(modifierTypes.BASE_STAT_BOOSTER);
  if (!(generator instanceof ModifierTypeGenerator)) {
    return false;
  }
  const vitamins: BaseStatModifier[] = [];
  for (const stat of CLASSIC_FINAL_BOSS_MULTIPLAYER_SCALING_STATS) {
    const vitamin = generator.generateType(globalScene.getEnemyParty(), [stat])?.newModifier(pokemon);
    if (!(vitamin instanceof BaseStatModifier)) {
      return false;
    }
    vitamin.stackCount = CLASSIC_FINAL_BOSS_PHASE_TWO_VITAMIN_STACKS;
    vitamins.push(vitamin);
  }

  // The saved flag also reserves room beyond the usual IV-based vitamin cap.
  pokemon.customPokemonData.finalBossBulkBonusApplied = true;
  for (const vitamin of vitamins) {
    void globalScene.addEnemyModifier(vitamin, true, true);
  }
  pokemon.calculateStats();
  globalScene.updateModifiers(false, true);
  return true;
}
