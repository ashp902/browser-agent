// DOM -> semantic tree extraction (docs/02 §4-§14).
//
// Three-phase construction per docs/02 §10: select semantic content, retain
// semantic containers (including conservative repeated-group inference), then
// collapse useless wrappers. The structured PageSnapshot built here is the
// source of truth; the compact text view is derived from it (serializer.ts).

import {
  computeAccessibleName,
  computeDescription,
  normalizeText,
  truncate,
} from './accessible-name';
import {
  computeMetrics,
  isActionableRole,
  qualifiesAsInferredGroup,
  type ElementMetrics,
} from './grouping';
import { deriveRole } from './roles';
import { classifyFieldSensitivity } from './sensitivity';
import {
  MAX_TEXT_NODE_CHARS,
  type PageSnapshot,
  type SemanticFingerprint,
  type SemanticNode,
  type SemanticOptionSummary,
  type SemanticRole,
  type SemanticStates,
  type SnapshotStats,
} from './types';
import { createVisibilityContext, isSemanticallyHidden, type VisibilityContext } from './visibility';
import type { ElementRegistry } from '../registry/element-registry';

// Subtrees that carry no usable semantics for the agent (docs/02 §21 records
// canvas/iframe limitations explicitly).
const SKIP_SUBTREE_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'SVG',
  'CANVAS',
  'IFRAME',
  'HEAD',
  'TITLE',
  'META',
  'LINK',
  'BR',
  'WBR',
]);

// Structural containers that receive an inspectable element_id (docs/02 §3:
// element_id exists for actionable or inspectable element-backed nodes).
const INSPECTABLE_CONTAINER_ROLES: ReadonlySet<SemanticRole> = new Set([
  'main',
  'navigation',
  'region',
  'form',
  'group',
  'dialog',
  'alertdialog',
  'table',
  'rowgroup',
  'row',
  'list',
  'listitem',
  'tablist',
  'tabpanel',
  'menu',
]);

const LEAF_TEXT_ROLES: ReadonlySet<SemanticRole> = new Set([
  'cell',
  'listitem',
  'paragraph',
  'text',
  'columnheader',
  'rowheader',
]);

interface WalkResult {
  nodeIds: number[];
  /** Normalized orphan text runs bubbling up from collapsed wrappers. */
  texts: string[];
}

interface BuildContext {
  doc: Document;
  registry: ElementRegistry;
  visibility: VisibilityContext;
  metrics: Map<Element, ElementMetrics>;
  nodes: Record<number, SemanticNode>;
  nextNodeId: number;
  truncatedNodes: number;
  actionableCount: number;
}

export interface SnapshotBuildOptions {
  documentId: string;
  mutationEpoch: number;
  registry: ElementRegistry;
  snapshotId: string;
  capturedAtMs: number;
}

function addNode(ctx: BuildContext, node: Omit<SemanticNode, 'node_id'>): number {
  const nodeId = ctx.nextNodeId;
  ctx.nextNodeId += 1;
  ctx.nodes[nodeId] = { ...node, node_id: nodeId };
  return nodeId;
}

/** Element-backed nodes get registry IDs (actionable or inspectable). */
function maybeRegisterElement(
  ctx: BuildContext,
  element: Element,
  role: SemanticRole,
): number | undefined {
  if (isActionableRole(role) || INSPECTABLE_CONTAINER_ROLES.has(role)) {
    return ctx.registry.getOrAssignId(element);
  }
  return undefined;
}

/**
 * Computes the semantic fingerprint for an element (docs/02 §20). Exported so
 * the action executor recomputes fingerprints with identical semantics during
 * target revalidation (docs/03 §6 step 4).
 */
export function computeSemanticFingerprint(
  element: Element,
  role: SemanticRole,
  name: string,
): SemanticFingerprint {
  const fingerprint: SemanticFingerprint = {
    role,
    normalized_name: name.toLowerCase(),
    tag_name: element.tagName.toLowerCase(),
  };
  if (element.tagName === 'INPUT') {
    fingerprint.input_type = (element.getAttribute('type') ?? 'text').toLowerCase();
  }
  if (element.tagName === 'A') {
    const href = (element as HTMLAnchorElement).href;
    if (href) {
      try {
        fingerprint.href_origin = new URL(href).origin;
      } catch {
        // Unparseable href: omit origin; fingerprint still matches on the rest.
      }
    }
  }
  return fingerprint;
}

function computeFingerprint(element: Element, role: SemanticRole, name: string): SemanticFingerprint {
  return computeSemanticFingerprint(element, role, name);
}

function computeStates(element: Element, role: SemanticRole): SemanticStates | undefined {
  const states: SemanticStates = {};
  const aria = (name: string) => element.getAttribute(name);

  if (element.hasAttribute('disabled') || aria('aria-disabled') === 'true') {
    states.disabled = true;
  }

  if (role === 'checkbox' || role === 'radio' || role === 'switch') {
    const ariaChecked = aria('aria-checked');
    if (ariaChecked === 'mixed') {
      states.checked = 'mixed';
    } else if (ariaChecked === 'true' || ariaChecked === 'false') {
      states.checked = ariaChecked === 'true';
    } else if (element.tagName === 'INPUT') {
      states.checked = (element as HTMLInputElement).checked;
    }
  }

  if (role === 'option' || role === 'tab') {
    const ariaSelected = aria('aria-selected');
    if (ariaSelected === 'true' || ariaSelected === 'false') {
      states.selected = ariaSelected === 'true';
    } else if (element.tagName === 'OPTION') {
      states.selected = (element as HTMLOptionElement).selected;
    }
  }

  if (aria('aria-expanded') === 'true' || aria('aria-expanded') === 'false') {
    states.expanded = aria('aria-expanded') === 'true';
  }

  const ariaPressed = aria('aria-pressed');
  if (ariaPressed === 'true' || ariaPressed === 'false' || ariaPressed === 'mixed') {
    states.pressed = ariaPressed === 'mixed' ? 'mixed' : ariaPressed === 'true';
  }

  if (element.hasAttribute('required') || aria('aria-required') === 'true') {
    states.required = true;
  }

  // Contenteditable is read-only for MVP actuation (docs/02 §4.1).
  if (
    element.hasAttribute('readonly') ||
    aria('aria-readonly') === 'true' ||
    (element as HTMLElement).isContentEditable === true
  ) {
    states.readonly = true;
  }

  if (aria('aria-invalid') === 'true') {
    states.invalid = true;
  }

  const ariaCurrent = aria('aria-current');
  if (ariaCurrent !== null && ariaCurrent !== 'false') {
    states.current = ariaCurrent === 'true' ? true : ariaCurrent;
  }

  if (aria('aria-busy') === 'true') {
    states.busy = true;
  }

  return Object.keys(states).length > 0 ? states : undefined;
}

function computeSelectOptions(element: Element): SemanticOptionSummary[] {
  if (element.tagName !== 'SELECT') return [];
  const select = element as HTMLSelectElement;
  return Array.from(select.options).map((option) => ({
    value: option.value,
    label: normalizeText(option.textContent ?? ''),
    selected: option.selected,
    ...(option.disabled ? { disabled: true } : {}),
  }));
}

function computeValue(element: Element, role: SemanticRole): string | undefined {
  const sensitivity = classifyFieldSensitivity(element);
  // Secret fields never expose values (docs/02 §9, docs/06 §5.2).
  if (sensitivity === 'secret') return undefined;

  if (element.tagName === 'TEXTAREA') {
    return (element as HTMLTextAreaElement).value;
  }
  if (element.tagName === 'SELECT') {
    return (element as HTMLSelectElement).value;
  }
  if (element.tagName === 'INPUT') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    if (role === 'textbox' || role === 'searchbox' || role === 'spinbutton' || type === 'range') {
      return (element as HTMLInputElement).value;
    }
  }
  return undefined;
}

/**
 * Creates the semantic node for one retained element. Returns the node id, or
 * undefined when the element turns out not to merit a node.
 */
function createElementNode(
  element: Element,
  role: SemanticRole,
  childIds: number[],
  ctx: BuildContext,
): number | undefined {
  const nameResult = computeAccessibleName(element, role);
  if (nameResult.truncated) ctx.truncatedNodes += 1;
  const descriptionResult = computeDescription(element);
  if (descriptionResult.truncated) ctx.truncatedNodes += 1;

  const actionable = isActionableRole(role);
  const metrics = ctx.metrics.get(element);

  // Structural containers without content and without a name carry no
  // comprehension value (docs/02 §4.2 "when they contain included
  // descendants").
  const structural =
    INSPECTABLE_CONTAINER_ROLES.has(role) || role === 'generic';
  if (!actionable && structural && childIds.length === 0 && !nameResult.name) {
    return undefined;
  }

  const elementId = maybeRegisterElement(ctx, element, role);
  if (actionable) ctx.actionableCount += 1;

  const node: Omit<SemanticNode, 'node_id'> = {
    role,
    children: childIds,
    source_tag: element.tagName.toLowerCase(),
    ...(elementId !== undefined ? { element_id: elementId } : {}),
    ...(nameResult.name ? { name: nameResult.name } : {}),
    ...(descriptionResult.description ? { description: descriptionResult.description } : {}),
  };

  if (role === 'heading') {
    node.level = deriveRole(element).level ?? 2;
  }

  const states = computeStates(element, role);
  if (states) node.states = states;

  if (actionable) {
    node.fingerprint = computeFingerprint(element, role, nameResult.name);
  }

  const sensitivity = classifyFieldSensitivity(element);
  if (sensitivity) node.sensitivity = sensitivity;

  const value = computeValue(element, role);
  if (value !== undefined && value !== '') {
    const truncatedValue = truncate(value, MAX_TEXT_NODE_CHARS);
    if (truncatedValue.truncated) ctx.truncatedNodes += 1;
    node.value = truncatedValue.text;
  }

  const placeholder = element.getAttribute('placeholder');
  if (placeholder && actionable) {
    node.placeholder = normalizeText(placeholder);
  }

  if (element.tagName === 'A' && role === 'link') {
    const href = (element as HTMLAnchorElement).href;
    if (href) node.href = href;
  }

  if (element.tagName === 'SELECT') {
    node.options = computeSelectOptions(element);
  }

  // Leaf text for cell/listitem/paragraph: concise own content, excluding the
  // case where the cell/listitem exists only to hold actionable children.
  if (LEAF_TEXT_ROLES.has(role) && element.tagName !== 'P') {
    const directText = normalizeText(
      Array.from(element.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join(' '),
    );
    const fullText = normalizeText(element.textContent ?? '');
    const hasActionableDescendant = (metrics?.actionableCount ?? 0) > 0;
    const raw = hasActionableDescendant ? directText : fullText;
    if (raw) {
      const truncatedText = truncate(raw, MAX_TEXT_NODE_CHARS);
      if (truncatedText.truncated) ctx.truncatedNodes += 1;
      node.text = truncatedText.text;
    }
  }
  if (element.tagName === 'P' && role !== 'heading') {
    const fullText = normalizeText(element.textContent ?? '');
    if (fullText) {
      const truncatedText = truncate(fullText, MAX_TEXT_NODE_CHARS);
      if (truncatedText.truncated) ctx.truncatedNodes += 1;
      node.text = truncatedText.text;
    }
  }

  return addNode(ctx, node);
}

/** Creates a TEXT pseudo-node for descriptive text near controls. */
function createTextNode(text: string, ctx: BuildContext): number {
  const truncatedText = truncate(text, MAX_TEXT_NODE_CHARS);
  if (truncatedText.truncated) ctx.truncatedNodes += 1;
  return addNode(ctx, { role: 'text', text: truncatedText.text, children: [] });
}

/**
 * Assigns registry IDs in document order before tree construction so snapshot
 * IDs read naturally and stay deterministic for golden fixtures.
 */
function assignElementIdsInDocumentOrder(body: Element | null, ctx: BuildContext): void {
  if (!body) return;
  const visit = (element: Element): void => {
    if (SKIP_SUBTREE_TAGS.has(element.tagName)) return;
    if (isSemanticallyHidden(element, ctx.visibility)) return;
    const role = deriveRole(element).role;
    if (isActionableRole(role) || INSPECTABLE_CONTAINER_ROLES.has(role)) {
      ctx.registry.getOrAssignId(element);
    }
    // Native select options are consumed as option summaries, not walked.
    if (element.tagName !== 'SELECT') {
      for (const child of Array.from(element.children)) visit(child);
    }
  };
  visit(body);
}

interface ChildRuns {
  childIds: number[];
  orphanTexts: string[];
}

/**
 * True when the paragraph's parent is a semantic group context: an inferred
 * repeated container or a named structural group holding controls. Short
 * descriptive facts inside such groups become `text` nodes. Plain labeled
 * regions deliberately do not qualify - their long-form prose stays
 * `paragraph` so it remains prunable under snapshot-size pressure
 * (docs/02 §16).
 */
function parentIsGroupContext(element: Element, ctx: BuildContext): boolean {
  const parent = element.parentElement;
  if (!parent) return false;
  const parentRole = deriveRole(parent).role;
  if (parentRole === 'group') return true;
  const parentHasControls = (ctx.metrics.get(parent)?.actionableCount ?? 0) > 0;
  if (!parentHasControls) return false;
  if (parentRole === 'dialog' || parentRole === 'form') {
    return true;
  }
  if (parentRole === 'generic') {
    return qualifiesAsInferredGroup(parent, ctx.metrics);
  }
  return false;
}

function collectChildRuns(element: Element, ctx: BuildContext): ChildRuns {
  const childIds: number[] = [];
  const orphanTexts: string[] = [];
  let pendingText = '';

  const flushPendingText = () => {
    const text = normalizeText(pendingText);
    pendingText = '';
    if (text) orphanTexts.push(text);
  };

  // Native select options are consumed as option summaries, not walked.
  if (element.tagName !== 'SELECT') {
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        pendingText += ` ${child.textContent ?? ''}`;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        flushPendingText();
        const result = walkElement(child as Element, ctx);
        childIds.push(...result.nodeIds);
        orphanTexts.push(...result.texts);
      }
    }
    flushPendingText();
  }

  return { childIds, orphanTexts };
}

function walkElement(element: Element, ctx: BuildContext): WalkResult {
  if (SKIP_SUBTREE_TAGS.has(element.tagName)) {
    return { nodeIds: [], texts: [] };
  }
  if (isSemanticallyHidden(element, ctx.visibility)) {
    return { nodeIds: [], texts: [] };
  }

  // Wrapping labels never become nodes: their text is already consumed as the
  // wrapped control's accessible name (docs/02 §7 rule 3).
  if (element.tagName === 'LABEL') {
    const { childIds } = collectChildRuns(element, ctx);
    return { nodeIds: childIds, texts: [] };
  }

  // Legend/caption text is consumed as their container's accessible name
  // (docs/02 §14); emitting it twice would duplicate the group label.
  if (element.tagName === 'LEGEND' || element.tagName === 'CAPTION') {
    const { childIds } = collectChildRuns(element, ctx);
    return { nodeIds: childIds, texts: [] };
  }

  const derived = deriveRole(element);
  let role = derived.role;

  const { childIds, orphanTexts } = collectChildRuns(element, ctx);

  // Paragraph text policy (docs/02 §4.3): a <p> inside a semantic group
  // containing controls is a short descriptive fact (text); elsewhere it is
  // article-style prose (paragraph).
  if (element.tagName === 'P' && role === 'paragraph') {
    if (parentIsGroupContext(element, ctx)) {
      role = 'text';
    }
  }

  // Buttons/links consume their text as their accessible name; headings too.
  const consumesOwnText =
    isActionableRole(role) || role === 'heading' || role === 'image';

  const retained =
    isActionableRole(role) ||
    role === 'heading' ||
    role === 'paragraph' ||
    role === 'text' ||
    role === 'separator' ||
    (role === 'image' && Boolean(computeAccessibleName(element, role).name)) ||
    INSPECTABLE_CONTAINER_ROLES.has(role) ||
    // Table content roles carry row-identifying text (docs/02 §12).
    role === 'cell' ||
    role === 'columnheader' ||
    role === 'rowheader';

  if (role === 'generic') {
    // Repeated-container inference (docs/02 §11).
    if (qualifiesAsInferredGroup(element, ctx.metrics)) {
      const groupId = addNode(ctx, {
        role: 'group',
        inferred_group: true,
        children: [],
        source_tag: element.tagName.toLowerCase(),
        ...(isActionableRole('group') || INSPECTABLE_CONTAINER_ROLES.has('group')
          ? (() => {
              const elementId = ctx.registry.getOrAssignId(element);
              return elementId !== undefined ? { element_id: elementId } : {};
            })()
          : {}),
      });
      // Adopt descriptive text runs when the group contains controls.
      const own = ctx.metrics.get(element);
      const finalChildren: number[] = [];
      if ((own?.actionableCount ?? 0) > 0) {
        for (const text of orphanTexts) finalChildren.push(createTextNode(text, ctx));
      }
      ctx.nodes[groupId].children = [...finalChildren, ...childIds];
      return { nodeIds: [groupId], texts: [] };
    }

    // Wrapper collapsing (docs/02 §10.3): no name/text/state, single retained
    // child -> child re-parents upward.
    if (childIds.length === 0) {
      return { nodeIds: [], texts: orphanTexts };
    }
    if (childIds.length === 1 && orphanTexts.length === 0) {
      return { nodeIds: childIds, texts: [] };
    }
    // Multiple retained children, or text plus children: retain as generic.
    const genericId = addNode(ctx, {
      role: 'generic',
      children: [],
      source_tag: element.tagName.toLowerCase(),
    });
    const own = ctx.metrics.get(element);
    const textIds =
      (own?.actionableCount ?? 0) > 0 ? orphanTexts.map((t) => createTextNode(t, ctx)) : [];
    ctx.nodes[genericId].children = interleaveTextFirst(textIds, childIds);
    return { nodeIds: [genericId], texts: [] };
  }

  if (!retained) {
    return { nodeIds: [], texts: orphanTexts };
  }

  const nodeId = createElementNode(element, role, childIds, ctx);
  if (nodeId === undefined) {
    return { nodeIds: [], texts: orphanTexts };
  }

  // Containers with controls adopt orphan descriptive text as TEXT children;
  // text-bearing leaves already consumed their own text above.
  const node = ctx.nodes[nodeId];
  const own = ctx.metrics.get(element);
  if (
    !LEAF_TEXT_ROLES.has(role) &&
    !consumesOwnText &&
    (own?.actionableCount ?? 0) > 0 &&
    orphanTexts.length > 0
  ) {
    const textIds = orphanTexts.map((t) => createTextNode(t, ctx));
    node.children = interleaveTextFirst(textIds, childIds);
  }
  return { nodeIds: [nodeId], texts: [] };
}

/** Text describing a control group reads most naturally before the controls. */
function interleaveTextFirst(textIds: number[], childIds: number[]): number[] {
  return [...textIds, ...childIds];
}

/**
 * Builds the source-of-truth PageSnapshot from the live document
 * (docs/02 §18 steps 1-7).
 */
export function buildPageSnapshot(doc: Document, options: SnapshotBuildOptions): PageSnapshot {
  const ctx: BuildContext = {
    doc,
    registry: options.registry,
    visibility: createVisibilityContext(doc),
    metrics: new Map(),
    nodes: {},
    nextNodeId: 1,
    truncatedNodes: 0,
    actionableCount: 0,
  };
  if (doc.body) {
    ctx.metrics = computeMetrics(doc.body, ctx.visibility);
    // Stable, document-ordered element IDs (docs/03 §2.1).
    assignElementIdsInDocumentOrder(doc.body, ctx);
  }

  const rootChildren: number[] = [];
  if (doc.body) {
    for (const child of Array.from(doc.body.children)) {
      const result = walkElement(child, ctx);
      rootChildren.push(...result.nodeIds);
      // Orphan text at document root without a retained container is dropped:
      // page-level prose belongs to <p> elements, which are always retained.
    }
  }

  const rootNodeId = addNode(ctx, { role: 'document', children: rootChildren });

  const focused = doc.activeElement;
  const focusedId = focused ? options.registry.lookup(focused) : undefined;

  const stats: SnapshotStats = {
    node_count: Object.keys(ctx.nodes).length,
    actionable_count: ctx.actionableCount,
    truncated_nodes: ctx.truncatedNodes,
    snapshot_truncated: false,
    serialized_chars: 0,
  };

  const snapshot: PageSnapshot = {
    schema_version: 1,
    document_id: options.documentId,
    mutation_epoch: options.mutationEpoch,
    snapshot_id: options.snapshotId,
    captured_at_ms: options.capturedAtMs,
    url: doc.URL,
    origin: new URL(doc.URL).origin,
    title: doc.title,
    ...(focusedId !== undefined ? { focused_element_id: focusedId } : {}),
    nodes: ctx.nodes,
    root_node_id: rootNodeId,
    stats,
  };

  return snapshot;
}

/**
 * Nodes that may be pruned under snapshot-size pressure: standalone paragraphs
 * in reverse document order (docs/02 §16 step 4). Actionable controls and
 * their ancestors are never prunable.
 */
export function prunableNodeIds(snapshot: PageSnapshot): number[] {
  const actionableAncestors = new Set<number>();
  const markAncestors = (nodeId: number) => {
    let current = snapshot.nodes[nodeId];
    // Walk up by scanning parents (parent map derived from children lists).
    while (current) {
      const parent = Object.values(snapshot.nodes).find((n) => n.children.includes(current.node_id));
      if (!parent) break;
      if (actionableAncestors.has(parent.node_id)) break;
      actionableAncestors.add(parent.node_id);
      current = parent;
    }
  };
  for (const node of Object.values(snapshot.nodes)) {
    if (node.element_id !== undefined && isActionableRole(node.role)) {
      actionableAncestors.add(node.node_id);
      markAncestors(node.node_id);
    }
  }

  const ids: number[] = [];
  const collect = (nodeId: number) => {
    const node = snapshot.nodes[nodeId];
    if (!node) return;
    for (const childId of node.children) collect(childId);
    if (node.role === 'paragraph' && !actionableAncestors.has(node.node_id)) {
      ids.push(node.node_id);
    }
  };
  collect(snapshot.root_node_id);
  return ids.reverse();
}

/** Returns a new snapshot without the given nodes (docs/02 §16 pruning). */
export function withoutNodes(snapshot: PageSnapshot, removedIds: ReadonlySet<number>): PageSnapshot {
  if (removedIds.size === 0) return snapshot;
  const nodes: Record<number, SemanticNode> = {};
  for (const [id, node] of Object.entries(snapshot.nodes)) {
    const numericId = Number(id);
    if (removedIds.has(numericId)) continue;
    nodes[numericId] = {
      ...node,
      children: node.children.filter((childId) => !removedIds.has(childId)),
    };
  }
  return {
    ...snapshot,
    nodes,
    stats: {
      ...snapshot.stats,
      node_count: Object.keys(nodes).length,
      snapshot_truncated: true,
    },
  };
}
