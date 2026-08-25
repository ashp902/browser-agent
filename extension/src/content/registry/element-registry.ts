// Element registry (docs/03 §2).
//
// Per-document mapping between live DOM elements and opaque numeric IDs. The
// model only ever sees IDs from the latest observation; selectors never cross
// the boundary (ADR-007). MVP uses strong reverse references (explicitly
// permitted by docs/03 §2); the whole registry dies with the content-script
// document, so entries are effectively cleared on unload.

import type { ElementLookup } from './element-lookup';

export class ElementRegistry {
  private nextId = 1;
  private readonly elementToId = new WeakMap<Element, number>();
  private readonly idToElement = new Map<number, Element>();

  /** Returns the stable ID for an element, assigning a new one on first sight.
   * IDs are monotonic and never reused within a document (docs/03 §2.1). */
  getOrAssignId(element: Element): number {
    const existing = this.elementToId.get(element);
    if (existing !== undefined) {
      return existing;
    }
    const id = this.nextId;
    this.nextId += 1;
    this.elementToId.set(element, id);
    this.idToElement.set(id, element);
    return id;
  }

  /** Resolves a previously assigned ID. Returns undefined for unknown IDs. */
  resolve(elementId: number): Element | undefined {
    const element = this.idToElement.get(elementId);
    if (element === undefined) {
      return undefined;
    }
    // A collected/detached subtree may still be strongly referenced here;
    // connection checks happen at validation time (docs/03 §6), not here.
    return element;
  }

  /** Reverse lookup: does this element currently hold an ID? */
  lookup = (element: Element): number | undefined => this.elementToId.get(element);

  /** Adapter so the extractor can ask "is this element registered?" without
   * assigning. */
  asLookup(): ElementLookup {
    return { lookup: this.lookup };
  }

  /** Test/diagnostic only. */
  get size(): number {
    return this.idToElement.size;
  }
}
