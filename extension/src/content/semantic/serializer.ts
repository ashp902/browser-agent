// Compact LLM-facing serialization (docs/02 §19).
//
// Deterministic custom text format derived from the structured PageSnapshot.
// Never emits CSS classes, selectors, raw HTML, inline styles, coordinates, or
// secret values (secret fields carry no value by construction).

import {
  MAX_OPTIONS_INLINE,
  type PageSnapshot,
  type SemanticNode,
  type SemanticOptionSummary,
  type SemanticStates,
} from './types';

export interface SerializeOptions {
  /** Substitutes the random snapshot id for deterministic golden outputs. */
  snapshotIdOverride?: string;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function renderStates(states: SemanticStates | undefined): string {
  if (!states) return '';
  const parts: string[] = [];
  // Fixed emission order keeps output deterministic.
  if (states.disabled === true) parts.push('disabled');
  if (states.readonly === true) parts.push('readonly');
  if (states.required === true) parts.push('required');
  if (states.invalid === true) parts.push('invalid');
  if (states.busy === true) parts.push('busy');
  if (states.hidden === true) parts.push('hidden');
  if (states.checked !== undefined) {
    parts.push(states.checked === true ? 'checked' : `checked=${states.checked}`);
  }
  if (states.selected !== undefined) {
    parts.push(states.selected ? 'selected' : 'selected=false');
  }
  if (states.expanded !== undefined) {
    parts.push(states.expanded ? 'expanded' : 'expanded=false');
  }
  if (states.pressed !== undefined) {
    parts.push(states.pressed === true ? 'pressed' : `pressed=${states.pressed}`);
  }
  if (states.current !== undefined) {
    parts.push(states.current === true ? 'current' : `current=${quote(String(states.current))}`);
  }
  return parts.length > 0 ? ` [${parts.join(' ')}]` : '';
}

function roleToken(node: SemanticNode): string {
  if (node.role === 'heading') {
    return `H${node.level ?? 2}`;
  }
  return node.role.toUpperCase();
}

function renderOptionLine(option: SemanticOptionSummary, indent: string): string {
  const label = option.label || option.value;
  const flags: string[] = [];
  if (option.selected) flags.push('selected');
  if (option.disabled) flags.push('disabled');
  return `${indent}OPTION ${quote(label)} value=${quote(option.value)}${
    flags.length > 0 ? ` [${flags.join(' ')}]` : ''
  }`;
}

/** docs/02 §15: >50 options collapse to first 20, last 5, plus the selection. */
function renderOptions(options: SemanticOptionSummary[], indent: string): string[] {
  const lines: string[] = [];
  if (options.length <= MAX_OPTIONS_INLINE) {
    for (const option of options) {
      lines.push(renderOptionLine(option, indent));
    }
    return lines;
  }

  const total = options.length;
  const emitted = new Set<number>();
  const push = (index: number) => {
    if (!emitted.has(index)) {
      emitted.add(index);
      lines.push(renderOptionLine(options[index], indent));
    }
  };
  for (let i = 0; i < 20; i += 1) push(i);
  const selectedIndex = options.findIndex((option) => option.selected);
  if (selectedIndex >= 0 && selectedIndex < total - 5) push(selectedIndex);
  for (let i = Math.max(20, total - 5); i < total; i += 1) push(i);

  const omitted = total - emitted.size;
  if (omitted > 0) {
    lines.push(`${indent}... ${omitted} of ${total} options not shown`);
  }
  return lines;
}

function renderNode(
  nodeId: number,
  snapshot: PageSnapshot,
  depth: number,
  options: SerializeOptions,
  out: string[],
): void {
  const node = snapshot.nodes[nodeId];
  if (!node) return;
  const indent = '  '.repeat(depth);

  let line = indent + roleToken(node);
  if (node.element_id !== undefined) {
    line += ` @${node.element_id}`;
  }

  switch (node.role) {
    case 'heading':
    case 'link':
    case 'button':
    case 'image':
    case 'tab':
    case 'menuitem':
    case 'group':
    case 'region':
    case 'form':
    case 'dialog':
    case 'alertdialog':
    case 'main':
    case 'navigation':
    case 'list':
    case 'listitem':
    case 'table':
    case 'rowgroup':
    case 'row':
    case 'columnheader':
    case 'rowheader':
    case 'cell':
    case 'textbox':
    case 'searchbox':
    case 'checkbox':
    case 'radio':
    case 'switch':
    case 'combobox':
    case 'listbox':
    case 'slider':
    case 'spinbutton':
    case 'tabpanel':
    case 'tablist':
    case 'menu':
    case 'separator': {
      const label = node.name ?? node.text;
      if (label) line += ` ${quote(label)}`;
      break;
    }
    case 'paragraph':
    case 'text':
    case 'generic':
    case 'document':
    case 'option': {
      if (node.text) line += ` ${quote(node.text)}`;
      else if (node.name) line += ` ${quote(node.name)}`;
      break;
    }
  }

  if (node.description) {
    line += ` description=${quote(node.description)}`;
  }
  if (node.value !== undefined && node.value !== '') {
    line += ` value=${quote(node.value)}`;
  }
  if (node.placeholder) {
    line += ` placeholder=${quote(node.placeholder)}`;
  }
  if (node.href) {
    line += ` href=${quote(node.href)}`;
  }
  line += renderStates(node.states);
  out.push(line);

  const childIndent = '  '.repeat(depth + 1);
  if (node.options && node.options.length > 0) {
    out.push(...renderOptions(node.options, childIndent));
  }
  for (const childId of node.children) {
    renderNode(childId, snapshot, depth + 1, options, out);
  }
}

export function serializeSnapshot(snapshot: PageSnapshot, options: SerializeOptions = {}): string {
  const header = [
    'PAGE',
    `title=${quote(snapshot.title)}`,
    `url=${quote(snapshot.url)}`,
    `snapshot=${quote(options.snapshotIdOverride ?? snapshot.snapshot_id)}`,
    `epoch=${snapshot.mutation_epoch}`,
  ].join(' ');

  const body: string[] = [];
  const rootNode = snapshot.nodes[snapshot.root_node_id];
  if (rootNode) {
    for (const childId of rootNode.children) {
      renderNode(childId, snapshot, 0, options, body);
    }
  }

  return [header, '', ...body].join('\n') + '\n';
}
