import type { PlayerIndex } from "#app/battle-scene";
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { LearnMoveType } from "#enums/learn-move-type";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  selectOptionThenPokemon,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import { showEncounterDialogue, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  getMysteryEncounterPlayerIndexes,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { PokemonMove } from "#moves/pokemon-move";
import { getRandomPartyMemberFunc, trainerConfigs } from "#trainers/trainer-config";
import { TrainerPartyTemplate } from "#trainers/trainer-party-template";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { MoveInfoOverlay } from "#ui/move-info-overlay";
import { updateWindowType } from "#ui/ui-theme";
import { getComputerPartnerTeamConfidence } from "#utils/computer-partner-team-confidence";
import { chooseComputerPartnerMoveLearningDecision } from "#utils/computer-partner-move-ai";
import {
  getComputerPartnerProfileWithRolePreferences,
  isComputerPartnerAcePokemon,
} from "#utils/computer-partner-profile";
import { randSeedShuffle } from "#utils/common";
import i18next from "i18next";

const namespace = "mysteryEncounters/chefsOnVacation";

const CHEF_TRAINERS = [TrainerType.CILAN, TrainerType.CHILI, TrainerType.CRESS] as const;
type ChefTrainerType = (typeof CHEF_TRAINERS)[number];

const CHEF_STARTER_POOLS = {
  [TrainerType.CILAN]: [
    SpeciesId.BULBASAUR,
    SpeciesId.CHIKORITA,
    SpeciesId.TREECKO,
    SpeciesId.TURTWIG,
    SpeciesId.SNIVY,
    SpeciesId.CHESPIN,
    SpeciesId.ROWLET,
    SpeciesId.GROOKEY,
    SpeciesId.SPRIGATITO,
  ],
  [TrainerType.CHILI]: [
    SpeciesId.CHARMANDER,
    SpeciesId.CYNDAQUIL,
    SpeciesId.TORCHIC,
    SpeciesId.CHIMCHAR,
    SpeciesId.TEPIG,
    SpeciesId.FENNEKIN,
    SpeciesId.LITTEN,
    SpeciesId.SCORBUNNY,
    SpeciesId.FUECOCO,
  ],
  [TrainerType.CRESS]: [
    SpeciesId.SQUIRTLE,
    SpeciesId.TOTODILE,
    SpeciesId.MUDKIP,
    SpeciesId.PIPLUP,
    SpeciesId.OSHAWOTT,
    SpeciesId.FROAKIE,
    SpeciesId.POPPLIO,
    SpeciesId.SOBBLE,
    SpeciesId.QUAXLY,
  ],
} as const satisfies Record<ChefTrainerType, readonly SpeciesId[]>;

const PLEDGE_TUTOR_MOVES = [MoveId.GRASS_PLEDGE, MoveId.FIRE_PLEDGE, MoveId.WATER_PLEDGE] as const;

type ChefsOnVacationOptionIndex = 1 | 2;

interface ChefsOnVacationChoice {
  playerIndex: PlayerIndex;
  optionIndex: ChefsOnVacationOptionIndex;
}

interface ChefsOnVacationData {
  choices: ChefsOnVacationChoice[];
  chefLineup: ChefTrainerType[];
  computerPartnerChoices?: Partial<Record<PlayerIndex, ChefsOnVacationChoice>>;
  skipSelectedDialogueOnce?: boolean;
}

interface ComputerPartnerPledgeMoveTutorTarget {
  pokemonIndex: number;
  moveOptionIndex: number;
  improvementRatio: number;
  replaceIndex: number;
}

class MultiplayerOnlySceneRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    return globalScene.twoPlayerMode;
  }

  override getDialogueToken(): [string, string] {
    return ["requiredMode", "multiplayer"];
  }
}

export const ChefsOnVacationEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.CHEFS_ON_VACATION,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneRequirement(new MultiplayerOnlySceneRequirement())
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withMaxAllowedEncounters(1)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([])
  .withAutoHideIntroVisuals(false)
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
    {
      speaker: `${namespace}:speaker`,
      text: `${namespace}:introDialogue`,
    },
  ])
  .withOnInit(() => {
    if (!globalScene.twoPlayerMode) {
      return false;
    }

    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const chefLineup = rollChefLineup(getMysteryEncounterPlayerIndexes().length);
    encounter.misc = {
      choices: [],
      chefLineup,
    } satisfies ChefsOnVacationData;
    encounter.spriteConfigs = buildChefIntroSpriteConfigs(chefLineup);
    setChefDialogueTokens(chefLineup);
    encounter.enemyPartyConfigs = [createChefsBattleConfig(chefLineup)];

    return true;
  })
  .setLocalizationKey(namespace)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildChallengeOption(0))
  .withOption(buildRefuseOption(0))
  .withOutroDialogue([
    {
      text: `${namespace}:outro`,
    },
  ])
  .build();

function getChefsOnVacationData(): ChefsOnVacationData {
  return globalScene.currentBattle.mysteryEncounter!.misc as ChefsOnVacationData;
}

function rollChefLineup(playerCount: number): ChefTrainerType[] {
  if (playerCount > 2) {
    return [...CHEF_TRAINERS];
  }

  return randSeedShuffle([...CHEF_TRAINERS]).slice(0, 2);
}

function buildChefIntroSpriteConfigs(chefLineup: ChefTrainerType[]) {
  const offsets = chefLineup.length > 2 ? [-44, 0, 44] : [-26, 26];
  return chefLineup.map((trainerType, index) => ({
    spriteKey: trainerConfigs[trainerType].getSpriteKey(),
    fileRoot: "trainer",
    hasShadow: true,
    disableAnimation: true,
    x: offsets[index] ?? 0,
    y: 5,
    yShadow: 5,
  }));
}

function setChefDialogueTokens(chefLineup: ChefTrainerType[]): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const trainerNames = chefLineup.map(trainerType => trainerConfigs[trainerType].name);
  encounter.setDialogueToken("chefNames", formatNameList(trainerNames));
  encounter.setDialogueToken("partySize", getChefPartySizeForWave(globalScene.currentBattle.waveIndex).toString());
}

function formatNameList(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  if (names.length === 2) {
    return `${names[0] ?? ""} and ${names[1] ?? ""}`;
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

function promptNextChefsPlayer(playerIndex: PlayerIndex, startingCursorIndex = 0): Promise<boolean> {
  return showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: i18next.t(`${namespace}:query`),
    overrideOptions: buildChefsPlayerOptions(playerIndex),
    startingCursorIndex,
    computerPartnerOption: {
      chooseOptionIndex: chooseComputerPartnerChefsOption,
      onOptionChosen: (_optionIndex, choicePlayerIndex) => collectComputerPartnerChefsChoice(choicePlayerIndex),
    },
  }).then(result => result ?? false);
}

function buildChefsPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [buildChallengeOption(playerIndex), buildRefuseOption(playerIndex)];
}

function buildChallengeOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [
        {
          text: `${namespace}:option.1.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeChefsChoice({ playerIndex, optionIndex: 1 }, 0))
    .withOptionPhase(runChefsChoices)
    .build();
}

function buildRefuseOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [
        {
          text: `${namespace}:option.2.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeChefsChoice({ playerIndex, optionIndex: 2 }, 1))
    .withOptionPhase(runChefsChoices)
    .build();
}

async function storeChefsChoice(choice: ChefsOnVacationChoice, startingCursorIndex: number): Promise<boolean> {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  globalScene.setActivePlayerIndex(choice.playerIndex);
  updateWindowType(choice.playerIndex + 1);

  const data = getChefsOnVacationData();
  data.choices = data.choices.filter(existing => existing.playerIndex !== choice.playerIndex);
  data.choices.push(choice);

  if (globalScene.isComputerPartnerPlayer(choice.playerIndex)) {
    queueComputerPartnerChefsChoiceMessage(choice);
  }

  const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(choice.playerIndex);
  if (nextPlayerIndex != null) {
    return promptNextChefsPlayer(nextPlayerIndex, startingCursorIndex);
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

function chooseComputerPartnerChefsChoice(playerIndex: PlayerIndex): ChefsOnVacationChoice {
  const confidence = getComputerPartnerTeamConfidence(globalScene.getPlayerParty(playerIndex));
  return {
    playerIndex,
    optionIndex: confidence.level === "medium" || confidence.level === "high" ? 1 : 2,
  };
}

function chooseComputerPartnerChefsOption(playerIndex: PlayerIndex): ChefsOnVacationOptionIndex {
  const data = getChefsOnVacationData();
  const choice = chooseComputerPartnerChefsChoice(playerIndex);
  data.computerPartnerChoices = {
    ...(data.computerPartnerChoices ?? {}),
    [playerIndex]: choice,
  };
  return choice.optionIndex;
}

function collectComputerPartnerChefsChoice(playerIndex: PlayerIndex): Promise<boolean> {
  const data = getChefsOnVacationData();
  const choice = data.computerPartnerChoices?.[playerIndex] ?? chooseComputerPartnerChefsChoice(playerIndex);
  return storeChefsChoice(choice, choice.optionIndex - 1);
}

function queueComputerPartnerChefsChoiceMessage(choice: ChefsOnVacationChoice): void {
  const profile = getComputerPartnerProfileForChefs(choice.playerIndex);
  const optionLabel = i18next.t(`${namespace}:option.${choice.optionIndex}.label`);
  globalScene.waitForPlayerInput(0);
  globalScene.phaseManager.queueMessage(`${profile.name}: Chose ${optionLabel}.`, null, true);
}

async function runChefsChoices(): Promise<boolean> {
  const choices = getChefsOnVacationData().choices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  const battleChoices = choices.filter(choice => choice.optionIndex === 1);

  for (const choice of choices) {
    await showChefsSelectedDialogue(choice);
  }

  if (battleChoices.length === 0) {
    globalScene.waitForPlayerInput(0);
    leaveEncounterWithoutBattle(false);
    return true;
  }

  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.onRewards = async () => {
    for (const choice of battleChoices) {
      await doPledgeMoveTutor(choice.playerIndex);
    }
    encounter.onRewards = undefined;
  };

  const battlePlayers = battleChoices.map(choice => choice.playerIndex);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(battlePlayers);
  globalScene.waitForPlayerInput(0);
  await transitionMysteryEncounterIntroVisuals(true, true);
  await initBattleWithEnemyConfig(createChefsBattleConfig(getChefsOnVacationData().chefLineup, battleChoices.length));
  return true;
}

async function showChefsSelectedDialogue(choice: ChefsOnVacationChoice): Promise<void> {
  globalScene.setActivePlayerIndex(choice.playerIndex);
  updateWindowType(choice.playerIndex + 1);
  await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);
}

function createChefsBattleConfig(chefLineup: ChefTrainerType[], trainerCount = chefLineup.length): EnemyPartyConfig {
  const trainerTypes = chefLineup.slice(0, Math.max(1, trainerCount));
  const config: EnemyPartyConfig = {
    trainerConfig: getChefTrainerConfig(trainerTypes[0]!, TrainerSlot.TRAINER),
    female: false,
  };

  if (trainerTypes.length > 1) {
    config.partnerTrainerConfig = getChefTrainerConfig(trainerTypes[1]!, TrainerSlot.TRAINER_PARTNER);
    config.partnerFemale = false;
    config.doubleBattle = true;
    config.forceDoubleBattle = true;
  }

  if (trainerTypes.length > 2) {
    config.partnerTrainerConfig2 = getChefTrainerConfig(trainerTypes[2]!, TrainerSlot.TRAINER_PARTNER_2);
    config.partnerFemale2 = false;
  }

  return config;
}

function getChefTrainerConfig(trainerType: ChefTrainerType, trainerSlot: TrainerSlot) {
  const partySize = getChefPartySizeForWave(globalScene.currentBattle.waveIndex);
  const starterPool = CHEF_STARTER_POOLS[trainerType];
  const config = trainerConfigs[trainerType].clone();
  config.partyMemberFuncs = {};
  config.isBoss = false;
  config.hasStaticParty = false;
  config.hasVoucher = false;
  config.setPartyTemplates(new TrainerPartyTemplate(partySize, PartyMemberStrength.AVERAGE));
  config.setPartyTemplateFunc(() => new TrainerPartyTemplate(partySize, PartyMemberStrength.AVERAGE));

  for (let i = 0; i < partySize; i++) {
    config.setPartyMemberFunc(i, getRandomPartyMemberFunc(starterPool, trainerSlot));
  }

  return config;
}

function getChefPartySizeForWave(waveIndex: number): number {
  if (waveIndex < 20) {
    return 1;
  }
  if (waveIndex < 50) {
    return 2;
  }
  if (waveIndex < 80) {
    return 3;
  }
  if (waveIndex < 110) {
    return 4;
  }
  if (waveIndex < 140) {
    return 5;
  }
  return 6;
}

function getComputerPartnerProfileForChefs(playerIndex: PlayerIndex) {
  return getComputerPartnerProfileWithRolePreferences(
    globalScene.getComputerPartnerKey(playerIndex),
    globalScene.getComputerPartnerRolePreferences(playerIndex),
  );
}

function getBestComputerPartnerPledgeMoveTutorTarget(
  playerIndex: PlayerIndex,
  moveOptions: PokemonMove[],
): ComputerPartnerPledgeMoveTutorTarget | undefined {
  const party = globalScene.getPlayerParty(playerIndex);
  const profile = getComputerPartnerProfileForChefs(playerIndex);
  let bestTarget: ComputerPartnerPledgeMoveTutorTarget | undefined;

  for (const [pokemonIndex, pokemon] of party.entries()) {
    const currentMoveIds = pokemon.getMoveset().map(move => move.moveId);
    const role = isComputerPartnerAcePokemon(pokemon, profile)
      ? "ace"
      : profile.roles[pokemonIndex] ?? "balanced";

    for (const [moveOptionIndex, moveOption] of moveOptions.entries()) {
      const move = allMoves[moveOption.moveId];
      if (currentMoveIds.includes(moveOption.moveId)) {
        continue;
      }

      const decision = chooseComputerPartnerMoveLearningDecision(
        pokemon,
        currentMoveIds,
        move,
        LearnMoveType.TM,
        { profile, role },
      );
      if (!decision.shouldLearn) {
        continue;
      }

      if (
        !bestTarget
        || decision.improvementRatio > bestTarget.improvementRatio
        || (decision.improvementRatio === bestTarget.improvementRatio && decision.replaceIndex < bestTarget.replaceIndex)
      ) {
        bestTarget = {
          pokemonIndex,
          moveOptionIndex,
          improvementRatio: decision.improvementRatio,
          replaceIndex: decision.replaceIndex,
        };
      }
    }
  }

  return bestTarget;
}

function doPledgeMoveTutor(playerIndex: PlayerIndex): Promise<void> {
  // biome-ignore lint/suspicious/noAsyncPromiseExecutor: This mirrors the existing encounter tutor flow around UI callbacks.
  return new Promise<void>(async resolve => {
    const moveOptions = PLEDGE_TUTOR_MOVES.map(moveId => new PokemonMove(moveId));
    globalScene.setActivePlayerIndex(playerIndex);
    updateWindowType(playerIndex + 1);
    globalScene.waitForPlayerInput(globalScene.isComputerPartnerPlayer(playerIndex) ? 0 : playerIndex);
    await showEncounterDialogue(`${namespace}:battleWon`, `${namespace}:speaker`);

    if (globalScene.isComputerPartnerPlayer(playerIndex)) {
      const target = getBestComputerPartnerPledgeMoveTutorTarget(playerIndex, moveOptions);
      if (target) {
        globalScene.phaseManager.unshiftNew(
          "LearnMovePhase",
          target.pokemonIndex,
          moveOptions[target.moveOptionIndex]!.moveId,
          LearnMoveType.TM,
          -1,
          playerIndex,
        );
      }
      resolve();
      return;
    }

    const moveInfoOverlay = new MoveInfoOverlay({
      delayVisibility: false,
      onSide: true,
      right: true,
      x: 1,
      y: -MoveInfoOverlay.getHeight(true) - 1,
      width: globalScene.scaledCanvas.width - 2,
    });
    globalScene.ui.add(moveInfoOverlay);

    const optionSelectItems = moveOptions.map((move: PokemonMove) => {
      const option: OptionSelectItem = {
        label: move.getName(),
        handler: () => {
          moveInfoOverlay.active = false;
          moveInfoOverlay.setVisible(false);
          return true;
        },
        onHover: () => {
          moveInfoOverlay.active = true;
          moveInfoOverlay.show(allMoves[move.moveId]);
        },
      };
      return option;
    });

    const onHoverOverCancel = () => {
      moveInfoOverlay.active = false;
      moveInfoOverlay.setVisible(false);
    };

    const result = await selectOptionThenPokemon(
      optionSelectItems,
      `${namespace}:teachMovePrompt`,
      undefined,
      onHoverOverCancel,
    );
    if (!result) {
      moveInfoOverlay.active = false;
      moveInfoOverlay.setVisible(false);
    }

    if (result && result.selectedOptionIndex < moveOptions.length) {
      globalScene.phaseManager.unshiftNew(
        "LearnMovePhase",
        result.selectedPokemonIndex,
        moveOptions[result.selectedOptionIndex]!.moveId,
        LearnMoveType.TM,
        -1,
        playerIndex,
      );
    }

    resolve();
  });
}
