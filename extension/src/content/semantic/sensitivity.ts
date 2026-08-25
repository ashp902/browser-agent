// Sensitive-field classification (docs/06 §6).
//
// Runs locally in the content script before serialization or any action.
// Secret/manual-only fields never have their values included in snapshots and
// are refused by the action executor; PII fields are marked so telemetry can
// redact them.

import type { Sensitivity } from './types';

// autocomplete tokens that make a field manual-only (docs/06 §6.1).
const SECRET_AUTOCOMPLETE_TOKENS = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-name',
  'cc-type',
]);

// Conservative card/secret patterns for name/id/placeholder hints.
const SECRET_HINT_PATTERN =
  /(card[-_ ]?number|cc[-_ ]?num(ber)?|cvv|cvc2?|csc|security[-_ ]?code|card[-_ ]?code|passcode)/i;

// autocomplete tokens marking likely PII (docs/06 §6.2).
const PII_AUTOCOMPLETE_PREFIXES = [
  'name',
  'given-name',
  'family-name',
  'email',
  'tel',
  'street-address',
  'address-line',
  'postal-code',
  'organization',
];

const PII_HINT_PATTERN = /(e[-_ ]?mail|phone|mobile|postal|zip[-_ ]?code|address)/i;

function hintText(element: Element): string {
  return [
    element.getAttribute('name'),
    element.getAttribute('id'),
    element.getAttribute('placeholder'),
    element.getAttribute('aria-label'),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Returns 'secret' for manual-only fields, 'pii' for telemetry-redacted fields,
 * or null when the field carries no special classification.
 */
export function classifyFieldSensitivity(element: Element): Sensitivity | null {
  if (element.tagName !== 'INPUT' && element.tagName !== 'TEXTAREA') {
    return null;
  }

  const input = element as HTMLInputElement;
  const type = (input.getAttribute('type') ?? 'text').toLowerCase();
  const autocomplete = (input.getAttribute('autocomplete') ?? '').trim().toLowerCase();
  const autocompleteTokens = autocomplete.split(/\s+/).filter(Boolean);
  const hints = hintText(element);

  if (type === 'password' || type === 'file') {
    return 'secret';
  }
  if (autocompleteTokens.some((token) => SECRET_AUTOCOMPLETE_TOKENS.has(token))) {
    return 'secret';
  }
  if (SECRET_HINT_PATTERN.test(hints)) {
    return 'secret';
  }

  if (type === 'email' || type === 'tel') {
    return 'pii';
  }
  if (
    autocompleteTokens.some((token) =>
      PII_AUTOCOMPLETE_PREFIXES.some((prefix) => token === prefix || token.startsWith(`${prefix}-`)),
    )
  ) {
    return 'pii';
  }
  if (PII_HINT_PATTERN.test(hints)) {
    return 'pii';
  }

  return null;
}
