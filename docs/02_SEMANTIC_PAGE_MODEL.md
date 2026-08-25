# 02 - Semantic Page Model

Status: AUTHORITATIVE FOR MVP

## 1. Objective

Convert a rendered HTML document into a compact, structured semantic representation that preserves enough hierarchy and state for an LLM to understand what controls and content belong together without sending raw HTML or visual layout.

This is the most important browser-perception component in MVP.

## 2. Core principle

Do not create a flat list of every interactive element.

Bad:

```text
Nike Pegasus
$120
Buy @1
Adidas Ultraboost
$140
Buy @2
```

Required direction:

```text
GROUP @100
  H2 "Nike Pegasus"
  TEXT "$120"
  BUTTON @1 "Buy"

GROUP @200
  H2 "Adidas Ultraboost"
  TEXT "$140"
  BUTTON @2 "Buy"
```

The semantic parent/group relationship is part of the model.

## 3. Source-of-truth schema

Implement TypeScript types equivalent to:

```ts
type SemanticRole =
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

interface SemanticNode {
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
}

interface PageSnapshot {
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
```

`node_id` is semantic-tree identity. `element_id` exists only when a semantic node maps to an actionable or inspectable live DOM element. For MVP these IDs MAY be the same number for element-backed nodes, but code must not assume they are conceptually identical.

## 4. What to include

### 4.1 Always include actionable controls when visible/relevant

Include:

- links with meaningful accessible name or visible text;
- buttons;
- input/textarea controls;
- select/combobox controls;
- checkboxes/radios/switches;
- tabs;
- menu items;
- sliders/spin buttons;
- elements with `contenteditable` as semantic textbox, but mark `action_support="read_only"` in MVP if text editing is not implemented;
- elements with explicit interactive ARIA role when reasonably actionable.

### 4.2 Include structural semantics

Include when they contain included descendants or are important for comprehension:

- `main`;
- `nav`;
- `form`;
- `fieldset`;
- `dialog`;
- `section`/`article` when labeled or headed;
- ARIA `region`/`group`;
- lists and list items;
- tables, rows, headers, cells;
- tablists and tabpanels;
- meaningful headings.

### 4.3 Include text selectively

Do not emit every text node.

Include text when it is one of:

- a heading;
- direct descriptive text inside a semantic group containing an actionable control;
- table/list content needed to identify a row/item;
- current price, status, warning, date, quantity, or comparable short fact near an actionable object;
- content necessary to answer the user's likely page-level questions;
- paragraph text when the page is primarily article/document content and no compact mode has yet been implemented.

Long contiguous body copy MUST be truncated per-node in MVP using deterministic limits defined below.

### 4.4 Images

Images are not visually processed. Include an image node only if it has a non-empty semantic label such as `alt`, `aria-label`, or equivalent derived accessible name that materially contributes information.

Do not include image URLs by default.

## 5. Visibility filter

MVP semantic extraction is focused on currently rendered/available page content, not every hidden DOM node.

A node is considered hidden if any of these are true:

- `hidden` attribute;
- `aria-hidden="true"` on the element or ancestor;
- computed `display: none`;
- computed `visibility: hidden` or `collapse`;
- no rendered client rect for ordinary visual elements, except special semantic cases explicitly handled;
- inside a closed `<details>` subtree other than its summary;
- disabled due to an inactive semantic container only if the DOM clearly represents it as unavailable.

Do NOT use viewport intersection as the definition of visible. Off-screen scrollable elements may still be semantically present and useful.

The extractor SHOULD capture whether an actionable element is in the viewport as metadata if cheap, but layout coordinates are not part of model-facing MVP serialization.

## 6. Role derivation

Derive role in this precedence:

1. Valid explicit ARIA `role` token supported by our `SemanticRole` map.
2. Native HTML implicit role mapping defined by local code.
3. Project-specific structural inference only for containers (`group`), never for consequential action semantics.
4. `generic` if the element must be retained solely to preserve hierarchy.

Examples of native mappings:

```text
button -> button
a[href] -> link
textarea -> textbox
input[type=text|email|tel|url|password] -> textbox
input[type=search] -> searchbox
input[type=checkbox] -> checkbox
input[type=radio] -> radio
select -> combobox or listbox depending on multiple/size
h1..h6 -> heading with level
nav -> navigation
main -> main
form -> form
ul/ol -> list
li -> listitem
table -> table
tr -> row
th -> columnheader/rowheader when determinable
td -> cell
img -> image
```

Do not attempt to fully reproduce the browser's accessibility tree in V1. The implementation is a controlled semantic projection using HTML/ARIA evidence. Future CDP accessibility-tree support may improve fidelity.

## 7. Accessible name extraction

MVP implements a deterministic practical subset aligned with accessible-name concepts. Do not invent labels from unrelated surrounding prose unless the grouping algorithm explicitly supplies context separately.

Name precedence for element-backed controls:

1. Text referenced by valid `aria-labelledby` IDs in reference order.
2. Non-empty `aria-label`.
3. Associated `<label>` text for form controls, including explicit `for` and wrapping label.
4. Native naming attribute where appropriate:
   - `alt` for image/image input;
   - `value` for submit/reset/button-type inputs;
5. Element's concise rendered text content for button/link-like roles.
6. `placeholder` for text-entry controls as a fallback only.
7. `title` as final fallback.

Normalize whitespace to single spaces and trim.

The extractor MUST keep `description` separate from `name`. Use `aria-describedby` referenced text and `aria-description` when available, with deterministic truncation.

### 7.1 Duplicate names are allowed

Repeated `Buy` buttons are not an error. Their disambiguation comes from semantic hierarchy.

## 8. State extraction

`SemanticStates` should include only relevant states:

```ts
interface SemanticStates {
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
```

Native HTML state takes precedence when it directly represents the control. ARIA state is used when applicable.

## 9. Values and privacy

Never include values for:

- `input[type=password]`;
- recognized payment-card/CVV fields;
- fields classified as secret/authenticator input.

For ordinary form fields, snapshot MAY contain the current value because it can be necessary to reason about forms. Values are marked internally with sensitivity classification so telemetry can redact them.

The model-facing serializer MUST apply the privacy policy in document 06 before sending.

## 10. Structural tree construction

The semantic model MUST preserve relationships while pruning useless wrapper DOM.

### 10.1 Phase A - select semantic leaves

Walk the DOM and mark elements/text that qualify under sections 4-9.

### 10.2 Phase B - retain semantic containers

Retain a container if any of the following is true:

- it has a native semantic structural role listed in 4.2;
- it has an explicit supported ARIA structural role;
- it is a `fieldset` or labeled form section;
- it is necessary to preserve a table/list relationship;
- it qualifies under repeated-container inference below;
- it is the lowest useful common ancestor connecting multiple retained children and removing it would create ambiguous repeated controls.

### 10.3 Phase C - collapse useless wrappers

A generic wrapper can be removed when:

- it has no own meaningful name/text/state;
- it is not an actionable element;
- it has a single retained child; and
- removing it does not break a required list/table/form/row relationship.

Its child is re-parented to the wrapper's retained parent.

## 11. Repeated-container inference

Many product cards use plain `<div>` elements without semantic roles. MVP MUST include a conservative repeated-group heuristic because repeated `Buy`, `Edit`, etc. controls are otherwise ambiguous.

A DOM element can become an inferred `group` when all conditions are met:

1. It is not already represented by a stronger semantic role.
2. It has at least one retained actionable descendant.
3. Its parent has at least two sibling elements with a similar structural signature.
4. At least two siblings each have at least one retained actionable descendant.
5. The candidate contains identifying text/heading or a labeled image in addition to the action.

### 11.1 Structural signature

For MVP, a structural signature is derived from:

- normalized tag name;
- explicit role if any;
- first two CSS class tokens only for local inference, not model output;
- shallow sequence of interactive descendant role types up to depth 3.

Do not use dynamic class names as identity. Similarity is heuristic only.

### 11.2 Inferred group output

Emit:

```ts
{
  role: 'group',
  inferred_group: true,
  children: [...]
}
```

Do not label it `product`, `order`, `user`, etc. unless the page itself provides that semantic label. Let the LLM infer domain meaning from content.

## 12. Tables

Preserve table hierarchy:

```text
TABLE @10 "Users"
  ROW @11
    COLUMNHEADER "Name"
    COLUMNHEADER "Role"
    COLUMNHEADER "Actions"
  ROW @20
    CELL "Alice Jones"
    CELL "User"
    CELL
      BUTTON @23 "Edit"
      BUTTON @24 "Delete"
```

This solves repeated-action association without layout.

## 13. Lists

Preserve `list -> listitem` hierarchy. Do not flatten every list item into page root.

Long navigation menus may be compacted later, but MVP correctness is prioritized over maximum compression.

## 14. Forms

Preserve:

- form name if available;
- fieldset/legend grouping;
- label -> control naming;
- required/invalid/disabled state;
- selected option / checkbox/radio state;
- validation message text when visible.

Password field values are always omitted and action policy requires manual entry for MVP.

## 15. Select controls

For native `<select>`:

```ts
interface SemanticOptionSummary {
  value: string;
  label: string;
  selected: boolean;
  disabled?: boolean;
}
```

Model-facing serializer MAY include all options up to `MAX_OPTIONS_INLINE = 50`. If more than 50, include selected option, first 20, last 5, and total count, and expose a future details action only if needed. For MVP reference-site controls should stay under the limit.

## 16. Text limits

Deterministic constants:

```text
MAX_NODE_NAME_CHARS = 200
MAX_NODE_DESCRIPTION_CHARS = 400
MAX_TEXT_NODE_CHARS = 500
MAX_SNAPSHOT_SERIALIZED_CHARS = 60_000
MAX_OPTIONS_INLINE = 50
```

When truncating, append `...` and include an internal `truncated=true` marker if represented in the structured node.

If total serialization exceeds the snapshot maximum:

1. retain all actionable controls;
2. retain their ancestors;
3. retain identifying direct text/heading around each actionable control;
4. prune low-priority standalone paragraphs from the end of document order;
5. emit `snapshot_truncated=true` in stats.

Do not silently drop actionable controls to fit token budget.

## 17. Mutation tracking

Content script installs a `MutationObserver` after initialization.

Increment `mutation_epoch` after a debounce window of 50 ms when mutations may affect semantic output:

- child added/removed;
- relevant attribute changes (`role`, `aria-*`, `disabled`, `checked`, `selected`, `hidden`, `style`, `class`, `value` when appropriate);
- text changes.

Do not increment for mutations inside the extension's own isolated-world state because those should not touch page DOM.

Epoch is an observation hint, not a global invalidation lock.

## 18. Snapshot creation

`observePage()` MUST:

1. capture current `document_id` and epoch;
2. walk/build semantic model synchronously where practical;
3. ensure element IDs exist for element-backed nodes;
4. construct immutable `PageSnapshot` object;
5. create new random `snapshot_id`;
6. set capture timestamp;
7. return structured snapshot plus compact serialization.

If the document changes during a long extraction, discard and retry once. If it changes again, return `DOCUMENT_CHANGED` and let the orchestrator retry later.

## 19. Compact serialization format

Use a deterministic custom text format, not JSON, for the LLM view. JSON remains the wire/storage representation where needed.

Example:

```text
PAGE title="Checkout" url="https://shop.example/checkout" snapshot="abc" epoch=14

MAIN
  FORM @100 "Shipping"
    TEXTBOX @101 "Full name" value="Ashish"
    TEXTBOX @102 "Address" value="123 Main St"
    COMBOBOX @103 "State" value="Texas"
    BUTTON @104 "Continue"

  REGION @200 "Order summary"
    TEXT "Running shoes"
    TEXT "$89.00"
```

Rules:

- two-space indentation per level;
- role uppercase;
- actionable `element_id` printed as `@<id>`;
- quote strings using JSON-style escaping;
- omit empty fields;
- state flags appended compactly: `[disabled required expanded=false]`;
- no CSS classes, selectors, raw HTML, inline style, or coordinates in MVP output.

## 20. Semantic fingerprint for action revalidation

For every actionable node, record internally:

```ts
interface SemanticFingerprint {
  role: SemanticRole;
  normalized_name: string;
  tag_name: string;
  input_type?: string;
  href_origin?: string;
}
```

The action request copies the expected fingerprint from the observed snapshot. Executor uses it to detect a recycled/stale target.

## 21. Known MVP limitations

Document rather than hide these:

- CSS layout can create visual relationships that are not represented by DOM/ARIA structure.
- Canvas/WebGL UIs have little usable DOM semantics.
- Complex shadow DOM may require later dedicated traversal rules.
- Cross-origin iframe content cannot be treated like same-origin DOM without appropriate extension access.
- Custom controls may not expose correct semantics.
- Our accessible-name subset may differ from Chrome's exact accessibility-tree computation.

These are reasons for future accessibility-tree/layout/vision adapters, not reasons to weaken current deterministic behavior.

## 22. Required unit fixtures

Extractor unit fixtures MUST cover:

1. Two product-card divs with identical `Buy` buttons.
2. Table rows with repeated `Edit` buttons.
3. Fieldset/legend form grouping.
4. Explicit and wrapping labels.
5. `aria-labelledby` and `aria-describedby`.
6. Hidden/aria-hidden content.
7. Disabled controls.
8. Select with options and current selection.
9. Modal/dialog with background content.
10. List/listitem actions.
11. DOM wrappers that should collapse.
12. Repeated containers with similar structure.
13. Large text truncation.
14. Password value omission.

Each fixture has a golden expected semantic serialization.

## 23. References

- WAI-ARIA 1.2: https://www.w3.org/TR/wai-aria-1.2/
- Accessible Name and Description Computation: https://www.w3.org/TR/accname-1.2/
- Chrome content scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
