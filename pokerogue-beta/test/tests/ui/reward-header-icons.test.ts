import { BerryType } from "#enums/berry-type";
import { UiMode } from "#enums/ui-mode";
import { BerryModifierType } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const resistanceBerries = [
  BerryType.OCCA,
  BerryType.PASSHO,
  BerryType.WACAN,
  BerryType.RINDO,
  BerryType.YACHE,
  BerryType.CHOPLE,
  BerryType.KEBIA,
  BerryType.SHUCA,
  BerryType.COBA,
  BerryType.PAYAPA,
  BerryType.TANGA,
  BerryType.CHARTI,
  BerryType.KASIB,
  BerryType.HABAN,
  BerryType.COLBUR,
  BerryType.BABIRI,
  BerryType.CHILAN,
  BerryType.ROSELI,
];

describe("UI - Reward header icons", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    vi.spyOn(game.scene.textures, "exists").mockImplementation(key => key === "roseli_berry");
  });

  it("resolves every resistance berry in the standard reward description header", () => {
    const header = game.scene.ui.getMessageHandler();
    const setTexture = vi.spyOn(header["nameIcon"], "setTexture");
    const atlas = JSON.parse(readFileSync("assets/images/items.json", "utf8"));
    const frames = new Set(atlas.textures[0].frames.map((frame: { filename: string }) => frame.filename));

    for (const berry of resistanceBerries) {
      const type = new BerryModifierType(berry);
      header.showNameText(type.name, type.iconImage);
      if (berry === BerryType.ROSELI) {
        expect(setTexture).toHaveBeenLastCalledWith("roseli_berry");
      } else {
        expect(frames.has(type.iconImage)).toBe(true);
        expect(setTexture).toHaveBeenLastCalledWith("items", type.iconImage);
      }
    }
  });

  it("shows the full long reward description and clears it on the next selection", () => {
    const header = game.scene.ui.getMessageHandler();
    vi.spyOn(game.scene.ui, "getMode").mockReturnValue(UiMode.MODIFIER_SELECT);
    const detail = header["rewardDetail"];
    const visible = vi.spyOn(detail, "setVisible");
    const setText = vi.spyOn(detail, "setText");
    const long = "Receive Clone Ball x1 (Inventory: 0)\nClones a Pokémon.\nCatch Rate: 100%";
    header.showText(long, 0);
    expect(setText).toHaveBeenLastCalledWith(long);
    expect(visible).toHaveBeenLastCalledWith(true);
    header.showText("Potion", 0);
    expect(visible).toHaveBeenLastCalledWith(false);
  });

  it("uses the same texture resolution for both icons in prize-counter headers", () => {
    const header = game.scene.ui.getMessageHandler();
    const leftTexture = vi.spyOn(header["nameIcon"], "setTexture");
    const rightTexture = vi.spyOn(header["nameExtraIcon"], "setTexture");

    for (const berry of resistanceBerries) {
      const type = new BerryModifierType(berry);
      header.showNameTextWithIconPair("25 =", "nugget", type.name, type.iconImage);
      expect(leftTexture).toHaveBeenLastCalledWith("items", "nugget");
      if (berry === BerryType.ROSELI) {
        expect(rightTexture).toHaveBeenLastCalledWith("roseli_berry");
      } else {
        expect(rightTexture).toHaveBeenLastCalledWith("items", type.iconImage);
      }
    }
    header.showNameTextWithIconPair("Roseli", "roseli_berry", "Clone Ball", "cb");
    expect(leftTexture).toHaveBeenLastCalledWith("roseli_berry");
    expect(rightTexture).toHaveBeenLastCalledWith("items", "cb");
  });
});
