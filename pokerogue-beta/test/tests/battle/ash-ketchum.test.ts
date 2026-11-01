import { speciesDataRegistry } from "#app/global-species-data-registry";
import { EvolutionItem } from "#balance/pokemon-evolutions";
import { PLAYER_TRAINER_SPRITE_OPTIONS, PlayerTrainerSprite } from "#enums/player-trainer-sprite";
import { SpeciesId } from "#enums/species-id";
import { Pokemon } from "#field/pokemon";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { createComputerPartnerStarter, getComputerPartnerProfile } from "#utils/computer-partner-profile";
import { validateRunPlayerAppearances } from "#utils/player-card";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Ash Ketchum's Partner Cap Pikachu", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  beforeAll(() => { phaserGame = new Phaser.Game({ type: Phaser.HEADLESS }); });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 2);
    game.scene.setComputerPartnerKey(1, "ash_ketchum");
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue(undefined);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
  });

  it("starts with his capped Ace, retaining its form on reload without enabling either Raichu evolution", async () => {
    const profile = getComputerPartnerProfile("ash_ketchum");
    const starters = createComputerPartnerStarter(profile, game.scene.gameData.getComputerPartnerProgress(profile.key), 6, 1);
    expect(starters).toHaveLength(1);
    await new SelectStarterPhase().initPlayerStarters(starters, 1);
    const [ace] = game.scene.getPlayerParty(1);
    expect(ace.species.speciesId).toBe(SpeciesId.PIKACHU);
    expect(ace.computerPartnerAce).toBe(true);
    expect(ace.getFormKey()).toBe("partner-cap");
    const restored = new PokemonData(JSON.parse(JSON.stringify(new PokemonData(ace)))).toPokemon();
    expect(restored.getFormKey()).toBe("partner-cap");
    expect(restored.isPlayer() && restored.computerPartnerAce).toBe(true);
    const partner = game.scene.addPlayerPokemon(ace.species, 100, 0, 1);
    expect(ace.getSpeciesForm().baseStats).toEqual(partner.getSpeciesForm().baseStats);
    expect(ace.getSpeciesForm().getLevelMoves()).toEqual(partner.getSpeciesForm().getLevelMoves());
    const evolutions = speciesDataRegistry.getEvolutions(SpeciesId.PIKACHU);
    for (const stone of [EvolutionItem.THUNDER_STONE, EvolutionItem.SHINY_STONE]) {
      expect(evolutions.some(e => e.validate(partner, false, stone))).toBe(true);
      expect(evolutions.some(e => e.validate(ace, false, stone))).toBe(false);
    }
    expect(ace.getSpeciesForm().isStarterSelectable).toBe(false);
    expect(game.scene.getTrainerSprite(1)).toBe(PlayerTrainerSprite.ASH_KETCHUM);
    expect(PLAYER_TRAINER_SPRITE_OPTIONS.some(o => o.sprite === PlayerTrainerSprite.ASH_KETCHUM)).toBe(false);
    expect(validateRunPlayerAppearances({ 1: "ash_ketchum_back" })).toEqual({ 1: "ash_ketchum_back" });
  });

  it("loads capped front and back assets in either sprite mode, with both shinies and Partner palettes", () => {
    const species = getPokemonSpecies(SpeciesId.PIKACHU);
    const index = species.forms.findIndex(f => f.formKey === "partner-cap");
    const read = (path: string) => JSON.parse(readFileSync("assets/" + path, "utf8"));
    const exp = read("exp-sprites.json");
    const variants = read("images/pokemon/variant/_masterlist.json");
    for (const back of [false, true]) {
      const side = back ? "back/" : "";
      expect((back ? variants.back : variants)["25-partner-cap"]).toEqual([0, 1, 1]);
      for (const mode of ["", "exp/"]) {
        const palette = (stem: string) => read("images/pokemon/variant/" + stem + ".json");
        expect(palette(mode + side + "25-partner-cap")).toEqual(palette(side + "25-partner"));
        for (const shiny of [false, true]) {
          const key = side + (shiny ? "shiny/" : "") + "25-partner-cap";
          expect(species.getSpriteAtlasPath(true, index, shiny, 0, back)).toBe(key);
          expect(exp).toContain("25" + (shiny ? "s" : "") + (back ? "b" : "") + "-partner-cap");
          const atlas = read("images/pokemon/" + mode + key + ".json").textures[0];
          const png = readFileSync("assets/images/pokemon/" + mode + key + ".png");
          expect(atlas.size).toEqual({ w: png.readUInt32BE(16), h: png.readUInt32BE(20) });
          expect(atlas.frames).toHaveLength(mode ? (back ? 113 : 112) : 1);
        }
      }
    }
  });
});
