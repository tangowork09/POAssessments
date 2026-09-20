/**
 * When a personal link stops working.
 *
 * Links used to have no expiry at all — "valid for two weeks" was how the
 * exercise was described to participants, not something the software did — and
 * the only negative outcome was an administrator switching one off. These pin
 * the rule and, as much, the difference between the two refusals: one is a
 * thing the participant can fix by asking, the other is a decision about them.
 */
import { describe, expect, it } from 'vitest';
import { linkRefusal } from '../src/worker/routes/candidate.js';

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
const hence = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

describe('linkRefusal', () => {
  it('lets a live link with no expiry through', () => {
    expect(linkRefusal({ active: 1, expires_at: null })).toBeNull();
  });

  it('lets a link that is still in date through', () => {
    expect(linkRefusal({ active: 1, expires_at: hence(3) })).toBeNull();
  });

  it('turns away a link past its date, and says what to do about it', () => {
    const refusal = linkRefusal({ active: 1, expires_at: ago(1) });
    expect(refusal).toMatch(/expired/i);
    expect(refusal).toMatch(/send you a new one/i);
  });

  it('keeps deactivated apart from expired', () => {
    // One is a decision somebody made about this person; the other is a date.
    // Telling a participant the wrong one sends them to the wrong conversation.
    expect(linkRefusal({ active: 0, expires_at: null })).toMatch(/deactivated/i);
    expect(linkRefusal({ active: 0, expires_at: ago(1) })).toMatch(/deactivated/i);
  });

  it('treats an unparseable date as no expiry rather than locking somebody out', () => {
    expect(linkRefusal({ active: 1, expires_at: 'not a date' })).toBeNull();
  });

  it('is exact at the boundary: a link is dead from its moment, not the day after', () => {
    expect(linkRefusal({ active: 1, expires_at: hence(0.001) })).toBeNull();
    expect(linkRefusal({ active: 1, expires_at: ago(0.001) })).toMatch(/expired/i);
  });
});
