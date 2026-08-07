import { globalScene } from "#app/global-scene";
import { activeOverrides } from "#app/overrides";
import { getTerrainColor } from "#data/terrain";
import { TimeOfDay } from "#enums/time-of-day";
import type { RGBArray } from "#types/sprite-types";
import { isUnownCrystalGauntletWave } from "#utils/classic-final-boss-utils";
import { getCurrentTime } from "#utils/common";
import Phaser from "phaser";
import fieldSpriteFragShader from "./glsl/field-sprite-frag-shader.frag?raw";
import spriteVertShader from "./glsl/sprite-shader.vert?raw";

const CRYSTAL_BIOME_BASE_COLOR: RGBArray = [0x8f, 0x5d, 0xf7];
const CRYSTAL_BIOME_HIGHLIGHT_COLOR: RGBArray = [0xff, 0x6f, 0xe3];
const CRYSTAL_BIOME_SHADOW_COLOR: RGBArray = [0x24, 0x14, 0x5f];
const DEFAULT_CRYSTAL_BIOME_MOTION = [0, 0, 1, 1];

export class FieldSpritePipeline extends Phaser.Renderer.WebGL.Pipelines.MultiPipeline {
  constructor(game: Phaser.Game, config?: Phaser.Types.Renderer.WebGL.WebGLPipelineConfig) {
    super(
      config || {
        game,
        name: "field-sprite",
        fragShader: fieldSpriteFragShader,
        vertShader: spriteVertShader,
      },
    );
  }

  onPreRender(): void {
    this.set1f("time", 0)
      .setBoolean("ignoreTimeTint", false)
      .set1f("terrainColorRatio", 0)
      .set3fv("terrainColor", [0, 0, 0])
      .set1f("crystalBiomeTime", 0)
      .set1f("crystalBiomeStrength", 0)
      .set3fv("crystalBiomeBaseColor", [0, 0, 0])
      .set3fv("crystalBiomeHighlightColor", [0, 0, 0])
      .set3fv("crystalBiomeShadowColor", [0, 0, 0])
      .set1f("crystalBiomeHueBlend", 0)
      .set1f("crystalBiomeSaturation", 1)
      .set1f("crystalBiomeBrightness", 1)
      .set1f("crystalBiomeContrast", 1)
      .set1f("crystalBiomeShadowStrength", 0)
      .set1f("crystalBiomeHighlightStrength", 0)
      .set1f("crystalBiomePatternStrength", 0)
      .set1f("crystalBiomePatternScale", 1)
      .set1f("crystalBiomeSparkle", 0)
      .set4fv("crystalBiomeMotion", DEFAULT_CRYSTAL_BIOME_MOTION);
  }

  onBind(gameObject: Phaser.GameObjects.GameObject): void {
    super.onBind();

    const sprite = gameObject as Phaser.GameObjects.Sprite | Phaser.GameObjects.NineSlice;

    const data = sprite.pipelineData;
    const ignoreTimeTint = !!data["ignoreTimeTint"];
    const terrainColorRatio = (data["terrainColorRatio"] as number) ?? 0;
    const rawCrystalBiomeStrength = (data["crystalBiomeStrength"] as number) ?? 0;
    const crystalBiomeMotion = (data["crystalBiomeMotion"] as number[]) ?? DEFAULT_CRYSTAL_BIOME_MOTION;
    const isCrystalBiome =
      !!globalScene.currentBattle
      && isUnownCrystalGauntletWave(globalScene.currentBattle.waveIndex, globalScene.gameMode.modeId);
    const crystalBiomeStrength = isCrystalBiome ? rawCrystalBiomeStrength : 0;

    const time = globalScene.currentBattle?.waveIndex
      ? ((globalScene.currentBattle.waveIndex + globalScene.waveCycleOffset) % 40) / 40 // ((new Date().getSeconds() * 1000 + new Date().getMilliseconds()) % 10000) / 10000
      : getCurrentTime();

    this.set1f("time", time)
      .setBoolean("ignoreTimeTint", ignoreTimeTint)
      .setBoolean("isOutside", globalScene.arena.isOutside())
      .set3fv(
        "overrideTint",
        overrideTint().map(c => c / 255),
      )
      .set3fv(
        "dayTint",
        globalScene.arena.getDayTint().map(c => c / 255),
      )
      .set3fv(
        "duskTint",
        globalScene.arena.getDuskTint().map(c => c / 255),
      )
      .set3fv(
        "nightTint",
        globalScene.arena.getNightTint().map(c => c / 255),
      )
      .set3fv(
        "terrainColor",
        getTerrainColor(globalScene.arena.terrainType).map(c => c / 255),
      )
      .set1f("terrainColorRatio", terrainColorRatio)
      .set1f("crystalBiomeTime", (this.game.getTime() % 500000) / 500000)
      .set1f("crystalBiomeStrength", crystalBiomeStrength)
      .set3fv(
        "crystalBiomeBaseColor",
        CRYSTAL_BIOME_BASE_COLOR.map(c => c / 255),
      )
      .set3fv(
        "crystalBiomeHighlightColor",
        CRYSTAL_BIOME_HIGHLIGHT_COLOR.map(c => c / 255),
      )
      .set3fv(
        "crystalBiomeShadowColor",
        CRYSTAL_BIOME_SHADOW_COLOR.map(c => c / 255),
      )
      .set1f("crystalBiomeHueBlend", 1)
      .set1f("crystalBiomeSaturation", 2)
      .set1f("crystalBiomeBrightness", 1.03)
      .set1f("crystalBiomeContrast", 1.08)
      .set1f("crystalBiomeShadowStrength", 0.38)
      .set1f("crystalBiomeHighlightStrength", 0.34)
      .set1f("crystalBiomePatternStrength", 1)
      .set1f("crystalBiomePatternScale", 2.5)
      .set1f("crystalBiomeSparkle", 0.75)
      .set4fv("crystalBiomeMotion", crystalBiomeMotion);

    const teraTexture = this.game.textures.get("tera").source[0]?.glTexture;
    if (teraTexture) {
      this.bindTexture(teraTexture, 1);
    }
  }

  onBatch(gameObject: Phaser.GameObjects.GameObject): void {
    if (gameObject) {
      this.flush();
    }
  }
}

/**
 * Override the current arena tint based on the Time of day override
 * @returns The overriden tint colors as an RGB array.
 */
function overrideTint(): RGBArray {
  switch (activeOverrides.TIME_OF_DAY_OVERRIDE) {
    case TimeOfDay.DAY:
    case TimeOfDay.DAWN:
      return globalScene.arena.getDayTint();
    case TimeOfDay.DUSK:
      return globalScene.arena.getDuskTint();
    case TimeOfDay.NIGHT:
      return globalScene.arena.getNightTint();
    default:
      return [0, 0, 0];
  }
}
