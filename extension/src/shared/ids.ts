// Opaque identifier generation (docs/00 §6, docs/03 §3).

/** Envelope request identifier for local RPC. */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Per-document identifier created once at content-script initialization. A new
 * document (reload/navigation) MUST produce a new ID; old element IDs become
 * invalid (docs/01 §12).
 */
export function newDocumentId(): string {
  return crypto.randomUUID();
}
