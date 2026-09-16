import { describe, expect, it } from 'vitest';
import { NO_ANNOTATIONS, arrowGeometry, brushFor, toggleArrow, toggleMark } from './Annotations';

const keys = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };

describe('annotations', () => {
  it('draws a knight move as an L, long leg first', () => {
    // g1 -> f3 with white at the bottom: (6.5, 7.5) -> (5.5, 5.5)
    const { shaft } = arrowGeometry([6.5, 7.5], [5.5, 5.5]);
    expect(shaft).toHaveLength(3);
    expect(shaft[1]).toEqual([6.5, 5.5]);
  });

  it('draws every other move as a straight shaft', () => {
    expect(arrowGeometry([4.5, 6.5], [4.5, 4.5]).shaft).toHaveLength(2);
    expect(arrowGeometry([0.5, 7.5], [7.5, 0.5]).shaft).toHaveLength(2);
  });

  it('removes an arrow drawn twice, and recolours one drawn in a new colour', () => {
    const once = toggleArrow(NO_ANNOTATIONS, { from: 'e2', to: 'e4', brush: 'primary' });
    expect(toggleArrow(once, { from: 'e2', to: 'e4', brush: 'primary' }).arrows).toEqual([]);
    expect(toggleArrow(once, { from: 'e2', to: 'e4', brush: 'green' }).arrows).toEqual([
      { from: 'e2', to: 'e4', brush: 'green' },
    ]);
  });

  it('toggles a square highlight the same way', () => {
    const once = toggleMark(NO_ANNOTATIONS, { square: 'd5', brush: 'primary' });
    expect(once.marks).toHaveLength(1);
    expect(toggleMark(once, { square: 'd5', brush: 'primary' }).marks).toEqual([]);
  });

  it('picks the colour from the held modifier', () => {
    expect(brushFor(keys)).toBe('primary');
    expect(brushFor({ ...keys, shiftKey: true })).toBe('green');
    expect(brushFor({ ...keys, ctrlKey: true })).toBe('blue');
    expect(brushFor({ ...keys, altKey: true })).toBe('yellow');
  });
});
