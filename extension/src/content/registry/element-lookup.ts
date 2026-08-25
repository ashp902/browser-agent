/** Minimal reverse-lookup surface the extractor needs from the registry. */
export interface ElementLookup {
  lookup(element: Element): number | undefined;
}
