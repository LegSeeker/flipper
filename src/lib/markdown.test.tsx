import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from './markdown';

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe('Markdown', () => {
  it('renders tables with inline formatting', () => {
    const out = html(
      [
        'Your numbers:',
        '| Metric | Yours | Target |',
        '|---|:---:|---|',
        '| Sales (12m) | **1** | 3–5/week |',
        '| Margin | 0.6% |',
        '',
        'Done.',
      ].join('\n'),
    );
    expect(out).toContain('<table');
    expect(out).toContain('<th class="border-b border-border px-2 py-1.5 font-semibold text-fg">Metric</th>');
    expect(out).toContain('<strong>1</strong>');
    // Short rows are padded to the header width.
    expect(out.match(/<td/g)).toHaveLength(6);
    expect(out).toContain('<p>Your numbers:</p>');
    expect(out).toContain('<p>Done.</p>');
  });

  it('leaves pipes that are not a table alone', () => {
    expect(html('a | b')).toBe('<div class="space-y-2 break-words"><p>a | b</p></div>');
  });

  it('renders rules and quotes, and never raw HTML', () => {
    const out = html('---\n> note\n<script>alert(1)</script>');
    expect(out).toContain('<hr');
    expect(out).toContain('<blockquote');
    expect(out).not.toContain('<script>');
  });
});
