import { describe, expect, it } from 'vitest';
import { DICTS, LANGS } from './i18n';

describe('translations', () => {
  const ref = DICTS.de;
  const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

  for (const { id } of LANGS) {
    it(`${id} has every key with the same placeholders`, () => {
      const d = DICTS[id];
      expect(Object.keys(d).sort()).toEqual(Object.keys(ref).sort());
      for (const k of Object.keys(ref)) expect(placeholders(d[k]), `${id}:${k}`).toBe(placeholders(ref[k]));
    });
  }
});
