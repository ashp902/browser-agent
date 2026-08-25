// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { computeMetrics, qualifiesAsInferredGroup } from '../../src/content/semantic/grouping';
import { createVisibilityContext } from '../../src/content/semantic/visibility';
import { parseDocument } from '../helpers/semantic';

function setup(html: string) {
  const doc = parseDocument(html);
  const visibility = createVisibilityContext(doc);
  // computeMetrics walks from a root; use body to cover everything.
  const metrics = computeMetrics(doc.body as unknown as Element, visibility);
  return { doc, metrics };
}

const CARD_A =
  '<div class="product-card"><h2>Nike Pegasus</h2><p>$120</p><button>Buy</button></div>';
const CARD_B =
  '<div class="product-card"><h2>Adidas Ultraboost</h2><p>$140</p><button>Buy</button></div>';

describe('repeated-container inference', () => {
  it('qualifies two structurally similar cards', () => {
    const { doc, metrics } = setup(`<main>${CARD_A}${CARD_B}</main>`);
    const [cardA, cardB] = Array.from(doc.querySelectorAll('.product-card'));
    expect(qualifiesAsInferredGroup(cardA, metrics)).toBe(true);
    expect(qualifiesAsInferredGroup(cardB, metrics)).toBe(true);
  });

  it('does not qualify a lone card without similar siblings', () => {
    const { doc, metrics } = setup(`<main>${CARD_A}</main>`);
    const card = doc.querySelector('.product-card') as Element;
    expect(qualifiesAsInferredGroup(card, metrics)).toBe(false);
  });

  it('does not qualify containers without identifying content', () => {
    const html = `<main>
      <div class="row"><button>Buy</button></div>
      <div class="row"><button>Buy</button></div>
    </main>`;
    const { doc, metrics } = setup(html);
    for (const div of Array.from(doc.querySelectorAll('.row'))) {
      expect(qualifiesAsInferredGroup(div, metrics)).toBe(false);
    }
  });

  it('does not qualify when only one sibling has actionable content', () => {
    const html = `<main>
      <div class="card"><h2>A</h2><p>$1</p><button>Buy</button></div>
      <div class="card"><h2>B</h2><p>$2</p></div>
    </main>`;
    const { doc, metrics } = setup(html);
    const cards = Array.from(doc.querySelectorAll('.card'));
    expect(qualifiesAsInferredGroup(cards[0], metrics)).toBe(false);
  });

  it('ignores hidden actionables in similarity decisions', () => {
    const html = `<main>${CARD_A}<div class="product-card" style="display:none"><h2>X</h2><p>$0</p><button>Buy</button></div></main>`;
    const { doc, metrics } = setup(html);
    const cardA = doc.querySelector('.product-card') as Element;
    // The only visible sibling set contains one member.
    expect(qualifiesAsInferredGroup(cardA, metrics)).toBe(false);
  });

  it('does not match dissimilar structures', () => {
    const html = `<main>${CARD_A}<div class="other-card"><h2>Other</h2><a href="/x">View</a></div></main>`;
    const { doc, metrics } = setup(html);
    const cards = Array.from(doc.querySelectorAll('.product-card, .other-card'));
    expect(qualifiesAsInferredGroup(cards[0], metrics)).toBe(false);
    expect(qualifiesAsInferredGroup(cards[1], metrics)).toBe(false);
  });

  it('matches class-less siblings only when they share an interactive role type', () => {
    const shared =
      '<div><h2>A shoe</h2><p>$120</p><button>Buy</button></div>' +
      '<div><h2>B shoe</h2><p>$140</p><label>Size <select><option>9</option></select></label><button>Buy</button></div>';
    const { doc: sharedDoc, metrics: sharedMetrics } = setup(`<main>${shared}</main>`);
    const [firstShared] = Array.from(sharedDoc.querySelectorAll('main > div'));
    expect(qualifiesAsInferredGroup(firstShared, sharedMetrics)).toBe(true);

    const unshared =
      '<div><h2>A item</h2><p>$120</p><button>Buy</button></div>' +
      '<div><h2>B item</h2><p>$140</p><input type="text" aria-label="Quantity"></div>';
    const { doc: unsharedDoc, metrics: unsharedMetrics } = setup(`<main>${unshared}</main>`);
    const [firstUnshared] = Array.from(unsharedDoc.querySelectorAll('main > div'));
    expect(qualifiesAsInferredGroup(firstUnshared, unsharedMetrics)).toBe(false);
  });
});
