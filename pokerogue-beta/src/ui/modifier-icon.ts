import { globalScene } from "#app/global-scene";

const STANDALONE_ITEM_ICONS = new Set([
  "air_balloon",
  "power_herb",
  "blunder_policy",
  "weakness_policy",
  "buddy_ball",
  "fashion_case",
  "big_meteor",
  "prop_case",
  "rotom_catalogue",
  "nectar_case",
  "dowsing_machine",
  "destiny_knot_red",
  "destiny_knot_pink",
  "destiny_knot_gold",
  "destiny_knot_lime",
  "destiny_knot_sky",
  "destiny_knot_blue",
  "destiny_knot_violet",
  "destiny_knot_silver",
  "destiny_knot_green",
  "ominous_skull",
  "portent_skull",
  "malefic_skull",
  "lesser_spirit",
  "greater_spirit",
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
  "roseli_berry",
]);

export function getModifierIconTexture(iconImage: string): [string, string?] {
  return STANDALONE_ITEM_ICONS.has(iconImage) && globalScene.textures.exists(iconImage)
    ? [iconImage]
    : ["items", iconImage];
}

export function addModifierIconSprite(x: number, y: number, iconImage: string): Phaser.GameObjects.Sprite {
  if (STANDALONE_ITEM_ICONS.has(iconImage) && globalScene.textures.exists(iconImage)) {
    const sprite = globalScene.add.sprite(x, y, iconImage);
    if (iconImage === "lesser_spirit" || iconImage === "greater_spirit") {
      sprite.setScale(2 / 3);
    }
    return sprite;
  }

  return globalScene.add.sprite(x, y, "items", iconImage);
}
