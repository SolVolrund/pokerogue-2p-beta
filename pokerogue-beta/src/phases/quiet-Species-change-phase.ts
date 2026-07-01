//import { modifierTypes } from "#data/data-lists";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { getTypeRgb } from "#data/type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { BattlePhase } from "#phases/battle-phase";
import { playTween } from "#utils/anim-utils";
import { CLASSIC_FINAL_BOSS_SEGMENTS } from "#utils/classic-final-boss-utils";
import { speciesDataRegistry } from "#app/global-species-data-registry";

import { TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonMove } from "#moves/pokemon-move";
import { WeatherType } from "#enums/weather-type";
import { Stat } from "#enums/stat";

//import { applyOnLoseAbAttrs, applyPostFormChangeAbAttrs } from "#abilities/apply-ab-attrs";

//import { isClassicFinalBossPhaseTwo } from "#utils/classic-final-boss-utils";
//import { getSpeciesFormChangeMessage } from "#data/form-change-triggers";
//import type { SpeciesFormChange } from "#data/pokemon-forms";
//import { ArenaTagSide } from "#enums/arena-tag-side";
//import { ArenaTagType } from "#enums/arena-tag-type";
//import { FormChangeItem } from "#enums/form-change-item";
//import { MoveId } from "#enums/move-id";
//import { Stat } from "#enums/stat";
//import { GammaRayBurstModifier, PokemonFormChangeItemModifier } from "#modifiers/modifier";
//import { FormChangeItemModifierType } from "#modifiers/modifier-type";
//import { getModifierType } from "#utils/modifier-utils";
//import { groupStatChange } from "#utils/stat-change";

/**
 * Phase handling mid-battle form changes that do not occur in the Party modal
 * and do not show an evolution dialogue.
 */
// TODO: Rename as the term "quiet" can be confusing
export class QuietSpeciesChangePhase extends BattlePhase {
  public readonly phaseName = "QuietSpeciesChangePhase";

  public readonly pokemon: Pokemon;
  protected readonly speciesId: SpeciesId;
  /** The Pokemon's prior name before changing forms. */
  // TODO: remove? it's unused
  private preName: string;

  constructor(pokemon: Pokemon, speciesId: SpeciesId) {
    super();

    this.pokemon = pokemon;
    this.speciesId = speciesId;
  }

  async start(): Promise<void> {
    super.start();

    this.preName = getPokemonNameWithAffix(this.pokemon);

    // Don't do anything if the user is already in the same species.
    if (this.pokemon.species.speciesId === this.speciesId) {
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
      await this.doChangeSpecies();
      this.showSpeciesChangeTextAndEnd();
    }
  }

  /**
   * Helper function to show text upon changing forms and end the phase.
   * @remarks
   * Does not actually change the user's form.
   */
private applyMewEntryEffect(): void {

  globalScene.phaseManager.pushNew("MovePhase", this.pokemon, [this.pokemon.getBattlerIndex()], new PokemonMove(MoveId), MoveUseMode.IGNORE_PP,);

  switch (this.pokemon.species.speciesId) {
     case SpeciesId.MEWTWO:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.LUGIA:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.HO_OH:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.KYOGRE:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.GROUDON:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.RAYQUAZA:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.DIALGA:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.PALKIA:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.GIRATINA:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.RESHIRAM:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.ZEKROM:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.KYUREM:
      globalScene.arena.trySetWeather(WeatherType.SNOW, this.pokemon);
      break;
    case SpeciesId.XERNEAS:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.YVELTAL:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.ZYGARDE:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.SOLGALEO:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.LUNALA:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.NECROZMA:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.ZACIAN:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.ZAMAZENTA:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.CALYREX:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.KORAIDON:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.MIRAIDON:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.TERAPAGOS:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.MARSHADOW:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.MEW:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    default:

  }
}

private showSpeciesChangeTextAndEnd(): void {
  const { ui } = globalScene;
  ui.showText(this.getMewTransformMessage(), null, () => this.end(), 1500);
  }

  private getMewTransformMessage(): string {
    switch (this.pokemon.species.speciesId) {
    case SpeciesId.MEWTWO:
      return "This is me if I were as serious as you all the time!";
    case SpeciesId.LUGIA:
      return "Hey, hold on let me sing a song for you!";
    case SpeciesId.HO_OH:
      return "Lets add a bit of color to your grey skies!";
    case SpeciesId.KYOGRE:
      return "Hope you brought an umbrella!";
    case SpeciesId.GROUDON:
      return "Hope you brought sun screen!";
    case SpeciesId.RAYQUAZA:
      return "Let's take this fight to new heights!";
    case SpeciesId.DIALGA:
      return "Okay I think you need a *Time* out... get it?";
    case SpeciesId.PALKIA:
      return "All the space in the universe and you march on through ignoring all of it?";
    case SpeciesId.GIRATINA:
      return "Seeing you like this is like looking at the worst funhouse mirror!... Smile already!";
    case SpeciesId.RESHIRAM:
      return "You can't handle the truth!";
    case SpeciesId.ZEKROM:
      return "I think this one is the *Ideal* form to spark a reaction out of you!";
    case SpeciesId.KYUREM:
      return "I think you really need to chill out!";
    case SpeciesId.XERNEAS:
      return "Your tough, but every fairy tale needs its happy ending!";
    case SpeciesId.YVELTAL:
      return "Ill have you dying of laughter yet... im sorry would you have prefered a bacon joke?";
    case SpeciesId.ZYGARDE:
      return "Lets pull your head out of the clouds and back down to earth!";
    case SpeciesId.SOLGALEO:
      return "Here comes the sun doo-dun-doo-doo";
    case SpeciesId.LUNALA:
      return "Moon Prism Power, Make Up!... well i couldnt exactly make a horse joke!";
    case SpeciesId.NECROZMA:
      return "... ill be honest, I have no clue who this guy is.";
    case SpeciesId.ZACIAN:
      return "I HAVE THE POWER!!! ... wait, i forgot the prop sword.";
    case SpeciesId.ZAMAZENTA:
      return "Sometimes the best offense is a good defense!";
    case SpeciesId.CALYREX:
      return "oh my kingdom for a horse... Hey wait, how DOES transform work for multi pokemon pokemon? like Maushold?";
    case SpeciesId.KORAIDON:
      return "I hope your ready for some *Pre*-historically bad puns!";
    case SpeciesId.MIRAIDON:
      return "Now I am Harder Better Faster Stronger!";
    case SpeciesId.TERAPAGOS:
      return "I prefer bubbles to crystals, but ill make this work!";
    case SpeciesId.MARSHADOW:
      return "... what? I just like Marshadow, hes cool.";
    case SpeciesId.MEW:
      return "Alright. Its time for momma to put the grouchy kid to bed!";
    default:
      return "Well that didnt work, lets try something else!";
    }
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

    await this.doChangeSpecies();
    this.showSpeciesChangeTextAndEnd();
  }

  /**
   * Wrapper function to queue effects related to a Pokemon changing forms.
   */
private async doChangeSpecies(): Promise<void> {
  this.pokemon.species = speciesDataRegistry.getSpecies(this.speciesId);
  this.pokemon.formIndex = 0;
  this.pokemon.generateName();
  this.pokemon.generateAndPopulateMoveset(false);
  this.pokemon.setScale(this.pokemon.getSpriteScale());

  await this.pokemon.loadAssets();
  this.pokemon.calculateStats();

  await Promise.all([
    this.pokemon.updateInfo(this.pokemon.isFainted()),
    globalScene.updateFieldScale(),
  ]);
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
    await this.doChangeSpecies();

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

    this.showSpeciesChangeTextAndEnd();
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
      //if (this.pokemon.species.speciesId === SpeciesId.NECROZMA) {
      //  this.pokemon.getStatStages().fill(0);
      //}
      this.pokemon.bossSegments = CLASSIC_FINAL_BOSS_SEGMENTS;
      this.pokemon.bossSegmentIndex = CLASSIC_FINAL_BOSS_SEGMENTS - 1;
      this.pokemon.initBattleInfo();
      this.pokemon.cry();

      globalScene.phaseManager.cancelMove(p => p.pokemon === this.pokemon);
/*
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
        */
    }
    super.end();
  }
  
}
