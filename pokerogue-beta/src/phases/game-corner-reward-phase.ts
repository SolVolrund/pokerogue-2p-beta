import type { PlayerIndex } from "#app/battle-scene";
import { PLAYER_PARTY_MAX_SIZE } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { audioManager } from "#app/global-audio-manager";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { Phase } from "#app/phase";
import type { FusionOptions } from "#data/fusion-options";
import { Gender } from "#data/gender";
import { BIO_EEVEE_FORM_KEY, BIO_INSTABILITY_VARIANT } from "#data/bio-instability";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import type { Modifier } from "#modifiers/modifier";
import {
  FusePokemonModifierType,
  getPlayerModifierTypeOptions,
  type ModifierType,
  PokemonModifierType,
  PokemonMoveModifierType,
  PokemonPpRestoreModifierType,
  PokemonPpUpModifierType,
  RememberMoveModifierType,
  regenerateModifierPoolThresholds,
  TmModifierType,
} from "#modifiers/modifier-type";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { restoreGameCornerBgm } from "#mystery-encounters/game-corner-music";
import { PokemonData } from "#system/pokemon-data";
import { PartyOption, PartyUiMode } from "#ui/party-ui-handler";
import type {
  GameCornerPokemonRewardSlot,
  GameCornerRewardSlot,
  GameCornerRewardUiConfig,
  GameCornerRewardUiHandler,
} from "#ui/game-corner-reward-ui-handler";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { chooseComputerPartnerRewardOption } from "#utils/computer-partner-reward-ai";
import {
  getComputerPartnerProfileWithRolePreferences,
  getComputerPartnerReplacementScores,
} from "#utils/computer-partner-profile";
import { withGameCornerSeed } from "#utils/game-corner";
import i18next from "i18next";

const namespace = "mysteryEncounters/gameCorner";

const PRIZE_TIERS: ModifierTier[] = [
  ModifierTier.COMMON,
  ModifierTier.COMMON,
  ModifierTier.COMMON,
  ModifierTier.COMMON,
  ModifierTier.COMMON,
  ModifierTier.GREAT,
  ModifierTier.GREAT,
  ModifierTier.GREAT,
  ModifierTier.GREAT,
  ModifierTier.ULTRA,
  ModifierTier.ULTRA,
  ModifierTier.ULTRA,
  ModifierTier.ROGUE,
  ModifierTier.ROGUE,
  ModifierTier.MASTER,
];

const PRIZE_COSTS: Partial<Record<ModifierTier, number>> = {
  [ModifierTier.COMMON]: 10,
  [ModifierTier.GREAT]: 15,
  [ModifierTier.ULTRA]: 20,
  [ModifierTier.ROGUE]: 25,
  [ModifierTier.MASTER]: 30,
};

interface ShadowPrizeConfig {
  minStarterCost: number;
  maxStarterCost: number;
  cost: number;
  tier: ModifierTier;
  layout: { col: number; row: number };
  jackpot: boolean;
}

const SHADOW_PRIZE_CONFIGS: ShadowPrizeConfig[] = [
  {
    minStarterCost: 1,
    maxStarterCost: 3,
    cost: 20,
    tier: ModifierTier.ULTRA,
    layout: { col: 2, row: 4 },
    jackpot: false,
  },
  {
    minStarterCost: 1,
    maxStarterCost: 3,
    cost: 20,
    tier: ModifierTier.ULTRA,
    layout: { col: 3, row: 4 },
    jackpot: false,
  },
  {
    minStarterCost: 1,
    maxStarterCost: 3,
    cost: 20,
    tier: ModifierTier.ULTRA,
    layout: { col: 4, row: 4 },
    jackpot: false,
  },
  {
    minStarterCost: 4,
    maxStarterCost: 6,
    cost: 25,
    tier: ModifierTier.ROGUE,
    layout: { col: 3, row: 3 },
    jackpot: false,
  },
  {
    minStarterCost: 4,
    maxStarterCost: 6,
    cost: 25,
    tier: ModifierTier.ROGUE,
    layout: { col: 4, row: 3 },
    jackpot: false,
  },
  {
    minStarterCost: 7,
    maxStarterCost: 9,
    cost: 30,
    tier: ModifierTier.MASTER,
    layout: { col: 4, row: 2 },
    jackpot: false,
  },
  {
    minStarterCost: 9,
    maxStarterCost: 10,
    cost: 32,
    tier: ModifierTier.MASTER,
    layout: { col: 5, row: 2 },
    jackpot: true,
  },
];

export class GameCornerRewardPhase extends Phase {
  public readonly phaseName = "GameCornerRewardPhase";
  private readonly playerIndex: PlayerIndex;
  private readonly queuePostEncounterPhase: boolean;
  private slots: GameCornerRewardSlot[] = [];
  private nuggies: number;
  private complete = false;
  private initialized = false;
  private readonly rejectedCpuSlots = new Set<number>();
  private readonly cpuMessages: string[] = [];

  constructor(
    nuggies: number,
    playerIndex: PlayerIndex = globalScene.activePlayerIndex,
    queuePostEncounterPhase = true,
  ) {
    super();
    this.nuggies = nuggies;
    this.playerIndex = playerIndex;
    this.queuePostEncounterPhase = queuePostEncounterPhase;
  }

  start(): void {
    super.start();
    this.setActiveRewardPlayer();
    if (!this.initialized) {
      withGameCornerSeed(this.playerIndex, "prizes", () => this.generatePrizes());
      this.initialized = true;
      if (globalScene.isComputerPartnerPlayer(this.playerIndex)) {
        this.cpuMessages.push(
          i18next.t(`${namespace}:cpu.earned`, {
            player: this.getCpuProfile().name,
            nuggies: this.nuggies,
          }),
        );
      }
    }
    if (globalScene.isComputerPartnerPlayer(this.playerIndex)) {
      void this.takeCpuShoppingTurn();
    } else {
      this.showRewardCounter();
    }
  }

  private getCpuProfile() {
    return getComputerPartnerProfileWithRolePreferences(
      globalScene.getComputerPartnerKey(this.playerIndex),
      globalScene.getComputerPartnerRolePreferences(this.playerIndex),
    );
  }

  private getCpuPokemonChoice() {
    const party = globalScene.getPlayerParty(this.playerIndex);
    const profile = this.getCpuProfile();
    const candidates = this.slots.flatMap((slot, slotIndex) => {
      if (
        slot.kind !== "pokemon"
        || slot.purchased
        || slot.cost > this.nuggies
        || this.rejectedCpuSlots.has(slotIndex)
      ) {
        return [];
      }
      const pokemon = new PokemonData(slot.pokemon).toPokemon() as PlayerPokemon;
      try {
        // Jackpot priority bypasses ordinary species/value preferences, never protected party members.
        const scores = getComputerPartnerReplacementScores(
          slot.jackpot ? { ...profile, allowedReplacementSpeciesIds: [] } : profile,
          party,
          pokemon,
          globalScene.getPlayerPartyLimit(this.playerIndex),
        ).filter(score => slot.jackpot || score.canReplace);
        const replacement = scores.sort((a, b) => b.candidateTeamScore - a.candidateTeamScore)[0];
        return replacement ? [{ slot, slotIndex, replacement }] : [];
      } finally {
        pokemon.destroy();
      }
    });
    return candidates.sort(
      (a, b) =>
        Number(b.slot.jackpot) - Number(a.slot.jackpot)
        || b.replacement.improvementRatio - a.replacement.improvementRatio
        || b.replacement.candidateTeamScore - a.replacement.candidateTeamScore,
    )[0];
  }

  private async takeCpuShoppingTurn(): Promise<void> {
    const pokemonChoice = this.getCpuPokemonChoice();
    if (pokemonChoice) {
      const { slot, slotIndex, replacement } = pokemonChoice;
      const pokemon = await this.addShadowPokemonToParty(slot, replacement.replacedPokemonIndex);
      if (pokemon) {
        this.nuggies -= slot.cost;
        slot.purchased = true;
        this.cpuMessages.push(
          i18next.t(`${namespace}:cpu.purchased`, {
            player: this.getCpuProfile().name,
            item: pokemon.getNameToRender(),
          }),
        );
      } else {
        this.rejectedCpuSlots.add(slotIndex);
      }
      this.continueCpuShopping();
      return;
    }

    const affordable = this.slots.flatMap((slot, slotIndex) =>
      slot.kind === "item" && !slot.purchased && slot.cost <= this.nuggies && !this.rejectedCpuSlots.has(slotIndex)
        ? [{ slot, slotIndex }]
        : [],
    );
    const choice = withGameCornerSeed(
      this.playerIndex,
      `purchase-${this.slots.filter(slot => slot.purchased).length}`,
      () =>
        chooseComputerPartnerRewardOption(
          affordable.map(entry => entry.slot.option),
          globalScene.getPlayerParty(this.playerIndex),
          {
            pokeballCounts: globalScene.getPlayerPokeballCounts(this.playerIndex),
            computerPartnerProfile: this.getCpuProfile(),
          },
        ),
    );
    if (!choice) {
      this.cashOut();
      return;
    }
    const { slotIndex } = affordable[choice.optionIndex];
    const target =
      choice.targetPokemonIndex === undefined
        ? undefined
        : globalScene.getPlayerParty(this.playerIndex)[choice.targetPokemonIndex];
    const modifier =
      target && choice.targetMoveIndex !== undefined
        ? choice.option.type.newModifier(target, choice.targetMoveIndex)
        : target
          ? choice.option.type.newModifier(target)
          : choice.option.type.newModifier();
    if (this.applyModifier(modifier, slotIndex, false)) {
      this.cpuMessages.push(
        i18next.t(`${namespace}:cpu.purchased`, {
          player: this.getCpuProfile().name,
          item: choice.option.type.name,
        }),
      );
    } else {
      this.rejectedCpuSlots.add(slotIndex);
    }
    this.continueCpuShopping();
  }

  private continueCpuShopping(): void {
    // Run any queued move-learning/evolution first, then re-score the updated party.
    globalScene.phaseManager.unshiftPhase(this);
    this.end();
  }

  private generatePrizes(): void {
    const party = globalScene.getPlayerParty(this.playerIndex);
    regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0, this.playerIndex);
    const options = getPlayerModifierTypeOptions(PRIZE_TIERS.length, party, undefined, {
      guaranteedModifierTiers: PRIZE_TIERS,
      fillRemaining: false,
      allowLuckUpgrades: false,
      rerollMultiplier: -1,
    });

    const itemSlots: GameCornerRewardSlot[] = options.map((option, index) => ({
      kind: "item",
      option,
      tier: PRIZE_TIERS[index],
      cost: PRIZE_COSTS[PRIZE_TIERS[index]] ?? 10,
      purchased: false,
    }));

    this.slots = [...itemSlots, ...SHADOW_PRIZE_CONFIGS.map(config => this.generateShadowPokemonSlot(config))];
  }

  private generateShadowPokemonSlot(config: ShadowPrizeConfig): GameCornerPokemonRewardSlot {
    const { pokemon, pokemonName } = this.generateShadowPokemonPrize(
      config.minStarterCost,
      config.maxStarterCost,
      config.jackpot,
    );
    const species = getPokemonSpecies(pokemon.species);
    const female = pokemon.gender === Gender.FEMALE;
    const fallbackShiny = false;

    return {
      kind: "pokemon",
      pokemon,
      pokemonName,
      iconAtlas: species.getIconAtlasKey(pokemon.formIndex, pokemon.shiny, pokemon.variant),
      iconFrame: species.getIconId(female, pokemon.formIndex, pokemon.shiny, pokemon.variant),
      fallbackIconAtlas: species.getIconAtlasKey(pokemon.formIndex, fallbackShiny, pokemon.variant),
      fallbackIconFrame: species.getIconId(female, pokemon.formIndex, fallbackShiny, pokemon.variant),
      tier: config.tier,
      cost: config.cost,
      purchased: false,
      layout: config.layout,
      minStarterCost: config.minStarterCost,
      maxStarterCost: config.maxStarterCost,
      jackpot: config.jackpot,
    };
  }

  private generateShadowPokemonPrize(
    minStarterCost: number,
    maxStarterCost: number,
    jackpot = false,
  ): { pokemon: PokemonData; pokemonName: string } {
    const species = getPokemonSpecies(
      jackpot ? SpeciesId.EEVEE : this.rollShadowPrizeSpecies(minStarterCost, maxStarterCost),
    );
    const formIndex = jackpot ? species.forms.findIndex(form => form.formKey === BIO_EEVEE_FORM_KEY) : undefined;
    const pokemon = globalScene.addPlayerPokemon(species, this.getRewardPokemonLevel(), undefined, formIndex);
    if (jackpot) {
      pokemon.customPokemonData.eventVariant = BIO_INSTABILITY_VARIANT;
      pokemon.passive = true;
      pokemon.passiveIndex = 0;
      pokemon.syncBioInstabilityMoveset();
    } else {
      pokemon.generateAndPopulateMoveset();
    }
    pokemon.friendship = 0;
    pokemon.pokeball = PokeballType.POKEBALL;
    pokemon.setShadowPokemon(true);
    pokemon.setVisible(false);

    const pokemonName = pokemon.getNameToRender();
    const data = new PokemonData(pokemon);
    pokemon.destroy();

    return { pokemon: data, pokemonName };
  }

  private rollShadowPrizeSpecies(minStarterCost: number, maxStarterCost: number): SpeciesId {
    const starters = speciesDataRegistry.getAllStarters().filter(speciesId => {
      const starterCost = speciesDataRegistry.getStarterCost(speciesId);
      return starterCost >= minStarterCost && starterCost <= maxStarterCost;
    });

    return randSeedItem(starters.length > 0 ? starters : speciesDataRegistry.getAllStarters());
  }

  private showRewardCounter(): void {
    if (this.complete) {
      return;
    }

    this.setActiveRewardPlayer();
    void globalScene.ui.setMode(UiMode.GAME_CORNER_REWARD, this.getUiConfig());
  }

  private getUiConfig(): GameCornerRewardUiConfig {
    return {
      slots: this.slots,
      nuggies: this.nuggies,
      cashOutAmount: this.getCashOutPayout(),
      onSelectPrize: slotIndex => this.selectPrize(slotIndex),
      onCashOut: () => this.cashOut(),
    };
  }

  private selectPrize(slotIndex: number): boolean {
    const slot = this.slots[slotIndex];
    if (!slot || slot.purchased) {
      globalScene.ui.playError();
      return false;
    }

    if (this.nuggies < slot.cost) {
      globalScene.ui.showText(i18next.t(`${namespace}:rewardCounter.notEnough`));
      globalScene.ui.playError();
      return false;
    }

    if (slot.kind === "pokemon") {
      void this.applyPokemonPrize(slot, slotIndex);
      return true;
    }

    return this.applyChosenModifier(slot.option.type, slotIndex);
  }

  private applyChosenModifier(modifierType: ModifierType, slotIndex: number): boolean {
    if (modifierType instanceof PokemonModifierType) {
      if (modifierType instanceof FusePokemonModifierType) {
        this.openFusionMenu(modifierType, slotIndex);
      } else {
        this.openModifierMenu(modifierType, slotIndex);
      }
      return true;
    }

    return this.applyModifier(modifierType.newModifier(), slotIndex);
  }

  private applyModifier(modifier: Modifier | null, slotIndex: number, showPurchase = true): boolean {
    const slot = this.slots[slotIndex];
    if (!slot || !modifier) {
      globalScene.ui.playError();
      return false;
    }

    const result = globalScene.addModifier(modifier, false, true, undefined, undefined, undefined, this.playerIndex);
    if (!result) {
      globalScene.ui.playError();
      return false;
    }

    globalScene.dismissEonFluteGuestIfOwnerRevived(this.playerIndex);
    this.nuggies -= slot.cost;
    slot.purchased = true;
    if (showPurchase) {
      this.refreshRewardCounter();
      globalScene.ui.showText(
        i18next.t(`${namespace}:rewardCounter.purchased`, {
          itemName: slot.kind === "item" ? slot.option.type.name : "",
          nuggies: this.nuggies,
        }),
      );
    }
    globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("game-corner-prize-purchased");
    return true;
  }

  private async applyPokemonPrize(slot: GameCornerPokemonRewardSlot, slotIndex: number): Promise<void> {
    const pokemon = await this.addShadowPokemonToParty(slot);
    if (!pokemon) {
      await globalScene.ui.setMode(UiMode.GAME_CORNER_REWARD, this.getUiConfig());
      return;
    }

    this.nuggies -= slot.cost;
    slot.purchased = true;
    await globalScene.ui.setMode(UiMode.GAME_CORNER_REWARD, this.getUiConfig());
    this.refreshRewardCounter();
    globalScene.ui.showText(
      i18next.t(`${namespace}:rewardCounter.pokemonPurchased`, {
        pokemonName: pokemon.getNameToRender(),
        nuggies: this.nuggies,
      }),
    );
    globalScene.uiInputs?.broadcastTwoPlayerCheckpoint(`game-corner-shadow-pokemon-purchased-${slotIndex}`);
  }

  private async addShadowPokemonToParty(
    slot: GameCornerPokemonRewardSlot,
    cpuReplacementIndex?: number,
  ): Promise<PlayerPokemon | null> {
    const addToParty = async (partySlotIndex?: number): Promise<PlayerPokemon> => {
      const dataSource = new PokemonData(slot.pokemon);
      dataSource.player = true;
      dataSource.friendship = 0;
      dataSource.shadowPokemon = true;
      dataSource.purifiedPokemon = false;
      dataSource.crystalized = false;
      dataSource.crystalColor = null;

      const newPokemon = globalScene.addPlayerPokemon(
        getPokemonSpecies(dataSource.species),
        dataSource.level,
        dataSource.abilityIndex,
        dataSource.formIndex,
        dataSource.gender,
        dataSource.shiny,
        dataSource.variant,
        dataSource.ivs,
        dataSource.nature,
        dataSource,
      );
      newPokemon.pokeball = PokeballType.POKEBALL;
      newPokemon.friendship = 0;
      newPokemon.setShadowPokemon(true);
      newPokemon.setVisible(false);

      const party = globalScene.getPlayerParty(this.playerIndex);
      if (partySlotIndex != null && partySlotIndex <= party.length) {
        party.splice(partySlotIndex, 0, newPokemon);
      } else {
        party.push(newPokemon);
      }

      await newPokemon.loadAssets();
      await this.updateCaughtDataForReward(newPokemon);
      this.savePlayerSystemData();
      return newPokemon;
    };

    if (globalScene.isComputerPartnerPlayer(this.playerIndex)) {
      if (cpuReplacementIndex !== undefined) {
        await globalScene.removePartyMemberModifiers(cpuReplacementIndex, this.playerIndex);
        const released = globalScene.getPlayerParty(this.playerIndex)[cpuReplacementIndex];
        globalScene.removePokemonFromPlayerParty(released);
        return addToParty(cpuReplacementIndex);
      }
      return globalScene.isPlayerPartyFull(this.playerIndex) ? null : addToParty();
    }
    if (globalScene.isPlayerPartyFull(this.playerIndex)) {
      return this.promptReleaseForShadowPokemon(slot.pokemonName, addToParty);
    }

    return addToParty();
  }

  private promptReleaseForShadowPokemon(
    pokemonName: string,
    addToParty: (partySlotIndex?: number) => Promise<PlayerPokemon>,
  ): Promise<PlayerPokemon | null> {
    return new Promise(resolve => {
      const finishDecline = () => {
        void globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
          globalScene.ui.showText(
            i18next.t(`${namespace}:rewardCounter.pokemonLeftBehind`, { pokemonName }),
            null,
            () => resolve(null),
            null,
            true,
          );
        });
      };

      const showReleaseMenu = () => {
        void globalScene.ui.setMode(
          UiMode.PARTY,
          PartyUiMode.RELEASE,
          this.getFieldSlotForPlayer(this.playerIndex),
          (partySlotIndex: number, _option: PartyOption) => {
            void globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
              if (partySlotIndex < PLAYER_PARTY_MAX_SIZE) {
                addToParty(partySlotIndex).then(resolve);
              } else {
                promptRelease();
              }
            });
          },
        );
      };

      const promptRelease = () => {
        this.setActiveRewardPlayer();
        updateWindowType(this.playerIndex + 1);
        globalScene.ui.showText(
          i18next.t("battle:partyFull", { pokemonName }),
          null,
          () => {
            globalScene.pokemonInfoContainer.makeRoomForConfirmUi(1, true);
            void globalScene.ui.setMode(UiMode.CONFIRM, showReleaseMenu, finishDecline);
          },
          0,
          true,
        );
      };

      promptRelease();
    });
  }

  private openFusionMenu(modifierType: PokemonModifierType, slotIndex: number): void {
    const party = globalScene.getPlayerParty(this.playerIndex);
    const restoreRewardScreen = () => this.showRewardCounter();
    globalScene.ui
      .setModeWithoutClear(
        UiMode.FUSION_SUMMARY,
        party,
        (fromSlotIndex?: number, spliceSlotIndex?: number, fusionOptions?: FusionOptions) => {
          if (
            spliceSlotIndex !== undefined
            && fromSlotIndex !== undefined
            && fromSlotIndex < 6
            && spliceSlotIndex < 6
            && fromSlotIndex !== spliceSlotIndex
          ) {
            globalScene.ui.setMode(UiMode.GAME_CORNER_REWARD, this.getUiConfig()).then(() => {
              const modifier = modifierType.newModifier(party[fromSlotIndex], party[spliceSlotIndex], fusionOptions);
              this.applyModifier(modifier, slotIndex);
            });
          } else {
            restoreRewardScreen();
          }
        },
        modifierType.selectFilter,
      )
      .then(() => {
        if (globalScene.twoPlayerMode) {
          globalScene.waitForPlayerInput(this.playerIndex);
        }
      });
  }

  private openModifierMenu(modifierType: PokemonModifierType, slotIndex: number): void {
    const party = globalScene.getPlayerParty(this.playerIndex);
    const isMoveModifier = modifierType instanceof PokemonMoveModifierType;
    const isTmModifier = modifierType instanceof TmModifierType;
    const isRememberMoveModifier = modifierType instanceof RememberMoveModifierType;
    const isPpRestoreModifier =
      modifierType instanceof PokemonPpRestoreModifierType || modifierType instanceof PokemonPpUpModifierType;
    const partyUiMode = isMoveModifier
      ? PartyUiMode.MOVE_MODIFIER
      : isTmModifier
        ? PartyUiMode.TM_MODIFIER
        : isRememberMoveModifier
          ? PartyUiMode.REMEMBER_MOVE_MODIFIER
          : PartyUiMode.MODIFIER;
    const tmMoveId = isTmModifier ? modifierType.moveId : undefined;

    globalScene.ui
      .setModeWithoutClear(
        UiMode.PARTY,
        partyUiMode,
        this.getFieldSlotForPlayer(this.playerIndex),
        (partyIndex: number, option: PartyOption) => {
          if (partyIndex < 6) {
            globalScene.ui.setMode(UiMode.GAME_CORNER_REWARD, this.getUiConfig()).then(() => {
              const modifier = isMoveModifier
                ? modifierType.newModifier(party[partyIndex], option - PartyOption.MOVE_1)
                : isRememberMoveModifier
                  ? modifierType.newModifier(party[partyIndex], option as number)
                  : modifierType.newModifier(party[partyIndex]);
              this.applyModifier(modifier, slotIndex);
            });
          } else {
            this.showRewardCounter();
          }
        },
        modifierType.selectFilter,
        modifierType instanceof PokemonMoveModifierType ? modifierType.moveSelectFilter : undefined,
        tmMoveId,
        isPpRestoreModifier,
      )
      .then(() => {
        if (globalScene.twoPlayerMode) {
          globalScene.waitForPlayerInput(this.playerIndex);
        }
      });
  }

  private cashOut(): boolean {
    if (this.complete) {
      return false;
    }

    this.complete = true;
    this.setActiveRewardPlayer();
    const remainingNuggies = this.nuggies;
    const payout = this.getCashOutPayout();
    this.nuggies = 0;

    if (payout > 0) {
      globalScene.setPlayerMoney(
        Math.min(Number.MAX_SAFE_INTEGER, globalScene.getPlayerMoney(this.playerIndex) + payout),
        this.playerIndex,
      );
      globalScene.updateMoneyText();
      globalScene.animateMoneyChanged(true);
      audioManager.playSound("se/buy");
    }

    const isCpu = globalScene.isComputerPartnerPlayer(this.playerIndex);
    const cashOutMessage = i18next.t(`${namespace}:${isCpu ? "cpu.cashOut" : "rewardCounter.cashOutComplete"}`, {
      amount: payout,
      nuggies: remainingNuggies,
      player: isCpu ? this.getCpuProfile().name : "",
    });
    if (isCpu) {
      const human = globalScene.getActivePlayerIndexes().find(player => !globalScene.isComputerPartnerPlayer(player));
      globalScene.waitForPlayerSideProgressionInput(human ?? 0);
    }
    void globalScene.ui.setMode(UiMode.MESSAGE).then(async () => {
      for (const message of [...this.cpuMessages, cashOutMessage]) {
        await showEncounterText(message);
      }
      this.finish();
    });
    return true;
  }

  private finish(): void {
    if (this.queuePostEncounterPhase) {
      restoreGameCornerBgm();
      globalScene.phaseManager.pushNew("PostMysteryEncounterPhase");
    }
    this.end();
  }

  private refreshRewardCounter(): void {
    const handler = globalScene.ui.getHandler<GameCornerRewardUiHandler>();
    handler.refresh(this.nuggies, this.getCashOutPayout());
  }

  private getCashOutPayout(): number {
    if (this.nuggies <= 0) {
      return 0;
    }

    return globalScene.getWaveMoneyAmount(this.nuggies / 64);
  }

  private async updateCaughtDataForReward(pokemon: PlayerPokemon): Promise<void> {
    if (pokemon.isBioInstabilityEevee() || globalScene.isComputerPartnerPlayer(this.playerIndex)) {
      return;
    }
    const gameData = globalScene.getPlayerGameData(this.playerIndex);
    gameData.updateSpeciesDexIvs(pokemon.species.getRootSpeciesId(true), pokemon.ivs, this.playerIndex);
    await gameData.setPokemonCaught(pokemon, true, false, false);
  }

  private getRewardPokemonLevel(): number {
    const party = globalScene.getPlayerParty(this.playerIndex);
    const partyLevel = party.length > 0 ? Math.max(...party.map(pokemon => pokemon.level)) : 1;
    return Math.max(1, Math.min(globalScene.getMaxExpLevel(), partyLevel));
  }

  private savePlayerSystemData(): void {
    if (globalScene.isComputerPartnerPlayer(this.playerIndex)) {
      return;
    }
    if (globalScene.twoPlayerMode) {
      globalScene.savePlayerSystemSaveLocal(this.playerIndex);
    } else {
      globalScene.gameData.saveSystemLocal();
    }
  }

  private getFieldSlotForPlayer(playerIndex: PlayerIndex): number {
    const fieldSlot = globalScene.getPlayerFieldOwners().indexOf(playerIndex);
    return fieldSlot > -1 ? fieldSlot : playerIndex;
  }

  private setActiveRewardPlayer(): void {
    if (globalScene.twoPlayerMode) {
      globalScene.waitForPlayerInput(this.playerIndex);
    } else {
      globalScene.setActivePlayerIndex(this.playerIndex);
    }
  }
}
