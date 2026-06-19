import { globalScene } from "#app/global-scene";

const STANDALONE_ITEM_ICONS = new Set(["shiny_badge"]);

export function addModifierIconSprite(x: number, y: number, iconImage: string): Phaser.GameObjects.Sprite {
  if (STANDALONE_ITEM_ICONS.has(iconImage) && globalScene.textures.exists(iconImage)) {
    return globalScene.add.sprite(x, y, iconImage);
  }

  return globalScene.add.sprite(x, y, "items", iconImage);
}
