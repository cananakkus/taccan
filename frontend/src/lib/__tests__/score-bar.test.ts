import { describe, expect, it } from 'vitest';
import { getScoreBarShares } from '../game-helpers';

describe('competition bar', () => {
  it('starts near the centre according to the words remaining', () => {
    expect(getScoreBarShares({ red: 8, blue: 8 })).toEqual({ red: 50, blue: 50 });
    const start = getScoreBarShares({ red: 9, blue: 8 });
    expect(start.red).toBeCloseTo(47.06, 2);
    expect(start.blue).toBeCloseTo(52.94, 2);
  });
  it('gives more space to whichever team clears a word', () => {
    const start = getScoreBarShares({ red: 9, blue: 8 });
    expect(getScoreBarShares({ red: 8, blue: 8 }).red).toBeGreaterThan(start.red);
    expect(getScoreBarShares({ red: 9, blue: 7 }).blue).toBeGreaterThan(start.blue);
    expect(start.red + start.blue).toBeCloseTo(100);
  });
  it('fills the bar when a team clears its final word', () => {
    expect(getScoreBarShares({ red: 0, blue: 4 })).toEqual({ red: 100, blue: 0 });
    expect(getScoreBarShares({ red: 3, blue: 0 })).toEqual({ red: 0, blue: 100 });
    expect(getScoreBarShares(null)).toEqual({ red: 50, blue: 50 });
    expect(getScoreBarShares({ red: 0, blue: 0 })).toEqual({ red: 50, blue: 50 });
  });
});
