import { describe, expect, it } from 'vitest';
import { gameHash, parseHash } from './route';

describe('routing', () => {
  it('opens a room from the hash the app itself writes', () => {
    // The regression: the app navigated here and then failed to read it back.
    expect(parseHash('#' + gameHash('T9CJF'))).toEqual({ at: 'game', id: 'T9CJF' });
  });

  it('accepts a code typed or pasted in lowercase', () => {
    expect(parseHash('#/g/t9cjf')).toEqual({ at: 'game', id: 'T9CJF' });
    expect(parseHash('#/G/t9cjf')).toEqual({ at: 'game', id: 'T9CJF' });
  });

  it('tolerates a missing leading slash', () => {
    expect(parseHash('#g/ABCDE')).toEqual({ at: 'game', id: 'ABCDE' });
  });

  it('routes the hot seat and the home screen', () => {
    expect(parseHash('#/local')).toEqual({ at: 'local' });
    expect(parseHash('')).toEqual({ at: 'home' });
    expect(parseHash('#')).toEqual({ at: 'home' });
  });

  it('sends anything unrecognised home rather than to a broken room', () => {
    expect(parseHash('#/g/')).toEqual({ at: 'home' });
    expect(parseHash('#/g/AB-CD')).toEqual({ at: 'home' });
    expect(parseHash('#/elsewhere')).toEqual({ at: 'home' });
  });
});
