import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { getStatusEffectHealText } from "#data/status-effect";
import type { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { CommonAnim } from "#enums/move-anims-common";
import { HealingBoosterModifier } from "#modifiers/modifier";
import { CommonAnimPhase } from "#phases/common-anim-phase";
import { HealAchv } from "#system/achv";
import { NumberHolder } from "#utils/common";
import i18next from "i18next";

export interface PokemonHealOptions {
  message?: string;
  showFullHpMessage?: boolean;
  skipAnim?: boolean;
  revive?: boolean;
  healStatus?: boolean;
  preventFullHeal?: boolean;
  fullRestorePP?: boolean;
}

export class PokemonHealPhase extends CommonAnimPhase {
  public readonly phaseName = "PokemonHealPhase";

  constructor(
    battlerIndex: BattlerIndex,
    private readonly hpHealed: number,
    private readonly options: PokemonHealOptions = {},
  ) {
    super(battlerIndex, undefined, CommonAnim.HEALTH_UP);
  }

  public override start(): void {
    const pokemon = this.getPokemon();
    if (!this.options.skipAnim && (this.options.revive || pokemon.hp) && !pokemon.isFullHp()) {
      super.start();
    } else {
      this.end();
    }
  }

  public override async end(): Promise<void> {
    await this.heal();
    super.end();
  }

  private async heal(): Promise<void> {
    const pokemon = this.getPokemon();
    if (!this.options.revive && !pokemon.isActive(true)) {
      return;
    }

    const healBlock = pokemon.getTag(BattlerTagType.HEAL_BLOCK);
    if (healBlock && this.hpHealed > 0) {
      globalScene.phaseManager.queueMessage(healBlock.onActivation(pokemon));
      return;
    }

    let message = this.options.message;
    if (this.hpHealed < 0) {
      // Liquid Ooze damage is not increased by the recipient's Healing Charms.
      pokemon.damageAndUpdate(Math.max(1, Math.floor(-this.hpHealed)), { result: HitResult.INDIRECT });
    } else if (this.hpHealed > 0 && pokemon.isFullHp()) {
      if (this.options.showFullHpMessage ?? true) {
        message = i18next.t("battle:hpIsFull", { pokemonName: getPokemonNameWithAffix(pokemon) });
      }
    } else if (this.hpHealed > 0) {
      const multiplier = new NumberHolder(1);
      if (!this.options.revive) {
        globalScene.applyModifiersForPokemon(HealingBoosterModifier, pokemon, multiplier);
      }
      const missingHp = Math.max(0, pokemon.getMaxHp() - pokemon.hp - Number(!!this.options.preventFullHeal));
      const amount = Math.min(missingHp, Math.max(1, Math.floor(this.hpHealed * multiplier.value)));
      const actualHeal = pokemon.heal(amount);
      if (actualHeal > 0) {
        globalScene.damageNumberHandler.add(pokemon, actualHeal, HitResult.HEAL);
        if (pokemon.isPlayer()) {
          const playerIndex = globalScene.getPlayerIndexForPokemon(pokemon) ?? globalScene.activePlayerIndex;
          const gameData = globalScene.getPlayerGameData(playerIndex);
          if (!globalScene.isComputerPartnerPlayer(playerIndex)) {
            globalScene.validateAchvsForPlayer(HealAchv, playerIndex, new NumberHolder(actualHeal));
          }
          gameData.gameStats.highestHeal = Math.max(gameData.gameStats.highestHeal, actualHeal);
        }
      }
    }

    // Status cures and PP restoration must still run when HP is already full.
    if (this.options.healStatus && pokemon.status) {
      message = getStatusEffectHealText(pokemon.status.effect, getPokemonNameWithAffix(pokemon));
      pokemon.resetStatus();
    }
    if (this.options.fullRestorePP) {
      for (const move of pokemon.getMovesetForPpRestore()) {
        move.ppUsed = 0;
      }
    }
    if (message) {
      globalScene.phaseManager.queueMessage(message);
    }
    await pokemon.updateInfo();
  }
}
