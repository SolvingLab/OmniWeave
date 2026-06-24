/**
 * Glyph fallback / Unicode-support detection.
 *
 * Pinned because the matrix is small and the consequence of regression
 * is highly visible: shimmer-worker output on Windows mojibakes when
 * UTF-8 glyphs are written via `fs.writeSync` (see #168). The detection
 * + ASCII fallback is the contract that prevents this.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  supportsUnicode,
  getGlyphs,
  UNICODE_GLYPHS,
  ASCII_GLYPHS,
  _resetGlyphsCache,
} from '../src/ui/glyphs';

function withEnv(patch: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  const savedPlatform = process.platform;
  for (const key of Object.keys(patch)) {
    saved[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  _resetGlyphsCache();
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    Object.defineProperty(process, 'platform', { value: savedPlatform });
    _resetGlyphsCache();
  }
}

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value });
}

describe('supportsUnicode', () => {
  let originalPlatform: NodeJS.Platform;

  beforeEach(() => {
    originalPlatform = process.platform;
    _resetGlyphsCache();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    _resetGlyphsCache();
  });

  it('returns false on Windows by default (mojibake-prone consoles)', () => {
    withEnv({ OMNIWEAVE_ASCII: undefined, OMNIWEAVE_UNICODE: undefined, TERM: undefined }, () => {
      setPlatform('win32');
      expect(supportsUnicode()).toBe(false);
    });
  });

  it('returns true on macOS by default', () => {
    withEnv({ OMNIWEAVE_ASCII: undefined, OMNIWEAVE_UNICODE: undefined, TERM: undefined }, () => {
      setPlatform('darwin');
      expect(supportsUnicode()).toBe(true);
    });
  });

  it('returns true on Linux by default', () => {
    withEnv({ OMNIWEAVE_ASCII: undefined, OMNIWEAVE_UNICODE: undefined, TERM: undefined }, () => {
      setPlatform('linux');
      expect(supportsUnicode()).toBe(true);
    });
  });

  it('returns false on Linux kernel console (TERM=linux)', () => {
    withEnv({ OMNIWEAVE_ASCII: undefined, OMNIWEAVE_UNICODE: undefined, TERM: 'linux' }, () => {
      setPlatform('linux');
      expect(supportsUnicode()).toBe(false);
    });
  });

  it('respects OMNIWEAVE_UNICODE=1 on Windows (opt-in escape hatch)', () => {
    withEnv({ OMNIWEAVE_UNICODE: '1', OMNIWEAVE_ASCII: undefined }, () => {
      setPlatform('win32');
      expect(supportsUnicode()).toBe(true);
    });
  });

  it('respects OMNIWEAVE_ASCII=1 on macOS (opt-out escape hatch)', () => {
    withEnv({ OMNIWEAVE_ASCII: '1', OMNIWEAVE_UNICODE: undefined }, () => {
      setPlatform('darwin');
      expect(supportsUnicode()).toBe(false);
    });
  });

  it('OMNIWEAVE_ASCII takes precedence over OMNIWEAVE_UNICODE', () => {
    withEnv({ OMNIWEAVE_ASCII: '1', OMNIWEAVE_UNICODE: '1' }, () => {
      setPlatform('darwin');
      expect(supportsUnicode()).toBe(false);
    });
  });
});

describe('getGlyphs', () => {
  let originalPlatform: NodeJS.Platform;

  beforeEach(() => {
    originalPlatform = process.platform;
    _resetGlyphsCache();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    _resetGlyphsCache();
  });

  it('returns ASCII glyphs on Windows', () => {
    withEnv({ OMNIWEAVE_ASCII: undefined, OMNIWEAVE_UNICODE: undefined }, () => {
      setPlatform('win32');
      const g = getGlyphs();
      expect(g).toBe(ASCII_GLYPHS);
      expect(g.ok).toBe('[OK]');
      expect(g.rail).toBe('|');
      expect(g.phaseDone).toBe('*');
      expect(g.dash).toBe('-');
    });
  });

  it('returns Unicode glyphs on macOS', () => {
    withEnv({ OMNIWEAVE_ASCII: undefined, OMNIWEAVE_UNICODE: undefined }, () => {
      setPlatform('darwin');
      const g = getGlyphs();
      expect(g).toBe(UNICODE_GLYPHS);
      expect(g.ok).toBe('✓');
      expect(g.rail).toBe('│');
      expect(g.phaseDone).toBe('◆');
      expect(g.dash).toBe('—');
    });
  });

  it('caches the result so repeated calls return the same object', () => {
    withEnv({ OMNIWEAVE_ASCII: undefined, OMNIWEAVE_UNICODE: undefined }, () => {
      setPlatform('darwin');
      expect(getGlyphs()).toBe(getGlyphs());
    });
  });
});

describe('Glyph sets', () => {
  it('ASCII and Unicode sets cover the same keys', () => {
    expect(Object.keys(ASCII_GLYPHS).sort()).toEqual(Object.keys(UNICODE_GLYPHS).sort());
  });

  it('ASCII glyphs are all 7-bit ASCII', () => {
    for (const [key, value] of Object.entries(ASCII_GLYPHS)) {
      const flat = Array.isArray(value) ? value.join('') : value;
      for (let i = 0; i < flat.length; i++) {
        const codepoint = flat.charCodeAt(i);
        expect(codepoint, `ASCII_GLYPHS.${key} contains non-ASCII char U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}`).toBeLessThan(128);
      }
    }
  });

  it('both spinners animate (each consumed mod its own length)', () => {
    // Frame counts need not match: the renderer indexes `spinner[frame % len]`
    // per set, so a 10-frame Braille spinner and a 4-frame `|/-\` spinner are
    // both fine. The contract is only that each actually cycles.
    expect(UNICODE_GLYPHS.spinner.length).toBeGreaterThan(1);
    expect(ASCII_GLYPHS.spinner.length).toBeGreaterThan(1);
  });

  it('only the Unicode set carries sub-cell bar partials; ASCII triggers the block fallback', () => {
    expect(UNICODE_GLYPHS.barPartials.length).toBe(7);
    expect(ASCII_GLYPHS.barPartials.length).toBe(0);
  });
});
