import { speciesDataRegistry } from "#app/global-species-data-registry";

/** Use original starter costs, unaffected by profile candy discounts. */
export function getRewardPokemonSpeciesPool(minCost: number, maxCost: number) {
  return speciesDataRegistry.getAllStarters().filter(speciesId => {
    const cost = speciesDataRegistry.getStarterCost(speciesId);
    return cost >= minCost && cost <= maxCost;
  });
}
