import { describe, expect, it } from 'vitest';

import { formatCardWord, normalizeLanguage, translate } from '../translations';

describe('translations', () => {
  it('falls back to English when the language is unsupported', () => {
    expect(normalizeLanguage('xx')).toBe('en');
    expect(translate('xx', 'join_room')).toBe('Join Room');
  });

  it('formats translated board words for Turkish', () => {
    expect(formatCardWord('tr', 'apple')).toBe('ELMA');
  });
});
