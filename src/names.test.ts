import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_ALIAS_LENGTH, alias, displayName, randomAlias } from './names';
import { STALE_MS, liveOnly, type OnlinePlayer } from './net/presence';

beforeEach(() => localStorage.clear());

describe('a handle for somebody who never said who they are', () => {
  it('is two words', () => {
    expect(randomAlias(() => 0)).toMatch(/^\S+ .+$/);
  });

  it('fits the 24-character limit rules put on a name', () => {
    // Every combination, not a sample: one long pairing would be refused by
    // the presence rule and the player would silently never appear.
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(randomAlias());
    for (const handle of seen) {
      expect(handle.length).toBeLessThanOrEqual(MAX_ALIAS_LENGTH);
      expect(handle.length).toBeGreaterThan(0);
    }
    // And it is actually drawing from a range, not returning one string.
    expect(seen.size).toBeGreaterThan(50);
  });

  it('is minted once and then kept, so it survives a reload', () => {
    const first = alias();
    expect(alias()).toBe(first);
    expect(localStorage.getItem('consultation-chess:alias')).toBe(first);
  });

  it('gives way to a name the player actually typed', () => {
    expect(displayName('Alice')).toBe('Alice');
    expect(displayName('  Alice  ')).toBe('Alice');
  });

  it('stands in when the name is blank, missing, or only spaces', () => {
    const handle = alias();
    expect(displayName('')).toBe(handle);
    expect(displayName('   ')).toBe(handle);
    expect(displayName(null)).toBe(handle);
    expect(displayName(undefined)).toBe(handle);
  });

  it('still produces something when storage is denied', () => {
    const denied = () => {
      throw new Error('private browsing');
    };
    const original = Object.getOwnPropertyDescriptor(Storage.prototype, 'getItem');
    Storage.prototype.getItem = denied as never;
    try {
      expect(alias().length).toBeGreaterThan(0);
    } finally {
      if (original) Object.defineProperty(Storage.prototype, 'getItem', original);
    }
  });
});

describe('who counts as online', () => {
  const at = (age: number): OnlinePlayer => ({ uid: 'u' + age, name: 'n', at: 1000 - age });

  it('keeps anyone whose heartbeat is recent', () => {
    expect(liveOnly([at(0), at(1000)], 1000).length).toBe(2);
  });

  it('drops a machine that went to sleep without disconnecting', () => {
    expect(liveOnly([at(STALE_MS + 1)], 1000)).toEqual([]);
  });

  it('is inclusive at the boundary rather than flickering on it', () => {
    expect(liveOnly([at(STALE_MS - 1)], 1000).length).toBe(1);
  });
});
