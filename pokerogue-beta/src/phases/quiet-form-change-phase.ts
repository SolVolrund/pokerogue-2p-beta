import { applyOnLoseAbAttrs, applyPostFormChangeAbAttrs } from "#abilities/apply-ab-attrs";
import { modifierTypes } from "#data/data-lists";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { getSpeciesFormChangeMessage } from "#data/form-change-triggers";
import type { SpeciesFormChange } from "#data/pokemon-forms";
import { getTypeRgb } from "#data/type";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { GammaRayBurstModifier, PokemonFormChangeItemModifier } from "#modifiers/modifier";
import { FormChangeItemModifierType } from "#modifiers/modifier-type";
import { BattlePhase } from "#phases/battle-phase";
import { playTween } from "#utils/anim-utils";
import { CLASSIC_FINAL_BOSS_SEGMENTS, isClassicFinalBossPhaseTwo } from "#utils/classic-final-boss-utils";
import { getModifierType } from "#utils/modifier-utils";
import { groupStatChange } from "#utils/stat-change";

/**
 * Phase handling mid-battle form changes that do not occur in the Party modal
 * and do not show an evolution dialogue.
 */
// TODO: Rename as the term "quiet" can be confusing
export class QuietFormChangePhase extends BattlePhase {
  public readonly phaseName = "QuietFormChangePhase";

  public readonly pokemon: Pokemon;
  protected readonly formChange: SpeciesFormChange;
  /** The Pokemon's prior name before changing forms. */
  // TODO: remove? it's unused
  private preName: string;

  constructor(pokemon: Pokemon, formChange: SpeciesFormChange) {
    super();

    this.pokemon = pokemon;
    this.formChange = formChange;
  }

  async start(): Promise<void> {
    super.start();

    this.preName = getPokemonNameWithAffix(this.pokemon);

    // Don't do anything if the user is already in the same form.
    if (this.pokemon.formIndex === this.pokemon.species.forms.findIndex(f => f.formKey === this.formChange.formKey)) {
      super.end();
      return;
    }

    if (!this.pokemon.visible) {
      await this.checkInactive();
      return;
    }

    if (this.pokemon.isActive(true)) {
      await this.playFormChangeTween();
    } else {
      // End early if an enemy pokemon is fainted to avoid animation softlocks
      // TODO: Might be better to avoid triggering the form change altogether...
      if (this.pokemon.isFainted() && !this.pokemon.isPlayer()) {
        super.end();
        return;
      }
      await this.doChangeForm();
      this.showFormChangeTextAndEnd();
    }
  }

  /**
   * Helper function to show text upon changing forms and end the phase.
   * @remarks
   * Does not actually change the user's form.
   */
  private showFormChangeTextAndEnd(): void {
    const { pokemon, formChange, preName } = this;
    const { ui } = globalScene;
    ui.showText(getSpeciesFormChangeMessage(pokemon, formChange, preName), null, () => this.end(), 1500);
  }

  /**
   * Handle queueing messages for form changing a currently invisible player Pokemon.
   */
  private async checkInactive(): Promise<void> {
    // End immediately for off-field enemy pokemon
    // TODO: This avoids actually doing the form change, is this intended?
    if (!this.pokemon.isPlayer() && !this.pokemon.isActive(true)) {
      super.end();
      return;
    }

    await this.doChangeForm();
    this.showFormChangeTextAndEnd();
  }

  /**
   * Wrapper function to queue effects related to a Pokemon changing forms.
   */
  private async doChangeForm(): Promise<void> {
    const { pokemon, formChange } = this;

    // TODO: This will have ordering issues with on lose abilities' trigger messages showing after this Phase ends
    // if any are given to a Pokemon with mid-battle form changes.
    // If this is desired later on, the animation/textual part of `QuietFormChangePhase` will need to be pulled out
    // into a separate Phase, though I doubt balence team will want to do this for a while...

    applyOnLoseAbAttrs({ pokemon });
    await pokemon.changeForm(formChange);
    applyPostFormChangeAbAttrs({ pokemon });
  }

  private async playFormChangeTween(): Promise<void> {
    const [pokemonTintSprite, pokemonFormTintSprite] = [this.getPokemonSprite(), this.getPokemonSprite()];

    // TODO: This is never deregistered
    this.pokemon.getSprite().on("animationupdate", (_anim, frame) => {
      if (frame.textureKey === pokemonTintSprite.texture.key) {
        pokemonTintSprite.setFrame(frame.textureFrame);
      } else {
        pokemonFormTintSprite.setFrame(frame.textureFrame);
      }
    });

    pokemonTintSprite // formatting
      .setAlpha(0)
      .setTintFill(0xffffff);
    pokemonFormTintSprite // formatting
      .setVisible(false)
      .setTintFill(0xffffff);

    audioManager.playSound("battle_anims/PRSFX- Transform");

    await playTween({
      targets: pokemonTintSprite,
      alpha: 1,
      duration: 1000,
      ease: "Cubic.easeIn",
    });

    this.pokemon.setVisible(false);
    await this.doChangeForm();

    pokemonFormTintSprite.setScale(0.01);
    const spriteKey = this.pokemon.getBattleSpriteKey();
    // TODO: Why do we play and then immediately stop the form tint sprite?
    // The thing isn't even visible anyways at this point in the code
    try {
      pokemonFormTintSprite.play(spriteKey).stop();
    } catch (err: unknown) {
      console.error(`Failed to play animation for ${spriteKey}`, err);
    }

    pokemonFormTintSprite.setVisible(true);
    globalScene.tweens.add({
      targets: pokemonTintSprite,
      delay: 250,
      scale: 0.01,
      ease: "Cubic.easeInOut",
      duration: 500,
      onComplete: () => pokemonTintSprite.destroy(),
    });
    await playTween({
      targets: pokemonFormTintSprite,
      delay: 250,
      scale: this.pokemon.getSpriteScale(),
      ease: "Cubic.easeInOut",
      duration: 500,
    });

    this.pokemon.setVisible(true);
    await playTween({
      targets: pokemonFormTintSprite,
      delay: 250,
      alpha: 0,
      ease: "Cubic.easeOut",
      duration: 1000,
    });
    pokemonTintSprite.setVisible(false);

    this.showFormChangeTextAndEnd();
  }

  private getPokemonSprite(): Phaser.GameObjects.Sprite {
    const sprite = globalScene.addPokemonSprite(
      this.pokemon,
      this.pokemon.x + this.pokemon.getSprite().x,
      this.pokemon.y + this.pokemon.getSprite().y,
      "pkmn__sub",
    );
    sprite.setOrigin(0.5, 1);
    const spriteKey = this.pokemon.getBattleSpriteKey();
    // TODO: Move error handling elsewhere
    try {
      sprite.play(spriteKey).stop();
    } catch (err: unknown) {
      console.error(`Failed to play animation for ${spriteKey}`, err);
    }
    sprite.setPipeline(globalScene.spritePipeline, {
      tone: [0.0, 0.0, 0.0, 0.0],
      hasShadow: false,
      teraColor: getTypeRgb(this.pokemon.getTeraType()),
      isTerastallized: this.pokemon.isTerastallized,
    });
    ["spriteColors", "fusionSpriteColors"].forEach(k => {
      if (this.pokemon.summonData.speciesForm) {
        k += "Base";
      }
      sprite.pipelineData[k] = this.pokemon.getSprite().pipelineData[k];
    });
    globalScene.field.add(sprite);
    return sprite;
  }

  end(): void {
    // Autotomize's weight reduction is reset when form changing
    this.pokemon.removeTag(BattlerTagType.AUTOTOMIZED);

    // TODO: This final boss fight code should almost certainly go in its own superclass phase
    if (globalScene.currentBattle.isClassicFinalBoss && this.pokemon.isEnemy()) {
      audioManager.playBgm();
      globalScene.phaseManager.unshiftNew(
        "PokemonHealPhase",
        this.pokemon.getBattlerIndex(),
        this.pokemon.getMaxHp(),
        null,
        false,
        false,
        false,
        true,
      );
      // TODO: Use or create a helper function to remove all tags on a Pokemon
      this.pokemon.findAndRemoveTags(() => true);
      if (this.pokemon.species.speciesId === SpeciesId.NECROZMA) {
        this.pokemon.getStatStages().fill(0);
      }
      this.pokemon.bossSegments = CLASSIC_FINAL_BOSS_SEGMENTS;
      this.pokemon.bossSegmentIndex = CLASSIC_FINAL_BOSS_SEGMENTS - 1;
      this.pokemon.initBattleInfo();
      this.pokemon.cry();

      globalScene.phaseManager.cancelMove(p => p.pokemon === this.pokemon);

      if (
        this.pokemon.species.speciesId === SpeciesId.NECROZMA
        && isClassicFinalBossPhaseTwo(this.pokemon)
        && !globalScene.findModifier(
          m => m instanceof GammaRayBurstModifier && m.pokemonId === this.pokemon.id,
          false,
        )
      ) {
        const gammaRayBurst = getModifierType(modifierTypes.GAMMA_RAY_BURST).newModifier(
          this.pokemon,
        ) as GammaRayBurstModifier;
        globalScene.addEnemyModifier(gammaRayBurst, false, true);
      }

      if (this.pokemon.species.speciesId === SpeciesId.ARCEUS && isClassicFinalBossPhaseTwo(this.pokemon)) {
        if (
          !globalScene.findModifier(
            m =>
              m instanceof PokemonFormChangeItemModifier
              && m.pokemonId === this.pokemon.id
              && m.formChangeItem === FormChangeItem.LEGEND_PLATE,
            false,
          )
        ) {
          const legendPlate = new FormChangeItemModifierType(FormChangeItem.LEGEND_PLATE).newModifier(
            this.pokemon,
          ) as PokemonFormChangeItemModifier;
          globalScene.addEnemyModifier(legendPlate, false, true);
        }

        this.pokemon.addTag(BattlerTagType.AQUA_RING, 1, MoveId.AQUA_RING, this.pokemon.id);
        this.pokemon.addTag(BattlerTagType.INGRAIN, 1, MoveId.INGRAIN, this.pokemon.id);
        globalScene.arena.addTag(
          ArenaTagType.STEALTH_ROCK,
          0,
          MoveId.STEALTH_ROCK,
          this.pokemon.id,
          ArenaTagSide.PLAYER,
        );
        globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
          battlerIndex: this.pokemon.getBattlerIndex(),
          changes: groupStatChange([Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD], 1),
          sourcePokemon: this.pokemon,
        });
      }
    }

    super.end();
  }
}
