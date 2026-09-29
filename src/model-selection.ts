export interface AvailableModelRef {
  provider: string;
  id: string;
}

/** Return the first requested model present in Pi's authenticated model catalog. */
export function selectPreferredModel<T extends AvailableModelRef>(
  preferenceOrder: string[],
  available: readonly T[],
): T | undefined {
  for (const name of preferenceOrder) {
    const separator = name.indexOf("/");
    if (separator < 1) continue;
    const provider = name.slice(0, separator);
    const id = name.slice(separator + 1);
    const match = available.find((model) => model.provider === provider && model.id === id);
    if (match) return match;
  }
  return undefined;
}
