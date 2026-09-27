import { describe, expect, it } from 'vitest';
import { median, parseNumber, uid } from './utils';
import { toCSV } from './csv';
import { buildMarketplaceUrl, searchQuery } from './marketplaces';
import { round2, estimateFees } from './money';
import { daysBetween, monthRange, periodRange } from './dates';
import { formatCode } from './codes';
import { extractJson } from '@/ai/client';
import { guessPrice } from '@/integrations/feeds';
import { findInventoryMatch } from '@/components/ai/RepairPlanner';
import { parsePartLines } from '@/components/ai/PartOutDialog';
import { makeItem } from '@/test/factories';
import { safeLocale } from '@/db/defaults';

describe('parseNumber', () => {
  it.each([
    ['12', 12],
    ['12.5', 12.5],
    ['12,5', 12.5],
    ['1,234.56', 1234.56],
    ['1.234,56', 1234.56],
    ['1,500', 1500],
    ['€ 45', 45],
    ['-3', -3],
    ['', null],
    ['abc', null],
  ])('%s -> %s', (input, expected) => {
    expect(parseNumber(input)).toBe(expected);
  });
});

describe('money', () => {
  it('rounds to cents without float artefacts', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1.005)).toBe(1.01);
  });
  it('estimates platform fees', () => {
    expect(estimateFees(100, { feePercent: 12.8, fixedFee: 0.3 })).toBe(13.1);
    expect(estimateFees(0, { feePercent: 12.8, fixedFee: 0.3 })).toBe(0);
  });
});

describe('ids', () => {
  it('formats sequential codes', () => {
    expect(formatCode('FL', 42, 5)).toBe('FL-00042');
    expect(formatCode('', 7, 3)).toBe('007');
  });
  it('generates v4 UUIDs', () => {
    expect(uid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('dates', () => {
  it('counts calendar days', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
  });
  it('lists months in a range', () => {
    expect(monthRange('2025-11-15', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
  it('builds period ranges', () => {
    expect(periodRange('last_month', new Date(2026, 2, 15))).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });
});

describe('csv', () => {
  it('escapes quotes, commas and formula injection', () => {
    const out = toCSV(['a', 'b'], [['x, "y"', '=SUM(A1)']]);
    expect(out).toContain('"x, ""y"""');
    expect(out).toContain("'=SUM(A1)");
    expect(out.charCodeAt(0)).toBe(0xfeff);
  });
});

describe('marketplaces', () => {
  it('fills query and city placeholders', () => {
    expect(buildMarketplaceUrl('https://x.com/{city}/search?q={query}', 'sony a7 iii', 'New York')).toBe(
      'https://x.com/newyork/search?q=sony%20a7%20iii',
    );
  });
  it('drops an empty city segment', () => {
    expect(
      buildMarketplaceUrl('https://www.facebook.com/marketplace/{city}/search?query={query}', 'lamp', ''),
    ).toBe('https://www.facebook.com/marketplace/search?query=lamp');
    expect(buildMarketplaceUrl('https://{city}.craigslist.org/search/sss?query={query}', 'lamp', '')).toBe(
      'https://craigslist.org/search/sss?query=lamp',
    );
  });
  it('builds search terms from brand and model', () => {
    expect(searchQuery({ name: 'Headphones', brand: 'Sony', model: 'WH-1000XM4' })).toBe(
      'Sony WH-1000XM4 Headphones',
    );
    expect(searchQuery({ name: 'Sony WH-1000XM4', brand: 'Sony', model: 'WH-1000XM4' })).toBe(
      'Sony WH-1000XM4',
    );
  });
});

describe('AI helpers', () => {
  it('extracts JSON from fenced or chatty replies', () => {
    expect(extractJson('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"b": [1,2]} hope it helps')).toEqual({ b: [1, 2] });
    expect(() => extractJson('no json here')).toThrow();
  });
  it('guesses prices from listing text', () => {
    expect(guessPrice('iPhone 12 64GB - £180')).toBe(180);
    expect(guessPrice('Kamera 1.250,00 €')).toBe(1250);
    expect(guessPrice('No price')).toBeNull();
  });
  it('matches parts to stock by words', () => {
    const stock = [makeItem({ name: 'Samsung 870 EVO SSD 500GB' }), makeItem({ name: 'Laptop charger 65W' })];
    expect(findInventoryMatch('SSD 500GB', stock)?.name).toBe('Samsung 870 EVO SSD 500GB');
    expect(findInventoryMatch('Keyboard', stock)).toBeUndefined();
  });
  it('parses pasted part lists', () => {
    expect(parsePartLines('Headlight left, 45\nAlloy wheel, 60, 4\n\nECU')).toEqual([
      { name: 'Headlight left', category: '', quantity: 1, price: 45, notes: '', include: true },
      { name: 'Alloy wheel', category: '', quantity: 4, price: 60, notes: '', include: true },
      { name: 'ECU', category: '', quantity: 1, price: null, notes: '', include: true },
    ]);
  });
  it('computes medians', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('safeLocale', () => {
  it('normalises odd browser locale tags', () => {
    expect(safeLocale('en-US@posix')).toBe('en-US');
    expect(safeLocale('en_GB.UTF-8')).toBe('en-GB');
    expect(safeLocale('lv-LV')).toBe('lv-LV');
    expect(safeLocale('!!')).toBe('en-US');
    expect(safeLocale(undefined)).toBe('en-US');
  });
});
