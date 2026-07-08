import { globalScene } from "#app/global-scene";

const STANDALONE_ITEM_ICONS = new Set([
  "shiny_badge",
  "pokeblock_kit_smaller",
  "pokeblock_red",
  "pokeblock_blue",
  "pokeblock_green",
  "pokeblock_yellow",
  "pokeblock_pink",
  "pokeblock_red_plus",
  "pokeblock_blue_plus",
  "pokeblock_green_plus",
  "pokeblock_yellow_plus",
  "pokeblock_pink_plus",
  "pokeblock_rainbow",
  "pokeblock_rainbow_plus",
]);

export function addModifierIconSprite(x: number, y: number, iconImage: string): Phaser.GameObjects.Sprite {
  if (STANDALONE_ITEM_ICONS.has(iconImage) && globalScene.textures.exists(iconImage)) {
    return globalScene.add.sprite(x, y, iconImage);
  }

  return globalScene.add.sprite(x, y, "items", iconImage);
}
