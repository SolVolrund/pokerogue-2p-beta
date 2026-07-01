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
import type { BattlerIndex } from "#enums/battler-index";
import { randSeedItem } from "#utils/common";
import { groupStatChange } from "#utils/stat-change";
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

  globalScene.phaseManager.pushNew("MovePhase", this.pokemon, [this.pokemon.getBattlerIndex()], new PokemonMove(MoveId.HAZE), MoveUseMode.IGNORE_PP,);

  switch (this.pokemon.species.speciesId) {
     case SpeciesId.MEWTWO:
      globalScene.phaseManager.pushNew("MovePhase", this.pokemon, [this.pokemon.getBattlerIndex()], new PokemonMove(MoveId.REFLECT), MoveUseMode.IGNORE_PP,);
      globalScene.phaseManager.pushNew("MovePhase", this.pokemon, [this.pokemon.getBattlerIndex()], new PokemonMove(MoveId.LIGHT_SCREEN), MoveUseMode.IGNORE_PP,);
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.LUGIA:
      globalScene.arena.trySetWeather(WeatherType.RAIN, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.PSYCHIC, false, this.pokemon);
      break;
    case SpeciesId.HO_OH:
      globalScene.arena.trySetWeather(WeatherType.SUNNY, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.KYOGRE:
      globalScene.arena.trySetWeather(WeatherType.RAIN, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.GROUDON:
      globalScene.arena.trySetWeather(WeatherType.SUNNY, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.RAYQUAZA:
      globalScene.arena.trySetWeather(WeatherType.STRONG_WINDS, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.DIALGA:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.PALKIA:
      globalScene.arena.trySetWeather(WeatherType.RAIN, this.pokemon);
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
      globalScene.arena.trySetTerrain(TerrainType.MISTY, false, this.pokemon);
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
      globalScene.arena.trySetWeather(WeatherType.SUNNY, this.pokemon);
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
      globalScene.arena.trySetWeather(WeatherType.FOG, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.MISTY, false, this.pokemon);
      break;
    case SpeciesId.ZAMAZENTA:
      globalScene.arena.trySetWeather(WeatherType.FOG, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.MISTY, false, this.pokemon);
      break;
    case SpeciesId.CALYREX:
      globalScene.arena.trySetWeather(WeatherType.FOG, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.GRASSY, false, this.pokemon);
      break;
    case SpeciesId.KORAIDON:
      globalScene.arena.trySetWeather(WeatherType.SUNNY, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.MIRAIDON:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.ELECTRIC, false, this.pokemon);
      break;
    case SpeciesId.TERAPAGOS:
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.MARSHADOW:
      globalScene.arena.trySetWeather(WeatherType.FOG, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.NONE, false, this.pokemon);
      break;
    case SpeciesId.MEW:
      globalScene.arena.trySetWeather(WeatherType.FOG, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.PSYCHIC, false, this.pokemon);
      globalScene.phaseManager.pushNew("StatStageChangePhase", {battlerIndex: this.pokemon.getBattlerIndex(),changes: groupStatChange([Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD], 1),sourcePokemon: this.pokemon,});
      break;
    case SpeciesId.JIRACHI:
      globalScene.phaseManager.pushNew("MovePhase", this.pokemon, [this.pokemon.getBattlerIndex()], new PokemonMove(MoveId.WISH), MoveUseMode.IGNORE_PP);
      const doomDesireTarget = this.getRandomActivePlayerBattlerIndex();
      if (doomDesireTarget !== undefined) {globalScene.phaseManager.pushNew("MovePhase",this.pokemon,[doomDesireTarget],new PokemonMove(MoveId.DOOM_DESIRE),MoveUseMode.IGNORE_PP,);}
      globalScene.arena.trySetWeather(WeatherType.NONE, this.pokemon);
      globalScene.arena.trySetTerrain(TerrainType.PSYCHIC, false, this.pokemon);
      break;
    default:

  }
}

private getRandomActivePlayerBattlerIndex(exclude?: BattlerIndex): BattlerIndex | undefined {
  const targets = globalScene
    .getPlayerField(true)
    .map(pokemon => pokemon.getBattlerIndex())
    .filter(battlerIndex => battlerIndex !== exclude);

  return targets.length ? randSeedItem(targets) : undefined;
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
    case SpeciesId.JIRACHI:
      return "I *Wish* you would crack a smile!";
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
  this.applyMewGauntletMoveset();
  this.pokemon.setScale(this.pokemon.getSpriteScale());

  await this.pokemon.loadAssets();
  this.pokemon.calculateStats();

  await Promise.all([
    this.pokemon.updateInfo(this.pokemon.isFainted()),
    globalScene.updateFieldScale(),
  ]);
}

private applyMewGauntletMoveset(): void {
  const moveIds = this.getMewGauntletMoveIds();

  if (!moveIds) {
    return;
  }
  const moves = moveIds.map(moveId => new PokemonMove(moveId));
  this.pokemon.moveset = moves;
  this.pokemon.summonData.moveset = moves;
}

private getMewGauntletMoveIds(): MoveId[] | undefined{
  switch (this.pokemon.species.speciesId) {
    case SpeciesId.MEWTWO:
      return [MoveId.PSYSTRIKE, MoveId.ICE_BEAM, MoveId.FIRE_BLAST, MoveId.CALM_MIND];
    case SpeciesId.LUGIA:
      return [MoveId.AEROBLAST, MoveId.PSYCHIC, MoveId.ROOST, MoveId.ICE_BEAM];
    case SpeciesId.HO_OH:
      return [MoveId.SACRED_FIRE, MoveId.BRAVE_BIRD, MoveId.RECOVER, MoveId.EARTHQUAKE];
    case SpeciesId.KYOGRE:
      return [MoveId.ORIGIN_PULSE, MoveId.CALM_MIND, MoveId.ICE_BEAM, MoveId.THUNDER]; 
    case SpeciesId.GROUDON:
      return [MoveId.PRECIPICE_BLADES, MoveId.SWORDS_DANCE, MoveId.STEALTH_ROCK, MoveId.STONE_EDGE];
    case SpeciesId.RAYQUAZA:
      return [MoveId.DRAGON_ASCENT, MoveId.DRAGON_DANCE, MoveId.V_CREATE, MoveId.EARTHQUAKE];
    case SpeciesId.DIALGA:
      return [MoveId.ROAR_OF_TIME, MoveId.FIRE_BLAST, MoveId.THUNDER, MoveId.ANCIENT_POWER];
    case SpeciesId.PALKIA:
      return [MoveId.SPACIAL_REND, MoveId.HYDRO_PUMP, MoveId.THUNDER, MoveId.FIRE_BLAST];
    case SpeciesId.GIRATINA:
      return [MoveId.SHADOW_FORCE, MoveId.REST, MoveId.TOXIC, MoveId.WILL_O_WISP];
    case SpeciesId.RESHIRAM:
      return [MoveId.BLUE_FLARE, MoveId.DRACO_METEOR, MoveId.ROOST, MoveId.TOXIC];
    case SpeciesId.ZEKROM:
      return [MoveId.BOLT_STRIKE, MoveId.HONE_CLAWS, MoveId.OUTRAGE, MoveId.SUBSTITUTE];
    case SpeciesId.KYUREM:
      return [MoveId.GLACIATE, MoveId.EARTH_POWER, MoveId.ROOST, MoveId.SUBSTITUTE];
    case SpeciesId.XERNEAS:
      return [MoveId.GEOMANCY, MoveId.FOCUS_BLAST, MoveId.THUNDER, MoveId.MOONBLAST];
    case SpeciesId.YVELTAL:
      return [MoveId.OBLIVION_WING, MoveId.DARK_PULSE, MoveId.TAUNT, MoveId.SUCKER_PUNCH];
    case SpeciesId.ZYGARDE:
      return [MoveId.THOUSAND_ARROWS, MoveId.DRAGON_DANCE, MoveId.SUBSTITUTE, MoveId.GLARE];
    case SpeciesId.SOLGALEO:
      return [MoveId.SUNSTEEL_STRIKE, MoveId.FIRE_BLAST, MoveId.MORNING_SUN, MoveId.SOLAR_BEAM];
    case SpeciesId.LUNALA:
      return [MoveId.MOONGEIST_BEAM, MoveId.PSYSHOCK, MoveId.FOCUS_BLAST, MoveId.MOONBLAST];
    case SpeciesId.NECROZMA:
      return [MoveId.PHOTON_GEYSER, MoveId.DRAGON_DANCE, MoveId.EARTHQUAKE, MoveId.X_SCISSOR];
    case SpeciesId.ZACIAN:
      return [MoveId.BEHEMOTH_BLADE, MoveId.PLAY_ROUGH, MoveId.CRUNCH, MoveId.CLOSE_COMBAT];
    case SpeciesId.ZAMAZENTA:
      return [MoveId.BEHEMOTH_BASH, MoveId.BODY_PRESS, MoveId.CRUNCH, MoveId.HEAVY_SLAM];
    case SpeciesId.CALYREX:
      return [MoveId.STORED_POWER, MoveId.LEECH_SEED, MoveId.GROWTH, MoveId.GIGA_DRAIN];
    case SpeciesId.KORAIDON:
      return [MoveId.COLLISION_COURSE, MoveId.SWORDS_DANCE, MoveId.FLARE_BLITZ, MoveId.SCALE_SHOT];
    case SpeciesId.MIRAIDON:
      return [MoveId.ELECTRO_DRIFT, MoveId.DRACO_METEOR, MoveId.CALM_MIND, MoveId.SOLAR_BEAM];
    case SpeciesId.TERAPAGOS:
      return [MoveId.TERA_STARSTORM, MoveId.RAPID_SPIN, MoveId.TOXIC, MoveId.ANCIENT_POWER];
    case SpeciesId.MARSHADOW:
      return [MoveId.SPECTRAL_THIEF, MoveId.ICE_PUNCH, MoveId.THUNDER_PUNCH, MoveId.SHADOW_SNEAK];
    case SpeciesId.JIRACHI:
      return [MoveId.WISH, MoveId.DOOM_DESIRE, MoveId.BODY_SLAM, MoveId.IRON_HEAD];
    case SpeciesId.MEW:
      return [MoveId.EXPANDING_FORCE, MoveId.COSMIC_POWER, MoveId.POWER_TRIP, MoveId.GROWTH];
    default:
      return [MoveId.METRONOME, MoveId.METRONOME, MoveId.METRONOME, MoveId.METRONOME];

  }
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
      this.applyMewEntryEffect();
      globalScene.phaseManager.cancelMove(p => p.pokemon === this.pokemon);
    }
    super.end();
  }
  
}
