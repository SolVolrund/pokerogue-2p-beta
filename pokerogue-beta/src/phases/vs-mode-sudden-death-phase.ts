import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import type { Pokemon } from "#field/pokemon";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { BattlePhase } from "#phases/battle-phase";
import { updateWindowType } from "#ui/ui-theme";
import { getEnumValues } from "#utils/enums";

interface VsModeSuddenDeathData {
  choices: [];
  shinyBadgeDuelActive: boolean;
  shinyBadgeDuelPlayerIndexes: PlayerIndex[];
  suppressVsModeVictory: boolean;
  vsModeSuddenDeathActive: boolean;
}

export class VsModeSuddenDeathPhase extends BattlePhase {
  public readonly phaseName = "VsModeSuddenDeathPhase";

  constructor(private readonly initialPlayerIndexes?: PlayerIndex[]) {
    super();
  }

  start(): void {
    super.start();

    const playerIndexes = this.getEligiblePlayerIndexes();
    if (playerIndexes.length <= 1) {
      this.queueWinner(playerIndexes[0] ?? globalScene.resolvePlayerTieBreak(globalScene.getActivePlayerIndexes()));
      this.end();
      return;
    }

    const battle = globalScene.currentBattle;
    const firstPlayerIndex = playerIndexes[0];

    globalScene.disableMenu = false;
    globalScene.phaseManager.hideAbilityBar();
    globalScene.setActivePlayerIndex(firstPlayerIndex);
    updateWindowType(firstPlayerIndex + 1);

    battle.waveIndex = globalScene.gameMode.getWaveForDifficulty(battle.waveIndex) >= 200 ? 201 : battle.waveIndex + 1;
    battle.battleType = BattleType.WILD;
    battle.trainer = null;
    battle.enemyParty = [];
    battle.enemyLevels = [];
    battle.double = playerIndexes.length > 1;
    battle.mysteryEncounterBattlerCount = playerIndexes.length;
    battle.turn = 0;
    battle.turnCommands = Object.fromEntries(getEnumValues(BattlerIndex).map(bt => [bt, null]));
    battle.preTurnCommands = Object.fromEntries(getEnumValues(BattlerIndex).map(bt => [bt, null]));

    battle.mysteryEncounter = this.buildSyntheticEncounter(playerIndexes);
    globalScene.setMysteryEncounterBattlePlayerFieldOwners(playerIndexes);
    globalScene.setMysteryEncounterEnemySidePlayerIndexes(this.getEnemySidePlayerIndexes(playerIndexes));

    this.preparePlayerPokemonForDuel(playerIndexes);

    if (globalScene.twoPlayerMode) {
      globalScene.waitForSharedInput();
    }

    globalScene.ui.showText(
      "Sudden death! Last player standing wins!",
      null,
      () => {
        for (const fieldIndex of globalScene.getPlayerFieldOwners().keys()) {
          globalScene.phaseManager.pushNew("SummonPhase", fieldIndex);
        }
        this.end();
      },
      null,
      true,
    );
  }

  private getEligiblePlayerIndexes(): PlayerIndex[] {
    const playerIndexes = this.initialPlayerIndexes ?? globalScene.getVsModeSurvivingPlayerIndexes();
    return [...new Set(playerIndexes)].filter(playerIndex => globalScene.hasPlayerUsablePokemonOrEonFlute(playerIndex));
  }

  private getEnemySidePlayerIndexes(playerIndexes: PlayerIndex[]): PlayerIndex[] | undefined {
    return playerIndexes.length > 1 ? [playerIndexes[1]] : undefined;
  }

  private buildSyntheticEncounter(playerIndexes: PlayerIndex[]): MysteryEncounter {
    const misc: VsModeSuddenDeathData = {
      choices: [],
      shinyBadgeDuelActive: true,
      shinyBadgeDuelPlayerIndexes: playerIndexes,
      suppressVsModeVictory: true,
      vsModeSuddenDeathActive: true,
    };

    return {
      misc,
      preventGameStatsUpdates: true,
      onPokemonFaint: pokemon => this.handleDuelPokemonFaint(pokemon, playerIndexes),
      onGameOver: () => this.handleDuelGameOver(playerIndexes),
    } as unknown as MysteryEncounter;
  }

  private preparePlayerPokemonForDuel(playerIndexes: PlayerIndex[]): void {
    for (const playerIndex of playerIndexes) {
      const party = globalScene.getPlayerParty(playerIndex);
      const leadIndex = party.findIndex(pokemon => pokemon.isAllowedInBattle());
      if (leadIndex > 0) {
        [party[0], party[leadIndex]] = [party[leadIndex], party[0]];
      }
    }

    for (const pokemon of globalScene.getPlayerField()) {
      const playerIndex = globalScene.getPlayerIndexForPokemon(pokemon);
      if (playerIndex == null || playerIndexes.includes(playerIndex)) {
        pokemon.leaveField(true, true, false);
      }
    }
  }

  private handleDuelPokemonFaint(pokemon: Pokemon, playerIndexes: PlayerIndex[]): boolean {
    if (!pokemon.isPlayer()) {
      return false;
    }

    const playerIndex = globalScene.getPlayerIndexForPokemon(pokemon);
    if (playerIndex == null || !playerIndexes.includes(playerIndex)) {
      return false;
    }

    const remainingPlayers = this.getRemainingPlayerIndexes(playerIndexes);
    if (remainingPlayers.length > 1) {
      return false;
    }

    this.finishDuel(remainingPlayers[0] ?? globalScene.resolvePlayerTieBreak(playerIndexes));
    return false;
  }

  private handleDuelGameOver(playerIndexes: PlayerIndex[]): boolean {
    const remainingPlayers = this.getRemainingPlayerIndexes(playerIndexes);
    this.finishDuel(remainingPlayers[0] ?? globalScene.resolvePlayerTieBreak(playerIndexes));
    return false;
  }

  private getRemainingPlayerIndexes(playerIndexes: PlayerIndex[]): PlayerIndex[] {
    return playerIndexes.filter(playerIndex => globalScene.hasPlayerUsablePokemonOrEonFlute(playerIndex));
  }

  private finishDuel(winnerPlayerIndex: PlayerIndex): void {
    this.cleanupSyntheticEncounter();
    this.queueWinner(winnerPlayerIndex);
  }

  private cleanupSyntheticEncounter(): void {
    const encounter = globalScene.currentBattle.mysteryEncounter;
    if (encounter?.misc?.vsModeSuddenDeathActive) {
      encounter.misc.shinyBadgeDuelActive = false;
      encounter.misc.suppressVsModeVictory = false;
      encounter.misc.vsModeSuddenDeathActive = false;
      encounter.onPokemonFaint = undefined;
      encounter.onGameOver = undefined;
      globalScene.currentBattle.mysteryEncounter = undefined;
    }
    globalScene.setMysteryEncounterEnemySidePlayerIndexes(undefined);
  }

  private queueWinner(winnerPlayerIndex: PlayerIndex): void {
    globalScene.phaseManager.clearPhaseQueue(true);
    globalScene.phaseManager.pushNew("VsModeVictoryPhase", winnerPlayerIndex);
  }
}
