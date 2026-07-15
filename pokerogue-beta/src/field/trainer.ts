import { withRivalRollContext } from "#app/ai/rival-team-gen";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { signatureSpecies } from "#balance/signature-species";
import { EntryHazardTag } from "#data/arena-tag";
import type { PokemonSpecies } from "#data/pokemon-species";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { SpeciesId } from "#enums/species-id";
import { TeraAIMode } from "#enums/tera-ai-mode";
import { TrainerPoolTier } from "#enums/trainer-pool-tier";
import { getTrainerSlotForFieldIndex, TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import type { EnemyPokemon } from "#field/pokemon";
import type { PersistentModifier } from "#modifiers/modifier";
import type { TrainerConfig } from "#trainers/trainer-config";
import { trainerConfigs } from "#trainers/trainer-config";
import { TrainerPartyCompoundTemplate, type TrainerPartyTemplate } from "#trainers/trainer-party-template";
import { getRandomTwoPlayerTrainerPartners } from "#trainers/two-player-trainer-partners";
import { randSeedInt, randSeedItem } from "#utils/common";
import { getRandomLocaleEntry } from "#utils/i18n";
import { isMysteryEncounterSwitchProtectedPokemon } from "#utils/mystery-encounter-switch-protection";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { toCamelCase } from "#utils/strings";
import i18next from "i18next";

type TateLizaPairPool = "normal" | "strong";
type TateLizaPair = readonly [lizaSpecies: SpeciesId, tateSpecies: SpeciesId];

const TATE_LIZA_OPENING_PAIR: TateLizaPair = [SpeciesId.LUNATONE, SpeciesId.SOLROCK];

const TATE_LIZA_PAIRS: TateLizaPair[] = [
  [SpeciesId.PLUSLE, SpeciesId.MINUN],
  [SpeciesId.GARDEVOIR, SpeciesId.GALLADE],
  [SpeciesId.ZOROARK, SpeciesId.LUCARIO],
  [SpeciesId.VOLBEAT, SpeciesId.ILLUMISE],
  [SpeciesId.ORANGURU, SpeciesId.PASSIMIAN],
  [SpeciesId.GOTHITA, SpeciesId.SOLOSIS],
  [SpeciesId.GENGAR, SpeciesId.ALAKAZAM],
  [SpeciesId.FROSLASS, SpeciesId.GLALIE],
  [SpeciesId.NIDOKING, SpeciesId.NIDOQUEEN],
  [SpeciesId.TAUROS, SpeciesId.MILTANK],
  [SpeciesId.MAWILE, SpeciesId.SABLEYE],
  [SpeciesId.THROH, SpeciesId.SAWK],
  [SpeciesId.RUFFLET, SpeciesId.VULLABY],
  [SpeciesId.DURANT, SpeciesId.HEATMOR],
];

const TATE_LIZA_STRONG_PAIRS: TateLizaPair[] = [
  [SpeciesId.LATIAS, SpeciesId.LATIOS],
  [SpeciesId.KYOGRE, SpeciesId.GROUDON],
  [SpeciesId.DIALGA, SpeciesId.PALKIA],
  [SpeciesId.RESHIRAM, SpeciesId.ZEKROM],
  [SpeciesId.XERNEAS, SpeciesId.YVELTAL],
  [SpeciesId.ZACIAN, SpeciesId.ZAMAZENTA],
  [SpeciesId.KORAIDON, SpeciesId.MIRAIDON],
];

// `shiftCharCodes` uses `String.fromCharCode`, so offsets that differ by 2^16 produce identical seeds.
const TRAINER_PARTNER_SEED_OFFSET = 0x7fff;
const TRAINER_PARTNER_2_SEED_OFFSET = 0x3fff;

function isTateLizaTrainerType(trainerType?: TrainerType): boolean {
  return trainerType === TrainerType.TATE || trainerType === TrainerType.LIZA;
}

function isTateLizaDoubleConfig(config: TrainerConfig): boolean {
  return isTateLizaTrainerType(config.trainerType) && isTateLizaTrainerType(config.trainerTypeDouble);
}

function getTateLizaPairPoolSequence(waveIndex: number): TateLizaPairPool[] {
  const ret: TateLizaPairPool[] = [];

  if (waveIndex >= 50) {
    ret.push("normal");
  }
  if (waveIndex >= 80) {
    ret.push("strong");
  }
  if (waveIndex >= 120) {
    ret.push("normal");
  }
  if (waveIndex >= 150) {
    ret.push("strong");
  }
  if (waveIndex >= 180) {
    ret.push("normal");
  }

  return ret;
}

function getTateLizaPairCountForWave(waveIndex: number): number {
  return 1 + getTateLizaPairPoolSequence(waveIndex).length;
}

function getTateLizaPairPool(poolType: TateLizaPairPool): TateLizaPair[] {
  return poolType === "strong" ? TATE_LIZA_STRONG_PAIRS : TATE_LIZA_PAIRS;
}

function getTateLizaSpeciesForTrainer(pair: TateLizaPair, trainerType?: TrainerType): SpeciesId {
  return trainerType === TrainerType.LIZA ? pair[0] : pair[1];
}

function getTateLizaPairForPartyIndex(
  index: number,
  waveIndex: number,
  enemyParty: EnemyPokemon[],
): TateLizaPair | undefined {
  const pairIndex = Math.floor(index / 2);

  if (pairIndex === 0) {
    return TATE_LIZA_OPENING_PAIR;
  }

  const poolType = getTateLizaPairPoolSequence(waveIndex)[pairIndex - 1];

  if (!poolType) {
    return;
  }

  const pool = getTateLizaPairPool(poolType);
  const alreadyUsedSpecies = new Set(enemyParty.slice(0, pairIndex * 2).map(pokemon => pokemon.species.speciesId));
  const filteredPool = pool.filter(pair => !alreadyUsedSpecies.has(pair[0]) && !alreadyUsedSpecies.has(pair[1]));

  return randSeedItem(filteredPool.length > 0 ? filteredPool : pool);
}

function getTrainerSlotSeedOffset(trainerSlot: TrainerSlot): number {
  switch (trainerSlot) {
    case TrainerSlot.TRAINER_PARTNER:
      return TRAINER_PARTNER_SEED_OFFSET;
    case TrainerSlot.TRAINER_PARTNER_2:
      return TRAINER_PARTNER_2_SEED_OFFSET;
    default:
      return 0;
  }
}

export class Trainer extends Phaser.GameObjects.Container {
  public config: TrainerConfig;
  public variant: TrainerVariant;
  private trainerVariant: TrainerVariant;
  public partnerTrainerType: TrainerType | undefined;
  public partnerTrainerType2: TrainerType | undefined;
  public partnerVariant: TrainerVariant;
  public partnerVariant2: TrainerVariant;
  public partyTemplateIndex: number;
  public partnerName: string | undefined;
  public partnerName2: string | undefined;
  public nameKey: string;
  public partnerNameKey: string | undefined;
  public partnerNameKey2: string | undefined;
  private partnerConfig: TrainerConfig | undefined;
  private partnerConfig2: TrainerConfig | undefined;
  public originalIndexes: { [key: number]: number } = {};

  /**
   * Create a new Trainer.
   * @param trainerType - The {@linkcode TrainerType} for this trainer, used to determine
   * name, sprite, party contents and other details.
   * @param variant - The {@linkcode TrainerVariant} for this trainer (if any are available)
   * @param partyTemplateIndex - If provided, will override the trainer's party template with the given
   * version.
   * @param nameKey - If provided, will override the name key of the trainer
   * @param partnerNameKey - If provided, will override the
   * @param trainerConfigOverride - If provided, will override the trainer config for the given trainer type
   * @param partnerTrainerType - If provided, will use this TrainerType as the second trainer in a double battle
   * @param partnerVariant - If provided, will use this variant for the second trainer
   * @param partnerTrainerConfigOverride - If provided, will override the partner trainer config for the given trainer type
   * @param partnerTrainerType2 - If provided, will use this TrainerType as the third trainer in a triple battle
   * @param partnerVariant2 - If provided, will use this variant for the third trainer
   * @param partnerTrainerConfigOverride2 - If provided, will override the third trainer config for the given trainer type
   * @param partnerNameKey2 - If provided, will override the third trainer's name key
   * @todo Review how many of these parameters we actually need
   */
  constructor(
    trainerType: TrainerType,
    variant: TrainerVariant,
    partyTemplateIndex?: number,
    nameKey?: string,
    partnerNameKey?: string,
    trainerConfigOverride?: TrainerConfig,
    partnerTrainerType?: TrainerType,
    partnerVariant?: TrainerVariant,
    partnerTrainerConfigOverride?: TrainerConfig,
    partnerTrainerType2?: TrainerType,
    partnerVariant2?: TrainerVariant,
    partnerTrainerConfigOverride2?: TrainerConfig,
    partnerNameKey2?: string,
  ) {
    super(globalScene, -72, 80);
    const requestedVariant = variant;
    this.config =
      trainerConfigOverride
      ?? (Object.hasOwn(trainerConfigs, trainerType)
        ? trainerConfigs[trainerType]
        : trainerConfigs[TrainerType.ACE_TRAINER]);

    const lookupPartnerTrainerTypes =
      !trainerConfigOverride
      && globalScene.twoPlayerMode
      && globalScene.twoPlayerPartySize === 6
      && !this.config.doubleOnly
        ? getRandomTwoPlayerTrainerPartners(trainerType, globalScene.multiplayerPlayerCount > 2 ? 2 : 1)
        : [];
    this.partnerTrainerType =
      partnerTrainerType
      ?? partnerTrainerConfigOverride?.trainerType
      ?? lookupPartnerTrainerTypes[0]
      ?? (variant === TrainerVariant.DOUBLE && this.config.trainerTypeDouble
        ? this.config.trainerTypeDouble
        : undefined);
    this.partnerTrainerType2 =
      partnerTrainerType2
      ?? partnerTrainerConfigOverride2?.trainerType
      ?? lookupPartnerTrainerTypes[1]
      ?? (globalScene.twoPlayerMode && globalScene.multiplayerPlayerCount > 2
        ? lookupPartnerTrainerTypes[0]
        : undefined);
    this.partnerConfig =
      partnerTrainerConfigOverride
      ?? (this.partnerTrainerType == null ? undefined : trainerConfigs[this.partnerTrainerType]);
    this.partnerConfig2 =
      partnerTrainerConfigOverride2
      ?? (this.partnerTrainerType2 == null ? undefined : trainerConfigs[this.partnerTrainerType2]);

    if ((this.partnerConfig || this.partnerConfig2) && !this.config.doubleOnly) {
      variant = TrainerVariant.DOUBLE;
    }

    switch (variant) {
      case TrainerVariant.FEMALE:
        if (!this.config.hasGenders) {
          variant = TrainerVariant.DEFAULT;
        }
        break;
      case TrainerVariant.DOUBLE:
        if (!this.config.hasDouble && !this.partnerConfig && !this.partnerConfig2) {
          variant = TrainerVariant.DEFAULT;
        }
        break;
    }

    this.variant = variant;
    this.trainerVariant =
      this.variant === TrainerVariant.DOUBLE && this.partnerConfig && !this.config.doubleOnly
        ? requestedVariant === TrainerVariant.FEMALE && this.config.hasGenders
          ? TrainerVariant.FEMALE
          : TrainerVariant.DEFAULT
        : this.variant;
    this.partnerVariant =
      partnerVariant
      ?? (this.partnerConfig?.hasGenders
        ? this.partnerConfig === this.config
          ? requestedVariant === TrainerVariant.FEMALE
            ? TrainerVariant.DEFAULT
            : TrainerVariant.FEMALE
          : randSeedInt(2)
            ? TrainerVariant.FEMALE
            : TrainerVariant.DEFAULT
        : TrainerVariant.DEFAULT);
    this.partnerVariant2 =
      partnerVariant2
      ?? (this.partnerConfig2?.hasGenders
        ? randSeedInt(2)
          ? TrainerVariant.FEMALE
          : TrainerVariant.DEFAULT
        : TrainerVariant.DEFAULT);
    this.partyTemplateIndex = Math.min(
      partyTemplateIndex === undefined ? randSeedItem(this.config.partyTemplates.map((_, i) => i)) : partyTemplateIndex,
      this.config.partyTemplates.length - 1,
    );
    // TODO: Rework this and add actual error handling for missing names
    const classKey = `trainersCommon:${toCamelCase(TrainerType[trainerType])}`;
    if (i18next.exists(classKey, { returnObjects: true })) {
      if (nameKey) {
        this.nameKey = nameKey;
        this.name = i18next.t(nameKey);
      } else {
        const genderKey = i18next.exists(`${classKey}.male`)
          ? this.trainerVariant === TrainerVariant.FEMALE
            ? ".female"
            : ".male"
          : "";
        [this.nameKey, this.name] = getRandomLocaleEntry(`${classKey}${genderKey}`);
      }

      if (this.variant === TrainerVariant.DOUBLE) {
        if (this.config.doubleOnly) {
          if (partnerNameKey) {
            this.partnerNameKey = partnerNameKey;
            this.partnerName = i18next.t(this.partnerNameKey);
          } else {
            [this.name, this.partnerName] = this.name.split(" & ");
          }
        } else if (this.partnerConfig && this.partnerConfig !== this.config) {
          if (partnerNameKey) {
            this.partnerNameKey = partnerNameKey;
            this.partnerName = i18next.t(this.partnerNameKey);
          } else {
            const partnerClassKey = `trainersCommon:${toCamelCase(TrainerType[this.partnerConfig.trainerType])}`;
            if (i18next.exists(partnerClassKey, { returnObjects: true })) {
              const partnerGenderKey = i18next.exists(`${partnerClassKey}.male`)
                ? this.partnerVariant === TrainerVariant.FEMALE
                  ? ".female"
                  : ".male"
                : "";
              [this.partnerNameKey, this.partnerName] = getRandomLocaleEntry(`${partnerClassKey}${partnerGenderKey}`);
            } else {
              this.partnerName = this.partnerConfig.getTitle(TrainerSlot.TRAINER, TrainerVariant.DEFAULT);
            }
          }
        } else {
          const partnerGenderKey = i18next.exists(`${classKey}.male`)
            ? this.partnerVariant === TrainerVariant.FEMALE
              ? ".female"
              : ".male"
            : i18next.exists(`${classKey}.female`)
              ? ".female"
              : "";
          [this.partnerNameKey, this.partnerName] = getRandomLocaleEntry(`${classKey}${partnerGenderKey}`);
        }
      }

      if (this.variant === TrainerVariant.DOUBLE && this.partnerConfig2 && !this.config.doubleOnly) {
        if (partnerNameKey2) {
          this.partnerNameKey2 = partnerNameKey2;
          this.partnerName2 = i18next.t(this.partnerNameKey2);
        } else if (this.partnerConfig2 === this.config) {
          const partnerGenderKey = i18next.exists(`${classKey}.male`)
            ? this.partnerVariant2 === TrainerVariant.FEMALE
              ? ".female"
              : ".male"
            : i18next.exists(`${classKey}.female`)
              ? ".female"
              : "";
          [this.partnerNameKey2, this.partnerName2] = getRandomLocaleEntry(`${classKey}${partnerGenderKey}`);
        } else {
          const partnerClassKey = `trainersCommon:${toCamelCase(TrainerType[this.partnerConfig2.trainerType])}`;
          if (i18next.exists(partnerClassKey, { returnObjects: true })) {
            const partnerGenderKey = i18next.exists(`${partnerClassKey}.male`)
              ? this.partnerVariant2 === TrainerVariant.FEMALE
                ? ".female"
                : ".male"
              : "";
            [this.partnerNameKey2, this.partnerName2] = getRandomLocaleEntry(`${partnerClassKey}${partnerGenderKey}`);
          } else {
            this.partnerName2 = this.partnerConfig2.getTitle(TrainerSlot.TRAINER, TrainerVariant.DEFAULT);
          }
        }
      }
    }

    const getSprite = (config: TrainerConfig, variant: TrainerVariant, hasShadow?: boolean) => {
      const ret = globalScene.addFieldSprite(
        0,
        0,
        config.getSpriteKey(variant === TrainerVariant.FEMALE, this.isDouble()),
      );
      ret.setOrigin(0.5, 1);
      ret.setPipeline(globalScene.spritePipeline, {
        tone: [0.0, 0.0, 0.0, 0.0],
        hasShadow: !!hasShadow,
      });
      return ret;
    };

    const sprite = getSprite(
      this.config,
      this.trainerVariant === TrainerVariant.FEMALE ? TrainerVariant.FEMALE : TrainerVariant.DEFAULT,
      true,
    );
    const tintSprite = getSprite(
      this.config,
      this.trainerVariant === TrainerVariant.FEMALE ? TrainerVariant.FEMALE : TrainerVariant.DEFAULT,
    );

    tintSprite.setVisible(false);

    this.add(sprite);
    this.add(tintSprite);

    if (this.variant === TrainerVariant.DOUBLE && !this.config.doubleOnly) {
      const spriteConfig = this.partnerConfig ?? this.config;
      const partnerSprite = getSprite(spriteConfig, this.partnerVariant, true);
      const partnerTintSprite = getSprite(spriteConfig, this.partnerVariant);
      const partner2Sprite = this.partnerConfig2
        ? getSprite(this.partnerConfig2, this.partnerVariant2, true)
        : undefined;
      const partner2TintSprite = this.partnerConfig2 ? getSprite(this.partnerConfig2, this.partnerVariant2) : undefined;

      partnerTintSprite.setVisible(false);
      partner2TintSprite?.setVisible(false);

      const hasSecondPartner = !!partner2Sprite && !!partner2TintSprite;
      sprite.x = hasSecondPartner ? -28 : -4;
      tintSprite.x = sprite.x;
      partnerSprite.x = hasSecondPartner ? 0 : 28;
      partnerTintSprite.x = partnerSprite.x;

      this.add(partnerSprite);
      this.add(partnerTintSprite);
      if (partner2Sprite && partner2TintSprite) {
        partner2Sprite.x = 28;
        partner2TintSprite.x = 28;
        this.add(partner2Sprite);
        this.add(partner2TintSprite);
      }
    }
  }

  getKey(forceFemale?: boolean): string {
    if (forceFemale && this.variant === TrainerVariant.DOUBLE && !this.config.doubleOnly) {
      return (this.partnerConfig ?? this.config).getSpriteKey(
        this.partnerVariant === TrainerVariant.FEMALE,
        this.isDouble(),
      );
    }
    return this.config.getSpriteKey(this.trainerVariant === TrainerVariant.FEMALE || forceFemale, this.isDouble());
  }

  private getConfigForTrainerSlot(trainerSlot: TrainerSlot): TrainerConfig {
    switch (trainerSlot) {
      case TrainerSlot.TRAINER_PARTNER:
        return this.partnerConfig ?? this.config;
      case TrainerSlot.TRAINER_PARTNER_2:
        return this.partnerConfig2 ?? this.partnerConfig ?? this.config;
      default:
        return this.config;
    }
  }

  private getVariantForTrainerSlot(trainerSlot: TrainerSlot): TrainerVariant {
    switch (trainerSlot) {
      case TrainerSlot.TRAINER_PARTNER:
        return this.partnerVariant;
      case TrainerSlot.TRAINER_PARTNER_2:
        return this.partnerVariant2;
      default:
        return this.trainerVariant === TrainerVariant.FEMALE ? TrainerVariant.FEMALE : TrainerVariant.DEFAULT;
    }
  }

  private getNameOverrideForTrainerSlot(trainerSlot: TrainerSlot): string | undefined {
    switch (trainerSlot) {
      case TrainerSlot.TRAINER_PARTNER:
        return this.partnerName;
      case TrainerSlot.TRAINER_PARTNER_2:
        return this.partnerName2;
      default:
        return this.name;
    }
  }

  private getTrainerPartyConfigs(): { config: TrainerConfig; trainerSlot: TrainerSlot }[] {
    const ret = [{ config: this.config, trainerSlot: TrainerSlot.TRAINER }];
    if (this.partnerConfig) {
      ret.push({ config: this.partnerConfig, trainerSlot: TrainerSlot.TRAINER_PARTNER });
    }
    if (globalScene.getBattleFieldSlotCount() > 2 && this.partnerConfig2) {
      ret.push({ config: this.partnerConfig2, trainerSlot: TrainerSlot.TRAINER_PARTNER_2 });
    }
    return ret;
  }

  private getSpriteKeyForIndex(spriteIndex: number): string {
    const trainerSlot =
      spriteIndex === 1
        ? TrainerSlot.TRAINER_PARTNER
        : spriteIndex === 2
          ? TrainerSlot.TRAINER_PARTNER_2
          : TrainerSlot.TRAINER;
    const config = this.getConfigForTrainerSlot(trainerSlot);
    const variant = this.getVariantForTrainerSlot(trainerSlot);
    return config.getSpriteKey(variant === TrainerVariant.FEMALE, this.isDouble());
  }

  /**
   * Returns the name of the trainer based on the provided trainer slot and the option to include a title.
   * @param trainerSlot - The slot to determine which name to use; default `TrainerSlot.NONE`
   * @param includeTitle - Whether to include the title in the returned name; default `false`
   * @returns - The formatted name of the trainer
   */
  getName(trainerSlot: TrainerSlot = TrainerSlot.NONE, includeTitle = false): string {
    if (
      this.variant === TrainerVariant.DOUBLE
      && ((this.partnerConfig && this.partnerConfig !== this.config)
        || (this.partnerConfig2 && this.partnerConfig2 !== this.config))
    ) {
      const getConfigName = (config: TrainerConfig, nameOverride: string | undefined, slot: TrainerSlot) => {
        const name = nameOverride || config.getTitle(slot, TrainerVariant.DEFAULT);
        let title = includeTitle && config.title ? config.title : null;

        if (nameOverride && includeTitle) {
          title = i18next.t(`trainerClasses:${toCamelCase(config.getTitle(slot, TrainerVariant.DEFAULT))}`);
        }

        return title ? `${title} ${name}` : name;
      };

      if (trainerSlot === TrainerSlot.TRAINER) {
        return getConfigName(this.config, this.name, TrainerSlot.TRAINER);
      }
      if (trainerSlot === TrainerSlot.TRAINER_PARTNER) {
        return getConfigName(this.partnerConfig ?? this.config, this.partnerName, TrainerSlot.TRAINER);
      }
      if (trainerSlot === TrainerSlot.TRAINER_PARTNER_2) {
        return getConfigName(
          this.partnerConfig2 ?? this.partnerConfig ?? this.config,
          this.partnerName2 ?? this.partnerName,
          TrainerSlot.TRAINER,
        );
      }

      const names = [getConfigName(this.config, this.name, TrainerSlot.TRAINER)];
      if (this.partnerConfig) {
        names.push(getConfigName(this.partnerConfig, this.partnerName, TrainerSlot.TRAINER));
      }
      if (this.partnerConfig2) {
        names.push(getConfigName(this.partnerConfig2, this.partnerName2, TrainerSlot.TRAINER));
      }
      return names.join(" & ");
    }
    if (
      this.partnerConfig === this.config
      && this.variant === TrainerVariant.DOUBLE
      && !this.config.doubleOnly
      && trainerSlot === TrainerSlot.NONE
      && this.config.title === i18next.t("titles:rival")
    ) {
      return `${includeTitle ? "Rivals " : ""}${this.name} & ${this.partnerName || this.name}`;
    }

    // Get the base title based on the trainer slot and variant.
    let name = this.config.getTitle(trainerSlot, this.variant);

    // Determine the title to include based on the configuration and includeTitle flag.
    let title = includeTitle && this.config.title ? this.config.title : null;
    const evilTeamTitles = ["grunt"];
    if (this.name === "" && evilTeamTitles.some(t => name.toLocaleLowerCase().includes(t))) {
      // This is a evil team grunt so we localize it by only using the "name" as the title
      title = i18next.t(`trainerClasses:${toCamelCase(name)}`);
      console.log("Localized grunt name: " + title);
      // Since grunts are not named we can just return the title
      return title;
    }

    // If the trainer has a name (not null or undefined).
    if (this.name) {
      // If the title should be included.
      if (includeTitle) {
        // Get the localized trainer class name from the i18n file and set it as the title.
        // This is used for trainer class names, not titles like "Elite Four, Champion, etc."
        title = i18next.t(`trainerClasses:${toCamelCase(name)}`);
      }

      // If no specific trainer slot is set.
      if (trainerSlot) {
        // Assign the name based on the trainer slot:
        // Use the matching partner name if the slot has one.
        name = this.getNameOverrideForTrainerSlot(trainerSlot) || this.name;
      } else {
        // Use the trainer's name.
        name = this.name;
        // If there is a partner name, concatenate it with the trainer's name using "&".
        if (this.partnerName) {
          name = `${name} & ${this.partnerName}`;
        }
        if (this.partnerName2) {
          name = `${name} & ${this.partnerName2}`;
        }
      }
    }

    if (this.config.titleDouble && this.variant === TrainerVariant.DOUBLE && !this.config.doubleOnly) {
      title = this.config.titleDouble;
      name = i18next.t(`trainerNames:${toCamelCase(this.config.nameDouble)}`);
    }

    console.log(title ? `${title} ${name}` : name);

    // Return the formatted name, including the title if it is set.
    return title ? `${title} ${name}` : name;
  }

  isDouble(): boolean {
    return this.config.doubleOnly || this.variant === TrainerVariant.DOUBLE;
  }

  /**
   * Return whether the trainer is a duo, like Tate & Liza
   */
  isPartner(): boolean {
    return this.variant === TrainerVariant.DOUBLE;
  }

  getMixedBattleBgm(): string {
    return this.config.mixedBattleBgm;
  }

  getBattleBgm(): string {
    return this.config.battleBgm;
  }

  getEncounterBgm(): string {
    return this.variant
      ? (this.variant === TrainerVariant.DOUBLE ? this.config.doubleEncounterBgm : this.config.femaleEncounterBgm)
          || this.config.encounterBgm
      : this.config.encounterBgm;
  }

  getEncounterMessages(): string[] {
    return this.variant
      ? (this.variant === TrainerVariant.DOUBLE
          ? this.config.doubleEncounterMessages
          : this.config.femaleEncounterMessages) || this.config.encounterMessages
      : this.config.encounterMessages;
  }

  getVictoryMessages(): string[] {
    return this.variant
      ? (this.variant === TrainerVariant.DOUBLE ? this.config.doubleVictoryMessages : this.config.femaleVictoryMessages)
          || this.config.victoryMessages
      : this.config.victoryMessages;
  }

  getDefeatMessages(): string[] {
    return this.variant
      ? (this.variant === TrainerVariant.DOUBLE ? this.config.doubleDefeatMessages : this.config.femaleDefeatMessages)
          || this.config.defeatMessages
      : this.config.defeatMessages;
  }

  getPartyTemplate(config: TrainerConfig = this.config): TrainerPartyTemplate {
    if (config.partyTemplateFunc) {
      return config.partyTemplateFunc();
    }
    return config.partyTemplates[Math.min(this.partyTemplateIndex, config.partyTemplates.length - 1)];
  }

  private shouldUseTwoPlayerNamedPartnerParty(): boolean {
    return !!(
      globalScene.twoPlayerMode
      && globalScene.twoPlayerPartySize === 6
      && this.getTrainerPartyConfigs().length > 1
      && this.isDouble()
      && !this.config.doubleOnly
    );
  }

  private shouldUseTwoPlayerDoubleOnlyScaledParty(): boolean {
    return !!(
      globalScene.twoPlayerMode
      && globalScene.twoPlayerPartySize === 6
      && this.config.doubleOnly
      && this.isDouble()
    );
  }

  private shouldUseTateLizaPairParty(): boolean {
    return !!(
      globalScene.getBattleFieldSlotCount() < 3
      && this.isDouble()
      && !this.config.doubleOnly
      && isTateLizaDoubleConfig(this.config)
    );
  }

  private getTwoPlayerDoubleOnlyPartyMemberFuncIndex(index: number): number | undefined {
    if (!this.shouldUseTwoPlayerDoubleOnlyScaledParty()) {
      return;
    }

    const sideIndex = index % globalScene.getBattleFieldSlotCount();
    return Object.hasOwn(this.config.partyMemberFuncs, sideIndex) ? sideIndex : undefined;
  }

  private getPartyMemberSeedIndex(index: number): number {
    if (!this.config.useSameSeedForAllMembers) {
      return index;
    }

    return this.shouldUseTwoPlayerDoubleOnlyScaledParty()
      ? Math.floor(index / globalScene.getBattleFieldSlotCount())
      : 0;
  }

  private getPartyLevelsForConfig(config: TrainerConfig, waveIndex: number, minimumPartySize = 0): number[] {
    const ret: number[] = [];
    const partyTemplate = this.getPartyTemplate(config);

    const difficultyWaveIndex = globalScene.gameMode.getWaveForDifficulty(waveIndex);
    const baseLevel = 1 + difficultyWaveIndex / 2 + Math.pow(difficultyWaveIndex / 25, 2);

    if (minimumPartySize > 0 && partyTemplate.size < minimumPartySize) {
      partyTemplate.size = minimumPartySize;
    }

    for (let i = 0; i < partyTemplate.size; i++) {
      let multiplier = 1;

      const strength = partyTemplate.getStrength(i);

      switch (strength) {
        case PartyMemberStrength.WEAKER:
          multiplier = 0.95;
          break;
        case PartyMemberStrength.WEAK:
          multiplier = 1.0;
          break;
        case PartyMemberStrength.AVERAGE:
          multiplier = 1.1;
          break;
        case PartyMemberStrength.STRONG:
          multiplier = 1.2;
          break;
        case PartyMemberStrength.STRONGER:
          multiplier = 1.25;
          break;
      }

      let levelOffset = 0;

      if (strength < PartyMemberStrength.STRONG) {
        multiplier = Math.min(multiplier + 0.025 * Math.floor(difficultyWaveIndex / 25), 1.2);
        levelOffset = -Math.floor((difficultyWaveIndex / 50) * (PartyMemberStrength.STRONG - strength));
      }

      const level = Math.ceil(baseLevel * multiplier) + levelOffset;
      ret.push(level);
    }

    return ret;
  }

  getPartyLevels(waveIndex: number): number[] {
    if (this.shouldUseTateLizaPairParty()) {
      const levels = this.getPartyLevelsForConfig(this.config, waveIndex, 2);
      const targetSize = getTateLizaPairCountForWave(waveIndex) * 2;

      return Array.from({ length: targetSize }, (_, i) => levels[Math.min(i, levels.length - 1)] ?? 1);
    }

    if (this.shouldUseTwoPlayerNamedPartnerParty()) {
      const levelSets = this.getTrainerPartyConfigs().map(({ config }) =>
        this.getPartyLevelsForConfig(config, waveIndex),
      );
      const ret: number[] = [];
      const totalSize = Math.max(...levelSets.map(levels => levels.length));

      for (let i = 0; i < totalSize; i++) {
        for (const levels of levelSets) {
          if (i < levels.length) {
            ret.push(levels[i]);
          }
        }
      }

      return ret;
    }

    return this.getPartyLevelsForConfig(
      this.config,
      waveIndex,
      this.isDouble() ? globalScene.getBattleFieldSlotCount() : 0,
    );
  }

  public getTrainerSlotForPartyIndex(index: number): TrainerSlot {
    if (this.shouldUseTwoPlayerNamedPartnerParty() && !this.shouldUseTateLizaPairParty()) {
      return this.getTwoPlayerNamedPartnerPartySlot(index).trainerSlot;
    }

    return this.isDouble()
      ? getTrainerSlotForFieldIndex(index % globalScene.currentBattle.getBattlerCount())
      : TrainerSlot.TRAINER;
  }

  private getTwoPlayerNamedPartnerPartySlot(index: number): {
    config: TrainerConfig;
    partyIndex: number;
    trainerSlot: TrainerSlot;
  } {
    const trainerConfigs = this.getTrainerPartyConfigs();
    const partySizes = trainerConfigs.map(({ config }) => this.getPartyTemplate(config).size);
    const totalSize = Math.max(...partySizes);
    let battleIndex = 0;

    for (let partyIndex = 0; partyIndex < totalSize; partyIndex++) {
      for (let trainerIndex = 0; trainerIndex < trainerConfigs.length; trainerIndex++) {
        if (partyIndex < partySizes[trainerIndex]) {
          if (battleIndex === index) {
            return { ...trainerConfigs[trainerIndex], partyIndex };
          }
          battleIndex++;
        }
      }
    }

    return { config: this.config, partyIndex: index, trainerSlot: TrainerSlot.TRAINER };
  }

  genPartyMember(index: number): EnemyPokemon {
    if (this.shouldUseTwoPlayerNamedPartnerParty() && !this.shouldUseTateLizaPairParty()) {
      const { config, partyIndex, trainerSlot } = this.getTwoPlayerNamedPartnerPartySlot(index);
      return this.genPartyMemberForConfig(config, partyIndex, trainerSlot, index);
    }

    const battle = globalScene.currentBattle;
    const level = battle.enemyLevels?.[index]!; // TODO: is this bang correct?

    let ret: EnemyPokemon;

    globalScene.executeWithSeedOffset(
      () => {
        const template = this.getPartyTemplate();
        const strength: PartyMemberStrength = template.getStrength(index);
        const doubleOnlyPartyMemberFuncIndex = this.getTwoPlayerDoubleOnlyPartyMemberFuncIndex(index);

        // If the battle is not one of the named trainer doubles
        if (!(this.config.trainerTypeDouble && this.isDouble() && !this.config.doubleOnly)) {
          if (doubleOnlyPartyMemberFuncIndex !== undefined) {
            ret = this.config.partyMemberFuncs[doubleOnlyPartyMemberFuncIndex](level, strength);
            return;
          }
          if (Object.hasOwn(this.config.partyMemberFuncs, index)) {
            ret = this.config.partyMemberFuncs[index](level, strength);
            return;
          }
          if (Object.hasOwn(this.config.partyMemberFuncs, index - template.size)) {
            ret = this.config.partyMemberFuncs[index - template.size](level, template.getStrength(index));
            return;
          }
        }
        let offset = 0;

        if (template instanceof TrainerPartyCompoundTemplate) {
          for (const innerTemplate of template.templates) {
            if (offset + innerTemplate.size > index) {
              break;
            }
            offset += innerTemplate.size;
          }
        }

        // Create an empty species pool (which will be set to one of the species pools based on the index)
        let newSpeciesPool: SpeciesId[] = [];
        let useNewSpeciesPool = false;

        // If we are in a double battle of named trainers, we need to use alternate species pools (generate half the party from each trainer)
        if (this.config.trainerTypeDouble && this.isDouble() && !this.config.doubleOnly) {
          // Use the new species pool for this party generation
          useNewSpeciesPool = true;

          const tateLizaPair = this.shouldUseTateLizaPairParty()
            ? getTateLizaPairForPartyIndex(index, globalScene.currentBattle.waveIndex, battle.enemyParty)
            : undefined;

          if (tateLizaPair) {
            const trainerType = index % 2 ? this.config.trainerTypeDouble : this.config.trainerType;
            newSpeciesPool = [getTateLizaSpeciesForTrainer(tateLizaPair, trainerType)];
          } else {
            // Get the species pool for the partner trainer and the current trainer
            const speciesPoolPartner = signatureSpecies[TrainerType[this.config.trainerTypeDouble]];
            const speciesPool = signatureSpecies[TrainerType[this.config.trainerType]];

            // Get the species that are already in the enemy party so we dont generate the same species twice
            const AlreadyUsedSpecies = battle.enemyParty.map(p => p.species.speciesId);

            // Filter out the species that are already in the enemy party from the main trainer species pool
            const speciesPoolFiltered = speciesPool
              .filter(species => {
                // Since some species pools have arrays in them (use either of those species), we need to check if one of the species is already in the party and filter the whole array if it is
                if (Array.isArray(species)) {
                  return !species.some(s => AlreadyUsedSpecies.includes(s));
                }
                return !AlreadyUsedSpecies.includes(species);
              })
              .flat();

            // Filter out the species that are already in the enemy party from the partner trainer species pool
            const speciesPoolPartnerFiltered = speciesPoolPartner
              .filter(species => {
                // Since some species pools have arrays in them (use either of those species), we need to check if one of the species is already in the party and filter the whole array if it is
                if (Array.isArray(species)) {
                  return !species.some(s => AlreadyUsedSpecies.includes(s));
                }
                return !AlreadyUsedSpecies.includes(species);
              })
              .flat();

            // If the index is even, use the species pool for the main trainer (that way he only uses his own pokemon in battle)
            if (index % 2) {
              // If the index is odd, use the species pool for the partner trainer (that way he only uses his own pokemon in battle)
              newSpeciesPool = speciesPoolPartnerFiltered;
            } else {
              newSpeciesPool = speciesPoolFiltered;
            }
          }

          // Fallback for when the species pool is empty
          if (newSpeciesPool.length === 0) {
            // If all pokemon from this pool are already in the party, generate a random species
            useNewSpeciesPool = false;
          }
        }

        // If useNewSpeciesPool is true, we need to generate a new species from the new species pool, otherwise we generate a random species
        let species = useNewSpeciesPool
          ? // TODO: should this use `randSeedItem`?
            getPokemonSpecies(newSpeciesPool[Math.floor(randSeedInt(newSpeciesPool.length))])
          : template.isSameSpecies(index) && index > offset
            ? getPokemonSpecies(
                battle.enemyParty[offset].species.getTrainerSpeciesForLevel(
                  level,
                  false,
                  template.getStrength(offset),
                  template.evoLevelThresholdKind,
                ),
              )
            : this.genNewPartyMemberSpecies(level, strength);

        // If the species is from newSpeciesPool, we need to adjust it based on the level and strength
        if (newSpeciesPool) {
          species = getPokemonSpecies(
            species.getSpeciesForLevel(level, true, true, strength, template.evoLevelThresholdKind),
          );
        }

        ret = globalScene.addEnemyPokemon(
          species,
          level,
          this.isDouble()
            ? getTrainerSlotForFieldIndex(index % globalScene.currentBattle.getBattlerCount())
            : TrainerSlot.TRAINER,
        );
      },
      this.config.hasStaticParty
        ? this.config.getDerivedType()
            + (((this.shouldUseTateLizaPairParty() ? Math.floor(index / 2) : index) + 1) << 8)
        : globalScene.currentBattle.waveIndex
            + (this.config.getDerivedType() << 10)
            + ((this.getPartyMemberSeedIndex(index) + 1) << 8),
    );

    return ret!; // TODO: is this bang correct?
  }

  private genPartyMemberForConfig(
    config: TrainerConfig,
    index: number,
    trainerSlot: TrainerSlot,
    battlePartyIndex: number,
  ): EnemyPokemon {
    const battle = globalScene.currentBattle;
    const level = battle.enemyLevels?.[battlePartyIndex]!;

    let ret: EnemyPokemon;

    globalScene.executeWithSeedOffset(
      () => {
        const template = this.getPartyTemplate(config);
        const strength = template.getStrength(index);
        const generationContext = `${TrainerType[config.trainerType]}:${TrainerSlot[trainerSlot]}`;

        if (Object.hasOwn(config.partyMemberFuncs, index)) {
          ret = withRivalRollContext(generationContext, () => config.partyMemberFuncs[index](level, strength));
          ret.trainerSlot = trainerSlot;
          return;
        }
        if (Object.hasOwn(config.partyMemberFuncs, index - template.size)) {
          ret = withRivalRollContext(generationContext, () =>
            config.partyMemberFuncs[index - template.size](level, template.getStrength(index)),
          );
          ret.trainerSlot = trainerSlot;
          return;
        }

        let offset = 0;

        if (template instanceof TrainerPartyCompoundTemplate) {
          for (const innerTemplate of template.templates) {
            if (offset + innerTemplate.size > index) {
              break;
            }
            offset += innerTemplate.size;
          }
        }

        const species =
          template.isSameSpecies(index) && index > offset
            ? getPokemonSpecies(
                battle.enemyParty[offset].species.getTrainerSpeciesForLevel(
                  level,
                  false,
                  template.getStrength(offset),
                  template.evoLevelThresholdKind,
                ),
              )
            : this.genNewPartyMemberSpecies(level, strength, undefined, config, template);

        ret = globalScene.addEnemyPokemon(species, level, trainerSlot);
      },
      config.hasStaticParty
        ? config.getDerivedType() + ((index + 1) << 8) + getTrainerSlotSeedOffset(trainerSlot)
        : globalScene.currentBattle.waveIndex
            + (config.getDerivedType() << 10)
            + (((config.useSameSeedForAllMembers ? 0 : index) + 1) << 8)
            + getTrainerSlotSeedOffset(trainerSlot),
    );

    return ret!;
  }

  genNewPartyMemberSpecies(
    level: number,
    strength: PartyMemberStrength,
    attempt?: number,
    config: TrainerConfig = this.config,
    template: TrainerPartyTemplate = this.getPartyTemplate(config),
  ): PokemonSpecies {
    const battle = globalScene.currentBattle;
    let baseSpecies: PokemonSpecies;
    if (config.speciesPools) {
      const tierValue = randSeedInt(512);
      let tier: TrainerPoolTier;
      if (tierValue >= 156) {
        tier = TrainerPoolTier.COMMON;
      } else if (tierValue >= 32) {
        tier = TrainerPoolTier.UNCOMMON;
      } else if (tierValue >= 6) {
        tier = TrainerPoolTier.RARE;
      } else if (tierValue >= 1) {
        tier = TrainerPoolTier.SUPER_RARE;
      } else {
        tier = TrainerPoolTier.ULTRA_RARE;
      }
      console.log(TrainerPoolTier[tier]);
      while (!Object.hasOwn(config.speciesPools, tier) || config.speciesPools[tier].length === 0) {
        console.log(
          `Downgraded trainer Pokemon rarity tier from ${TrainerPoolTier[tier]} to ${TrainerPoolTier[tier - 1]}`,
        );
        tier--;
      }
      const tierPool = config.speciesPools[tier];
      let rolledSpecies = randSeedItem(tierPool);
      while (typeof rolledSpecies !== "number") {
        rolledSpecies = randSeedItem(tierPool);
      }
      baseSpecies = getPokemonSpecies(rolledSpecies);
    } else {
      baseSpecies = globalScene.randomSpecies(battle.waveIndex, level, false, config.speciesFilter);
    }

    let ret = getPokemonSpecies(
      baseSpecies.getTrainerSpeciesForLevel(level, true, strength, template.evoLevelThresholdKind),
    );
    let retry = false;

    console.log(ret.getName());

    if (speciesDataRegistry.hasPrevolution(baseSpecies.speciesId) && ret.speciesId !== baseSpecies.speciesId) {
      retry = true;
    } else if (template.isBalanced(battle.enemyParty.length)) {
      const partyMemberTypes = battle.enemyParty.flatMap(p => p.getTypes());
      if (
        partyMemberTypes.indexOf(ret.type1) > -1
        || (ret.type2 !== null && partyMemberTypes.indexOf(ret.type2) > -1)
      ) {
        retry = true;
      }
    }

    // Prompts reroll of party member species if doesn't fit specialty type.
    // Can be removed by adding a type parameter to getTrainerSpeciesForLevel and filtering the list of evolutions for that type.
    if (!retry && config.hasSpecialtyType() && !ret.isOfType(config.specialtyType)) {
      retry = true;
      console.log("Attempting reroll of species evolution to fit specialty type...");
      let evoAttempt = 0;
      while (retry && evoAttempt++ < 10) {
        ret = getPokemonSpecies(
          baseSpecies.getTrainerSpeciesForLevel(level, true, strength, template.evoLevelThresholdKind),
        );
        console.log(ret.name);
        if (ret.isOfType(config.specialtyType)) {
          retry = false;
        }
      }
    }

    // Prompts reroll of party member species if species already present in the enemy party
    if (this.checkDuplicateSpecies(baseSpecies.speciesId, config)) {
      console.log("Duplicate species detected, prompting reroll...");
      retry = true;
    }

    if (retry && (attempt ?? 0) < 10) {
      console.log("Rerolling party member...");
      ret = this.genNewPartyMemberSpecies(level, strength, (attempt ?? 0) + 1, config, template);
    }

    return ret;
  }

  /**
   * Checks if the enemy trainer already has the Pokemon species in their party
   * @param baseSpecies - The base {@linkcode SpeciesId} of the current Pokemon
   * @returns `true` if the species is already present in the party
   */
  checkDuplicateSpecies(baseSpecies: SpeciesId, config: TrainerConfig = this.config): boolean {
    const staticSpecies = (signatureSpecies[TrainerType[config.trainerType]] ?? []).flat(1).map(s => {
      let root = s;
      while (speciesDataRegistry.hasPrevolution(root)) {
        root = speciesDataRegistry.getPrevolution(root)!;
      }
      return root;
    });

    const currentSpecies = globalScene.getEnemyParty().map(p => {
      return p.species.getRootSpeciesId();
    });

    return currentSpecies.includes(baseSpecies) || staticSpecies.includes(baseSpecies);
  }

  getPartyMemberMatchupScores(trainerSlot: TrainerSlot = TrainerSlot.NONE, forSwitch = false): [number, number][] {
    if (trainerSlot && !this.isDouble()) {
      trainerSlot = TrainerSlot.NONE;
    }

    const party = globalScene.getEnemyParty();
    const nonFaintedLegalPartyMembers = party
      .slice(globalScene.currentBattle.getBattlerCount())
      .filter(p => p.isAllowedInBattle())
      .filter(p => !forSwitch || !isMysteryEncounterSwitchProtectedPokemon(p))
      .filter(p => !trainerSlot || p.trainerSlot === trainerSlot);
    const partyMemberScores = nonFaintedLegalPartyMembers.map(p => {
      const playerField = globalScene.getPlayerField().filter(p => p.isAllowedInBattle());
      let score = 0;

      if (playerField.length > 0) {
        for (const playerPokemon of playerField) {
          score += p.getMatchupScore(playerPokemon);
          if (playerPokemon.species.legendary) {
            score /= 2;
          }
        }
        score /= playerField.length;
        if (forSwitch && !p.isOnField()) {
          globalScene.arena
            .findTagsOnSide(t => t instanceof EntryHazardTag, ArenaTagSide.ENEMY)
            .map(t => (score *= (t as EntryHazardTag).getMatchupScoreMultiplier(p)));
        }
      }

      return [party.indexOf(p), score];
    }) as [number, number][];

    return partyMemberScores;
  }

  getSortedPartyMemberMatchupScores(partyMemberScores: [number, number][] = this.getPartyMemberMatchupScores()) {
    const sortedPartyMemberScores = partyMemberScores.slice(0);
    sortedPartyMemberScores.sort((a, b) => {
      const scoreA = a[1];
      const scoreB = b[1];
      return scoreA < scoreB ? 1 : scoreA > scoreB ? -1 : 0;
    });

    return sortedPartyMemberScores;
  }

  getNextSummonIndex(
    trainerSlot: TrainerSlot = TrainerSlot.NONE,
    partyMemberScores: [number, number][] = this.getPartyMemberMatchupScores(trainerSlot),
  ): number {
    if (trainerSlot && !this.isDouble()) {
      trainerSlot = TrainerSlot.NONE;
    }

    const sortedPartyMemberScores = this.getSortedPartyMemberMatchupScores(partyMemberScores);

    const maxScorePartyMemberIndexes = partyMemberScores
      .filter(pms => pms[1] === sortedPartyMemberScores[0][1])
      .map(pms => pms[0]);

    if (maxScorePartyMemberIndexes.length > 1) {
      let rand: number;
      // TODO: should this use `randSeedItem`?

      globalScene.executeWithSeedOffset(
        () => (rand = randSeedInt(maxScorePartyMemberIndexes.length)),
        globalScene.currentBattle.turn << 2,
      );
      return maxScorePartyMemberIndexes[rand!];
    }

    return maxScorePartyMemberIndexes[0];
  }

  getPartyMemberModifierChanceMultiplier(index: number): number {
    switch (this.getPartyTemplate().getStrength(index)) {
      case PartyMemberStrength.WEAKER:
        return 0.75;
      case PartyMemberStrength.WEAK:
        return 0.675;
      case PartyMemberStrength.AVERAGE:
        return 0.5625;
      case PartyMemberStrength.STRONG:
        return 0.45;
      case PartyMemberStrength.STRONGER:
        return 0.375;
      default:
        console.warn("getPartyMemberModifierChanceMultiplier not defined. Using default 0");
        return 0;
    }
  }

  genModifiers(party: readonly EnemyPokemon[]): PersistentModifier[] {
    if (this.shouldUseTwoPlayerNamedPartnerParty()) {
      const ret: PersistentModifier[] = [];

      for (const { config, trainerSlot } of this.getTrainerPartyConfigs()) {
        const trainerParty = party.filter(p => p.trainerSlot === trainerSlot);
        if (config.genModifiersFunc) {
          ret.push(...config.genModifiersFunc(trainerParty));
        }
      }

      return ret;
    }

    if (this.config.genModifiersFunc) {
      return this.config.genModifiersFunc(party);
    }
    return [];
  }

  genAI(party: readonly EnemyPokemon[]) {
    if (this.shouldUseTwoPlayerNamedPartnerParty()) {
      for (const { config, trainerSlot } of this.getTrainerPartyConfigs()) {
        const trainerParty = party.filter(p => p.trainerSlot === trainerSlot);
        config.genAIFuncs?.forEach(f => f(trainerParty));
      }
      console.log("Generated AI funcs");
      return;
    }

    if (this.config.genAIFuncs) {
      this.config.genAIFuncs.forEach(f => f(party));
    }
    console.log("Generated AI funcs");
  }

  loadAssets(): Promise<void> {
    const trainerKeys = Array.from(new Set(this.getSprites().map((_, i) => this.getSpriteKeyForIndex(i))));

    return new Promise(resolve => {
      for (const trainerKey of trainerKeys) {
        globalScene.loadAtlas(trainerKey, "trainer");
      }
      globalScene.load.once(Phaser.Loader.Events.COMPLETE, () => {
        const originalWarn = console.warn;
        console.warn = () => {};
        const frameEntries = trainerKeys.map(trainerKey => ({
          trainerKey,
          frameNames: globalScene.anims.generateFrameNames(trainerKey, {
            zeroPad: 4,
            suffix: ".png",
            start: 1,
            end: 128,
          }),
        }));
        console.warn = originalWarn;

        for (const { trainerKey, frameNames } of frameEntries) {
          if (!globalScene.anims.exists(trainerKey)) {
            globalScene.anims.create({
              key: trainerKey,
              frames: frameNames,
              frameRate: 24,
              repeat: -1,
            });
          }
        }
        resolve();
      });
      if (!globalScene.load.isLoading()) {
        globalScene.load.start();
      }
    });
  }

  initSprite(): void {
    this.getSprites().map((sprite, i) => sprite.setTexture(this.getSpriteKeyForIndex(i)).setFrame(0));
    this.getTintSprites().map((tintSprite, i) => tintSprite.setTexture(this.getSpriteKeyForIndex(i)).setFrame(0));
  }

  /**
   * Attempts to animate a given set of {@linkcode Phaser.GameObjects.Sprite}
   * @see {@linkcode Phaser.GameObjects.Sprite.play}
   * @param sprite {@linkcode Phaser.GameObjects.Sprite} to animate
   * @param tintSprite {@linkcode Phaser.GameObjects.Sprite} placed on top of the sprite to add a color tint
   * @param animConfig {@linkcode Phaser.Types.Animations.PlayAnimationConfig} to pass to {@linkcode Phaser.GameObjects.Sprite.play}
   * @returns true if the sprite was able to be animated
   */
  tryPlaySprite(
    sprite: Phaser.GameObjects.Sprite,
    tintSprite: Phaser.GameObjects.Sprite,
    animConfig: Phaser.Types.Animations.PlayAnimationConfig,
  ): boolean {
    // Show an error in the console if there isn't a texture loaded
    if (sprite.texture.key === "__MISSING") {
      console.error(`No texture found for '${animConfig.key}'!`);

      return false;
    }
    // Don't try to play an animation when there isn't one
    if (sprite.texture.frameTotal <= 1) {
      console.warn(`No animation found for '${animConfig.key}'. Is this intentional?`);

      return false;
    }

    sprite.play(animConfig);
    tintSprite.play(animConfig);

    return true;
  }

  playAnim(): void {
    const sprites = this.getSprites();
    const tintSprites = this.getTintSprites();

    sprites.forEach((sprite, i) => {
      const trainerAnimConfig = {
        key: this.getSpriteKeyForIndex(i),
        repeat: 0,
        startFrame: 0,
      };

      this.tryPlaySprite(sprite, tintSprites[i], trainerAnimConfig);
    });
  }

  getSprites(): Phaser.GameObjects.Sprite[] {
    const ret: Phaser.GameObjects.Sprite[] = [this.getAt(0)];
    if (this.variant === TrainerVariant.DOUBLE && !this.config.doubleOnly) {
      ret.push(this.getAt(2));
      if (this.partnerConfig2) {
        ret.push(this.getAt(4));
      }
    }
    return ret;
  }

  getTintSprites(): Phaser.GameObjects.Sprite[] {
    const ret: Phaser.GameObjects.Sprite[] = [this.getAt(1)];
    if (this.variant === TrainerVariant.DOUBLE && !this.config.doubleOnly) {
      ret.push(this.getAt(3));
      if (this.partnerConfig2) {
        ret.push(this.getAt(5));
      }
    }
    return ret;
  }

  tint(color: number, alpha?: number, duration?: number, ease?: string): void {
    const tintSprites = this.getTintSprites();
    tintSprites.map(tintSprite => {
      tintSprite.setTintFill(color);
      tintSprite.setVisible(true);

      if (duration) {
        tintSprite.setAlpha(0);

        globalScene.tweens.add({
          targets: tintSprite,
          alpha: alpha || 1,
          duration,
          ease: ease || "Linear",
        });
      } else {
        tintSprite.setAlpha(alpha);
      }
    });
  }

  untint(duration: number, ease?: string): void {
    const tintSprites = this.getTintSprites();
    tintSprites.map(tintSprite => {
      if (duration) {
        globalScene.tweens.add({
          targets: tintSprite,
          alpha: 0,
          duration,
          ease: ease || "Linear",
          onComplete: () => {
            tintSprite.setVisible(false);
            tintSprite.setAlpha(1);
          },
        });
      } else {
        tintSprite.setVisible(false);
        tintSprite.setAlpha(1);
      }
    });
  }

  /**
   * Determines whether a Trainer should Terastallize their Pokemon
   * @param pokemon {@linkcode EnemyPokemon} Trainer Pokemon in question
   * @returns boolean Whether the EnemyPokemon should Terastalize this turn
   */
  shouldTera(pokemon: EnemyPokemon): boolean {
    if (
      this.config.trainerAI.teraMode === TeraAIMode.INSTANT_TERA
      && !pokemon.isTerastallized
      && this.config.trainerAI.instantTeras.includes(pokemon.initialTeamIndex)
      && !globalScene.currentBattle.enemyFaintsHistory.some(f => f.pokemon.id === pokemon.id)
    ) {
      return true;
    }
    return false;
  }
}
