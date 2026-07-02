import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { allBiomes } from "#data/data-lists";
import { BiomeId } from "#enums/biome-id";
import { ChallengeType } from "#enums/challenge-type";
import { UiMode } from "#enums/ui-mode";
import { MapModifier, MoneyInterestModifier, OldSeaMapModifier } from "#modifiers/modifier";
import { BattlePhase } from "#phases/battle-phase";
import type { OptionSelectConfig, OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { applyChallenges } from "#utils/challenge-utils";
import { BooleanHolder, getBiomeName, randSeedInt, randSeedItem } from "#utils/common";
import { enumValueToKey } from "#utils/enums";

export class SelectBiomePhase extends BattlePhase {
  public readonly phaseName = "SelectBiomePhase";

  start() {
    super.start();

    globalScene.resetSeed();

    const gameMode = globalScene.gameMode;
    const currentBiome = globalScene.arena.biomeId;
    const currentWaveIndex = globalScene.currentBattle.waveIndex;
    const nextWaveIndex = currentWaveIndex + 1;

    if (
      (gameMode.isClassic && gameMode.isWaveFinal(nextWaveIndex + 9))
      || (gameMode.isDaily && gameMode.isWaveFinal(nextWaveIndex))
      || (gameMode.hasShortBiomes && !(nextWaveIndex % 50))
    ) {
      this.setNextBiomeAndEnd(BiomeId.END);
      return;
    }

    if (gameMode.hasRandomBiomes) {
      this.setNextBiomeAndEnd(this.generateNextBiome(nextWaveIndex));
      return;
    }

    const { biomeLinks } = allBiomes.get(currentBiome);
    if (biomeLinks.length > 1) {
      const baseBiomes: BiomeId[] = biomeLinks
        .filter(b => !Array.isArray(b) || !randSeedInt(b[1]))
        .map(b => (Array.isArray(b) ? b[0] : b));
      const biomes = this.withOldSeaMapBiomeOptions(currentBiome, baseBiomes);

      if (biomes.length > 1 && this.shouldShowMapSelect()) {
        this.showMapSelect(biomes);
      } else {
        this.setNextBiomeAndEnd(randSeedItem(biomes));
      }
      return;
    }

    if (biomeLinks.length === 1) {
      if (Array.isArray(biomeLinks[0])) {
        console.warn(
          "Biomes with a link to a single other biome should not have a weight assigned to the link.\n",
          "Biome:",
          enumValueToKey(BiomeId, allBiomes.get(currentBiome).biomeId),
          "| Links:",
          biomeLinks,
        );
        // @ts-expect-error: failsafe for invalid biome links structure
        biomeLinks[0] = biomeLinks[0][0];
      }
      this.setNextBiomeAndEnd(biomeLinks[0] as BiomeId);
      return;
    }

    this.setNextBiomeAndEnd(this.generateNextBiome(nextWaveIndex));
  }

  private withOldSeaMapBiomeOptions(currentBiome: BiomeId, biomes: BiomeId[]): BiomeId[] {
    if (currentBiome !== BiomeId.SEA || !this.shouldShowOldSeaMapOption()) {
    return biomes;
    }
    return biomes.includes(BiomeId.FARAWAY_ISLAND)
    ? biomes
    : [...biomes, BiomeId.FARAWAY_ISLAND];
  }

  private shouldShowOldSeaMapOption(): boolean {
  if (!globalScene.twoPlayerMode) {
    return !!globalScene.findModifier(m => m instanceof OldSeaMapModifier);
  }

  return globalScene.getActivePlayerIndexes().some(playerIndex =>
    globalScene.findModifierForPlayer(modifier => modifier instanceof OldSeaMapModifier, playerIndex),
  );
}

  private generateNextBiome(waveIndex: number): BiomeId {
    return waveIndex % 50 === 0 ? BiomeId.END : globalScene.generateRandomBiome(waveIndex);
  }

  private shouldShowMapSelect(): boolean {
    if (!globalScene.twoPlayerMode) {
      return !!globalScene.findModifier(m => m instanceof MapModifier || m instanceof OldSeaMapModifier);
    }

    return this.getMapPlayerIndexes().length > 0;
  }

  private getMapPlayerIndexes(): PlayerIndex[] {
    return globalScene.getActivePlayerIndexes().filter(playerIndex =>
      globalScene.findModifierForPlayer(modifier => modifier instanceof MapModifier || modifier instanceof OldSeaMapModifier, playerIndex),
    );
  }

  private showMapSelect(biomes: BiomeId[]): void {
    if (!globalScene.twoPlayerMode) {
      this.showMapSelectForPlayer(globalScene.activePlayerIndex, biomes, biome => {
        globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.setNextBiomeAndEnd(biome));
      });
      return;
    }

    const mapPlayerIndexes = this.getMapPlayerIndexes();
    if (mapPlayerIndexes.length === 1) {
      this.showMapSelectForPlayer(mapPlayerIndexes[0], biomes, biome => {
        globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.setNextBiomeAndEndForTwoPlayer(biome));
      });
      return;
    }

    this.showTwoPlayerMapVote(biomes);
  }

  private showTwoPlayerMapVote(biomes: BiomeId[]): void {
    const mapPlayerIndexes = this.getMapPlayerIndexes();
    const votes: BiomeId[] = [];

    const showNextVote = (voteIndex: number, startingCursorIndex = 0) => {
      const playerIndex = mapPlayerIndexes[voteIndex];
      if (playerIndex === undefined) {
        globalScene.ui
          .setMode(UiMode.MESSAGE)
          .then(() => this.setNextBiomeAndEndForTwoPlayer(this.resolveTwoPlayerMapVote(votes)));
        return;
      }

      this.showMapSelectForPlayer(
        playerIndex,
        biomes,
        biome => {
          votes.push(biome);
          globalScene.ui.setMode(UiMode.MESSAGE).then(() => showNextVote(voteIndex + 1, biomes.indexOf(biome)));
        },
        startingCursorIndex,
      );
    };

    showNextVote(0);
  }

  private resolveTwoPlayerMapVote(votes: BiomeId[]): BiomeId {
    const voteCounts = new Map<BiomeId, number>();
    for (const vote of votes) {
      voteCounts.set(vote, (voteCounts.get(vote) ?? 0) + 1);
    }

    const highestVoteCount = Math.max(...voteCounts.values());
    const tiedVotes = [...voteCounts.entries()]
      .filter(([, count]) => count === highestVoteCount)
      .map(([biome]) => biome);
    if (tiedVotes.length === 1) {
      return tiedVotes[0];
    }

    const tiedPlayerIndexes = votes
      .map((vote, playerIndex) => ({ vote, playerIndex: playerIndex as PlayerIndex }))
      .filter(({ vote }) => tiedVotes.includes(vote))
      .map(({ playerIndex }) => playerIndex);
    const winningPlayerIndex = globalScene.resolvePlayerTieBreak(tiedPlayerIndexes);
    return tiedVotes.includes(votes[winningPlayerIndex]) ? votes[winningPlayerIndex] : tiedVotes[0];
  }

  private showMapSelectForPlayer(
    playerIndex: PlayerIndex,
    biomes: BiomeId[],
    onSelect: (biome: BiomeId) => void,
    startingCursorIndex = 0,
  ): void {
    const biomeSelectItems = biomes.map(b => {
      return {
        label: getBiomeName(b),
        handler: () => {
          onSelect(b);
          return true;
        },
      } satisfies OptionSelectItem as OptionSelectItem;
    });

    const config: OptionSelectConfig = {
      options: biomeSelectItems,
      delay: 1000,
      noCancel: true,
    };

    globalScene.waitForPlayerInput(playerIndex);
    globalScene.ui.showText(`Player ${playerIndex + 1}, choose the next biome.`, null, () => {
      globalScene.ui.setMode(UiMode.OPTION_SELECT, config).then(() => {
        const handler = globalScene.ui.getHandler();
        if ("setCursor" in handler && startingCursorIndex > 0) {
          handler.setCursor(startingCursorIndex);
        }
      });
    });
  }

  private setNextBiomeAndEndForTwoPlayer(nextBiome: BiomeId): void {
    globalScene.waitForPlayerInput(0);
    this.setNextBiomeAndEnd(nextBiome);
  }

  private setNextBiomeAndEnd(nextBiome: BiomeId): void {
    const gameMode = globalScene.gameMode;
    const currentWaveIndex = globalScene.currentBattle.waveIndex;
    const nextWaveIndex = currentWaveIndex + 1;

    if (nextWaveIndex % 10 === 1) {
      if (globalScene.twoPlayerMode) {
        globalScene.getActivePlayerIndexes().forEach(playerIndex => {
          globalScene.applyModifierForPlayer(MoneyInterestModifier, playerIndex, playerIndex);
        });
      } else {
        globalScene.applyModifiers(MoneyInterestModifier, true);
      }
      const healStatus = new BooleanHolder(true);
      applyChallenges(ChallengeType.PARTY_HEAL, healStatus);
      if (healStatus.value) {
        globalScene.phaseManager.unshiftNew("PartyHealPhase", false);
      } else {
        globalScene.phaseManager.unshiftNew(
          "SelectModifierPhase",
          undefined,
          undefined,
          gameMode.isFixedBattle(currentWaveIndex)
            ? gameMode.getFixedBattle(currentWaveIndex)?.customModifierRewardSettings
            : undefined,
        );
      }
    }
    globalScene.phaseManager.unshiftNew("SwitchBiomePhase", nextBiome);
    this.end();
  }
}
