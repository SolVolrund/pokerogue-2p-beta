import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId as S } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType as T } from "#enums/trainer-type";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { generateModifierType, initBattleWithEnemyConfig, leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals, type EnemyPartyConfig, type EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import { getMysteryEncounterPlayerIndexes } from "#mystery-encounters/encounter-player-utils";
import { getSpriteKeysFromSpecies } from "#mystery-encounters/encounter-pokemon-utils";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { trainerConfigs } from "#trainers/trainer-config";
import { trainerPartyTemplates } from "#trainers/trainer-party-template";
import { randSeedInt, randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

const ns = "mysteryEncounters/palletExhibition";
const starterPools = [
  [S.CHARMANDER, S.CYNDAQUIL, S.CHIMCHAR, S.TEPIG, S.LITTEN],
  [S.SQUIRTLE, S.TOTODILE, S.OSHAWOTT, S.FROAKIE],
  [S.BULBASAUR, S.CHIKORITA, S.TREECKO, S.TURTWIG, S.SNIVY, S.ROWLET],
] as const;
const companions = [T.MISTY, T.BROCK, T.IRIS, T.CILAN, T.CLEMONT] as const;
type Companion = (typeof companions)[number];
const teams: Record<Companion, S[]> = {
  [T.MISTY]: [S.STARYU, S.PSYDUCK, S.HORSEA],
  [T.BROCK]: [S.ONIX, S.GEODUDE, S.CROAGUNK],
  [T.IRIS]: [S.AXEW, S.DRILBUR, S.EMOLGA],
  [T.CILAN]: [S.PANSAGE, S.DWEBBLE, S.STUNFISK],
  [T.CLEMONT]: [S.BUNNELBY, S.CHESPIN, S.HELIOPTILE],
};

function pickCompanions(players: number): Companion[] {
  if (players === 1) return [];
  const first = randSeedItem(companions);
  if (players === 2) return [first];
  if (randSeedInt(2) === 0) return randSeedInt(2) ? [T.MISTY, T.BROCK] : [T.IRIS, T.CILAN];
  return [first, randSeedItem(companions.filter(other => other !== first))];
}

function partnerCapFormIndex(): number {
  return getPokemonSpecies(S.PIKACHU).forms.findIndex(form => form.formKey === "partner-cap");
}

function buildParty(players: number, level: number): EnemyPartyConfig {
  const recruit = (root: S, slot: TrainerSlot): EnemyPokemonConfig => ({
    species: getPokemonSpecies(getPokemonSpecies(root).getTrainerSpeciesForLevel(level, true, PartyMemberStrength.STRONG)),
    level, trainerSlot: slot, isBoss: false,
  });
  const pikachu = getPokemonSpecies(S.PIKACHU);
  const ace: EnemyPokemonConfig = {
    species: pikachu, level, isBoss: false, trainerSlot: TrainerSlot.TRAINER,
    formIndex: partnerCapFormIndex(),
    modifierConfigs: [
      generateModifierType(modifierTypes.EVIOLITE),
      generateModifierType(modifierTypes.RARE_SPECIES_STAT_BOOSTER, ["LIGHT_BALL"]),
    ].filter((modifier): modifier is PokemonHeldItemModifierType => modifier !== null)
      .map(modifier => ({ modifier, stackCount: 1, isTransferable: false })),
  };
  const roots = [...starterPools.map(pool => randSeedItem<S>(pool)), randSeedItem([S.RIOLU, S.MELTAN, S.MUNCHLAX, S.GASTLY]), S.DRATINI];
  const ash = [ace, ...roots.map(id => recruit(id, TrainerSlot.TRAINER))];
  for (const mon of ash) {
    mon.friendship = 255;
    mon.passive = true;
  }
  // Pick a Pokemon first, then one of its forms, so Charizard's extra forms don't weight the roll.
  for (const tier of [ash.slice(1, 4), ash.slice(4, 5), ash.slice(5)]) {
    const eligible = tier.map(mon => ({ mon, forms: mon.species.forms.map((f, index) => ({ key: f.formKey, index }))
      .filter(f => f.key.startsWith(SpeciesFormKey.MEGA) || f.key === SpeciesFormKey.GIGANTAMAX) }))
      .filter(entry => entry.forms.length);
    if (eligible.length) {
      const { mon, forms } = randSeedItem(eligible);
      mon.formIndex = randSeedItem(forms).index;
      break;
    }
  }

  const friends = pickCompanions(players);
  const slots = [TrainerSlot.TRAINER_PARTNER, TrainerSlot.TRAINER_PARTNER_2];
  const parties = [ash, ...friends.map((id, i) => teams[id].map(root => recruit(root, slots[i])))];
  const configs = friends.map(id => trainerConfigs[id].clone().setPartyTemplateFunc(() => trainerPartyTemplates.THREE_AVG));
  const trainerConfig = trainerConfigs[T.ASH_KETCHUM].clone();
  trainerConfig.victoryMessages = [i18next.t(`${ns}:defeated`)];
  return {
    trainerConfig, female: false, partnerTrainerConfig: configs[0], partnerTrainerConfig2: configs[1],
    pokemonConfigs: ash.flatMap((_, i) => parties.flatMap(party => party[i] ? [party[i]] : [])),
    battlerCountOverride: players, doubleBattle: players > 1,
  };
}

export function createPalletExhibitionParty(): EnemyPartyConfig {
  const battle = globalScene.currentBattle;
  let party!: EnemyPartyConfig;
  globalScene.executeWithSeedOffset(() => {
    party = buildParty(getMysteryEncounterPlayerIndexes().length, battle.getLevelForWave());
  }, battle.waveIndex);
  return party;
}

export const PalletExhibitionEncounter = MysteryEncounterBuilder.withEncounterType(MysteryEncounterType.PALLET_EXHIBITION)
  .withEncounterTier(MysteryEncounterTier.ULTRA)
  .withMaxAllowedEncounters(1)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withTwoPlayerSharedDecision("unanimousHumanYes")
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([{ spriteKey: "ash_ketchum", fileRoot: "trainer", hasShadow: true }])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.spriteConfigs[1] = {
      ...getSpriteKeysFromSpecies(S.PIKACHU, false, partnerCapFormIndex()),
      isPokemon: true, hasShadow: true, repeat: true,
    };
    return true;
  })
  .withIntroDialogue([{ text: `${ns}:intro` }, { text: `${ns}:greeting`, speaker: `${ns}:speaker` }])
  .setLocalizationKey(ns)
  .withTitle(`${ns}:title`)
  .withDescription(`${ns}:description`)
  .withQuery(`${ns}:query`)
  .withRewards(() => {
    if (globalScene.currentBattle.mysteryEncounter?.encounterMode !== MysteryEncounterMode.TRAINER_BATTLE) {
      return false;
    }
    const cap = modifierTypes.PARTNER_CAP();
    for (const player of getMysteryEncounterPlayerIndexes()) {
      const eligible = globalScene.getPlayerParty(player).some(p => cap.selectFilter!(p) === null);
      globalScene.phaseManager.unshiftNew("SelectModifierPhase", 0, undefined, {
        guaranteedModifierTypeFuncs: eligible ? [modifierTypes.PARTNER_CAP] : [],
        guaranteedModifierTiers: [ModifierTier.MASTER],
        forcedModifierTier: ModifierTier.ROGUE,
        fillRemaining: true,
        allowLuckUpgrades: false,
        allowBonusRewards: false,
        rerollMultiplier: -1,
      }, false, player);
    }
    return true;
  })
  .withOption(MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({ buttonLabel: `${ns}:accept`, buttonTooltip: `${ns}:acceptTip`,
      selected: [{ text: `${ns}:accepted`, speaker: `${ns}:speaker` }] })
    .withOptionPhase(async () => {
      await transitionMysteryEncounterIntroVisuals(true, true, 500);
      await initBattleWithEnemyConfig(createPalletExhibitionParty());
    }).build())
  .withOption(MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({ buttonLabel: `${ns}:decline`, buttonTooltip: `${ns}:declineTip`,
      selected: [{ text: `${ns}:declined`, speaker: `${ns}:speaker` }] })
    .withOptionPhase(async () => {
      await transitionMysteryEncounterIntroVisuals(true, true, 500);
      leaveEncounterWithoutBattle();
    }).build())
  .build();
