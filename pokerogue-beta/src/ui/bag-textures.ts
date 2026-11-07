import { globalScene } from "#app/global-scene";

/** Register the supplied button states and 6x6 pocket atlas without modifying their artwork. */
export function addBagTextureFrames(): void {
  const textures = globalScene.textures;
  if (textures.exists("party_to_bag")) {
    const texture = textures.get("party_to_bag");
    if (!texture.has("normal")) {
      texture.add("normal", 0, 0, 0, 52, 16);
      texture.add("selected", 0, 0, 16, 52, 16);
    }
  }
  if (textures.exists("party_bag")) {
    const texture = textures.get("party_bag");
    if (!texture.has("normal")) {
      texture.add("normal", 0, 0, 0, 75, 25);
      texture.add("selected", 0, 0, 25, 75, 25);
    }
  }
  if (!textures.exists("bag_pockets")) {
    return;
  }
  const texture = textures.get("bag_pockets");
  for (let theme = 0; theme < 2; theme++) {
    for (let pocket = 0; pocket < 6; pocket++) {
      for (let state = 1; state <= 3; state++) {
        const key = `${theme}-${pocket}-${state}`;
        if (!texture.has(key)) {
          texture.add(
            key,
            0,
            ((pocket % 2) * 3 + state - 1) * 100,
            (theme * 3 + Math.floor(pocket / 2)) * 100,
            100,
            100,
          );
        }
      }
    }
  }
}
