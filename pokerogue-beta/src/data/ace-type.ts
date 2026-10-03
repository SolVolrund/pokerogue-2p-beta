import { PokemonType, type RegularPokemonType } from "#enums/pokemon-type";

export function normalizeAceType(value: unknown): RegularPokemonType | undefined {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= PokemonType.NORMAL
    && value <= PokemonType.FAIRY
    ? (value as RegularPokemonType)
    : undefined;
}

export function getUnlockedAceType(
  value: unknown,
  achievements: Readonly<Record<string, unknown>>,
): RegularPokemonType | undefined {
  const type = normalizeAceType(value);
  return type !== undefined && Object.hasOwn(achievements, `MONO_${PokemonType[type]}`) ? type : undefined;
}
