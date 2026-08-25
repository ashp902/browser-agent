// Source-of-truth semantic model types (docs/02 §3, §8, §15).
//
// The structured PageSnapshot is the source of truth; the compact LLM
// serialization is derived from it (docs/00 §3.4). No DOM handles, selectors,
// CSS classes, or coordinates ever appear in the model-facing representation.
// Wire-facing contracts (fingerprint/stats/observation) live in
// src/shared/semantic-contracts.ts and are re-exported here for cohesion.

import type { SemanticFingerprint, SnapshotStats } from '../../shared/semantic-contracts';

export type { SemanticFingerprint, SnapshotStats };

export type SemanticRole =
  | 'document'
  | 'main'
  | 'navigation'
  | 'region'
  | 'form'
  | 'group'
  | 'dialog'
  | 'alertdialog'
  | 'heading'
  | 'paragraph'
  | 'text'
  | 'link'
  | 'button'
  | 'textbox'
  | 'searchbox'
  | 'checkbox'
  | 'radio'
  | 'switch'
  | 'combobox'
  | 'listbox'
  | 'option'
  | 'slider'
  | 'spinbutton'
  | 'tablist'
  | 'tab'
  | 'tabpanel'
  | 'menu'
  | 'menuitem'
  | 'list'
  | 'listitem'
  | 'table'
  | 'rowgroup'
  | 'row'
  | 'columnheader'
  | 'rowheader'
  | 'cell'
  | 'image'
  | 'separator'
  | 'generic';

export interface SemanticStates {
  disabled?: boolean;
  checked?: boolean | 'mixed';
  selected?: boolean;
  expanded?: boolean;
  pressed?: boolean | 'mixed';
  required?: boolean;
  readonly?: boolean;
  invalid?: boolean;
  hidden?: boolean;
  current?: string | boolean;
  busy?: boolean;
}

export interface SemanticOptionSummary {
  value: string;
  label: string;
  selected: boolean;
  disabled?: boolean;
}

/** Semantic fingerprint used for action-target revalidation (docs/02 §20). */
// (Defined in shared/semantic-contracts.ts; re-exported above.)

/** Internal sensitivity marker (docs/02 §9, docs/06 §6). Never serialized into
 * model-facing text; used so telemetry can redact and the executor can refuse
 * secret fields. */
export type Sensitivity = 'secret' | 'pii';

export interface SemanticNode {
  node_id: number;
  element_id?: number;
  role: SemanticRole;
  name?: string;
  description?: string;
  text?: string;
  level?: number;
  href?: string;
  value?: string;
  placeholder?: string;
  states?: SemanticStates;
  options?: SemanticOptionSummary[];
  children: number[];
  inferred_group?: boolean;
  source_tag?: string;
  /** Present on actionable element-backed nodes; copied into action requests. */
  fingerprint?: SemanticFingerprint;
  /** Internal-only classification; never present in compact serialization. */
  sensitivity?: Sensitivity;
}

// Deterministic size limits (docs/02 §16).
export const MAX_NODE_NAME_CHARS = 200;
export const MAX_NODE_DESCRIPTION_CHARS = 400;
export const MAX_TEXT_NODE_CHARS = 500;
export const MAX_SNAPSHOT_SERIALIZED_CHARS = 60_000;
export const MAX_OPTIONS_INLINE = 50;

export interface PageSnapshot {
  schema_version: 1;
  document_id: string;
  mutation_epoch: number;
  snapshot_id: string;
  captured_at_ms: number;
  url: string;
  origin: string;
  title: string;
  focused_element_id?: number;
  nodes: Record<number, SemanticNode>;
  root_node_id: number;
  stats: SnapshotStats;
}
