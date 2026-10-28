import { Battle } from "#app/battle";
import { RELEARN_MOVE } from "#app/constants";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { EvoLevelThresholdKind } from "#enums/evo-level-threshold-kind";
import { MoveId } from "#enums/move-id";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { TrainerPoolTier } from "#enums/trainer-pool-tier";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Pokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import { PokemonMove } from "#moves/pokemon-move";
import { GameManager } from "#test/framework/game-manager";
import { evilAdminTrainerPools } from "#trainers/evil-admin-trainer-pools";
import { trainerConfigs } from "#trainers/trainer-config";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Upstream 1.12.2 trainer and species balance", () => {
  it.each([
    [SpeciesId.BLASTOISE, [119, 105, 125, 108, 110, 63]],
    [SpeciesId.DURALUDON, [100, 110, 120, 160, 85, 60]],
  ])("updates species %i's G-Max stats without replacing its forms", (species, stats) => {
    const form = speciesDataRegistry
      .getSpecies(species)
      .forms.find(candidate => candidate.formKey === SpeciesFormKey.GIGANTAMAX);
    expect(form?.baseStats).toEqual(stats);
  });

  it.each([
    [SpeciesId.MISDREAVUS, SpeciesId.MISMAGIUS, [26, 32, 38]],
    [SpeciesId.TADBULB, SpeciesId.BELLIBOLT, [26, 28, 30]],
  ])("uses revised encounter evolution thresholds for %i", (species, evolution, thresholds) => {
    const entry = speciesDataRegistry.getEvolutions(species).find(candidate => candidate.speciesId === evolution);
    expect(entry?.evoLevelThreshold).toEqual(thresholds);
  });

  it.each([
    MoveId.MAGICAL_LEAF,
    MoveId.PHANTOM_FORCE,
    MoveId.MYSTICAL_FIRE,
  ])("makes Mismagius move %i a reminder move", move => {
    expect(speciesDataRegistry.getLevelMoves(SpeciesId.MISMAGIUS)).toContainEqual([RELEARN_MOVE, move]);
    expect(speciesDataRegistry.getLevelMoves(SpeciesId.MISMAGIUS)).not.toContainEqual([1, move]);
  });

  it("retains Mismagius's custom secondary passive", () => {
    expect(speciesDataRegistry.getPassiveOptions(SpeciesId.MISMAGIUS, 0)).toEqual([
      AbilityId.BEADS_OF_RUIN,
      AbilityId.MAGICIAN,
    ]);
  });

  it.each([
    [SpeciesId.GALAR_MEOWTH, MoveId.OUTRAGE],
    [SpeciesId.PERRSERKER, MoveId.OUTRAGE],
    [SpeciesId.TATSUGIRI, MoveId.MUD_SHOT],
  ])("gives species %i TM compatibility with move %i", (species, move) => {
    expect(speciesDataRegistry.getTms(species)).toContain(move);
  });

  it.each([
    [SpeciesId.ESPURR, SpeciesId.MEOWSTIC],
    [SpeciesId.LECHONK, SpeciesId.OINKOLOGNE],
  ])("uses valid gendered evolution keys for %i", (species, evolution) => {
    const keys = speciesDataRegistry
      .getEvolutions(species)
      .filter(entry => entry.speciesId === evolution)
      .map(entry => entry.evoFormKey);
    expect(keys).toEqual(expect.arrayContaining(["male", "female"]));
    expect(keys).not.toContain("");
    const forms = speciesDataRegistry.getSpecies(evolution).forms.map(form => form.formKey);
    expect(forms).toEqual(expect.arrayContaining(keys));
  });

  it("preserves Macro Cosmos's custom Happiny pool", () => {
    const pool = evilAdminTrainerPools.macro_cosmos[TrainerPoolTier.COMMON].flat();
    expect(pool).toContain(SpeciesId.HAPPINY);
    expect(pool).not.toContain(SpeciesId.LOPUNNY);
    expect(pool).not.toContain(SpeciesId.BUNEARY);
  });

  it.each([
    TrainerType.OFFICER,
    TrainerType.PARASOL_LADY,
  ])("removes same-species restrictions from trainer %i's templates", trainerType => {
    for (const template of trainerConfigs[trainerType].partyTemplates) {
      for (let index = 0; index < template.size; index++) {
        expect(template.isSameSpecies(index)).toBe(false);
      }
    }
  });

  describe("Trainer moveset callbacks", () => {
    let game: GameManager;
    let phaserGame: Phaser.Game;
    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });
    beforeEach(async () => {
      game = new GameManager(phaserGame);
      await game.runToTitle();
      game.scene.configureTwoPlayerMode(false);
      vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
      vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
      vi.spyOn(Pokemon.prototype, "generateAndPopulateMoveset").mockImplementation(function (this: Pokemon) {
        this.moveset = [MoveId.SPLASH, MoveId.TACKLE, MoveId.GROWL, MoveId.FIRE_FANG].map(
          move => new PokemonMove(move),
        );
      });
    });

    function makeMember(trainerType: TrainerType, index: number, species?: SpeciesId) {
      const trainer = new Trainer(trainerType, TrainerVariant.DEFAULT);
      game.scene.currentBattle = new Battle(game.scene.gameMode, {
        waveIndex: 165,
        battleType: BattleType.TRAINER,
        trainer,
        double: false,
      });
      if (species !== undefined) {
        vi.spyOn(Phaser.Math.RND, "pick").mockReturnValueOnce(species);
      }
      const pokemon = trainerConfigs[trainerType].partyMemberFuncs[index](
        100,
        PartyMemberStrength.STRONGER,
        EvoLevelThresholdKind.STRONG,
      );
      game.scene.currentBattle.enemyParty.push(pokemon);
      return pokemon;
    }

    it("gives Iris's Reshiram Fusion Flare instead of Fire Fang", () => {
      const pokemon = makeMember(TrainerType.IRIS, 4);
      expect(pokemon.species.speciesId).toBe(SpeciesId.RESHIRAM);
      expect(pokemon.moveset.map(move => move.moveId)).toContain(MoveId.FUSION_FLARE);
      expect(pokemon.moveset.map(move => move.moveId)).not.toContain(MoveId.FIRE_FANG);
    });

    it.each([
      [TrainerType.LYSANDRE, 3],
      [TrainerType.LYSANDRE_2, 2],
    ])("adds King's Shield to trainer %i's existing Aegislash slot %i", (trainerType, index) => {
      const pokemon = makeMember(trainerType, index, SpeciesId.AEGISLASH);
      expect(pokemon.species.speciesId).toBe(SpeciesId.AEGISLASH);
      expect(pokemon.moveset.map(move => move.moveId)).toContain(MoveId.KINGS_SHIELD);
      expect(pokemon.moveset).toHaveLength(4);
    });

    it("does not duplicate King's Shield if Aegislash already generated it", () => {
      vi.mocked(Pokemon.prototype.generateAndPopulateMoveset).mockImplementation(function (this: Pokemon) {
        this.moveset = [MoveId.KINGS_SHIELD, MoveId.TACKLE, MoveId.GROWL, MoveId.SPLASH].map(
          move => new PokemonMove(move),
        );
      });
      const pokemon = makeMember(TrainerType.LYSANDRE, 3, SpeciesId.AEGISLASH);
      expect(pokemon.moveset.filter(move => move.moveId === MoveId.KINGS_SHIELD)).toHaveLength(1);
      expect(pokemon.moveset[3].moveId).toBe(MoveId.SPLASH);
    });

    it.each([
      [TrainerType.LYSANDRE, 3],
      [TrainerType.LYSANDRE_2, 2],
    ])("keeps Hisuian Goodra available without King's Shield for trainer %i", (trainerType, index) => {
      const pokemon = makeMember(trainerType, index, SpeciesId.HISUI_GOODRA);
      expect(pokemon.species.speciesId).toBe(SpeciesId.HISUI_GOODRA);
      expect(pokemon.moveset.map(move => move.moveId)).not.toContain(MoveId.KINGS_SHIELD);
    });
  });
});
