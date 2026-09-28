import { expect, test, type Page, type Route } from '@playwright/test';

/** Anthropic-style event stream: one web search, then the answer (as DeepSeek's search endpoint sends). */
function searchStream(answer: string): string {
  const events: object[] = [
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'deepseek-flash',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 1 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'server_tool_use', id: 's1', name: 'web_search', input: {} },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'content_block_start',
      index: 1,
      content_block: {
        type: 'web_search_tool_result',
        tool_use_id: 's1',
        content: [
          {
            type: 'web_search_result',
            url: 'https://www.ebay.co.uk/sch/audio-sold',
            title: 'Sold audio listings',
            encrypted_content: 'x',
            page_age: null,
          },
        ],
      },
    },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
    ...answer.split(' ').map((w, i) => ({
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'text_delta', text: (i ? ' ' : '') + w },
    })),
    { type: 'content_block_stop', index: 2 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 9 },
    },
    { type: 'message_stop' },
  ];
  return events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

/** Fake DeepSeek: answers based on what the prompt asks for. */
async function mockDeepSeek(page: Page) {
  // Web search goes through DeepSeek's Anthropic-compatible endpoint.
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route: Route) => {
    await new Promise((r) => setTimeout(r, 700)); // long enough to see the typing indicator
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: searchStream('Top categories for you: **audio** (live).'),
    });
  });
  await page.route('https://api.deepseek.com/chat/completions', async (route: Route) => {
    const body = route.request().postDataJSON() as { messages: { content: string }[]; stream?: boolean };
    const prompt = body.messages.map((m) => m.content).join('\n');
    if (body.stream) {
      const sse =
        ['Top ', 'categories ', 'for ', 'you: **audio**.']
          .map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`)
          .join('') + 'data: [DONE]\n\n';
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse });
    }
    let content = '{}';
    if (prompt.includes('breaking this item for parts')) {
      content = JSON.stringify({
        parts: [
          {
            name: 'Engine ECU',
            category: 'Vehicle parts',
            quantity: 1,
            estimatedPrice: 150,
            demand: 'high',
            difficulty: 'low',
            notes: '',
          },
          {
            name: 'Alloy wheels',
            category: 'Vehicle parts',
            quantity: 4,
            estimatedPrice: '80',
            demand: 'medium',
            difficulty: 'low',
            notes: 'Check for curb rash',
          },
        ],
        notes: 'Sell the ECU first.',
      });
    } else if (prompt.includes('sales listing')) {
      content = JSON.stringify({
        title: 'Canon EF 50mm f/1.8 STM Lens – Excellent, Tested',
        description: 'Sharp prime lens in excellent condition.',
        bullets: ['Tested on a 5D', 'Caps included'],
        keywords: ['canon 50mm', 'nifty fifty'],
        itemSpecifics: [{ name: 'Mount', value: 'Canon EF' }],
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content } }] }),
    });
  });
}

async function setup(page: Page) {
  await mockDeepSeek(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.goto('/#/settings#ai');
  const key = page.getByLabel('API key');
  await key.fill('sk-test');
  await key.blur();
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText(/Connected/)).toBeVisible();
}

test('AI part-out creates items with IDs in the project', async ({ page }) => {
  await setup(page);
  await page.goto('/#/projects/new');
  await page.getByRole('button', { name: /Part-out/ }).click();
  await page.getByLabel('Name *').fill('Golf Mk6 breaking');
  await page.getByLabel('Purchase price').first().fill('600');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Golf Mk6 breaking' })).toBeVisible();

  await page.getByRole('button', { name: 'Add parts' }).click();
  await page.getByRole('button', { name: 'Suggest parts' }).click();
  await expect(page.getByText('Sell the ECU first.')).toBeVisible();
  await page.getByRole('button', { name: 'Create 2 items' }).click();
  await expect(page.getByText('Created 2 items')).toBeVisible();
  await expect(page.getByRole('link', { name: /Engine ECU/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Alloy wheels/ })).toBeVisible();
});

test('AI writes a listing and the assistant streams replies', async ({ page }) => {
  await setup(page);
  await page.goto('/#/items/new');
  await page.getByLabel('Name *').fill('Canon EF 50mm lens');
  await page.getByRole('button', { name: 'Create item' }).click();
  await page.getByRole('tab', { name: 'Listing' }).click();
  await page.getByRole('button', { name: 'Generate listing' }).click();
  await expect(page.getByLabel(/Listing title/)).toHaveValue(
    'Canon EF 50mm f/1.8 STM Lens – Excellent, Tested',
  );
  await expect(page.getByLabel('Description')).toHaveValue(/Mount: Canon EF/);

  await page.goto('/#/assistant');
  await page.getByPlaceholder(/Message the assistant/).fill('What should I source?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  // While waiting, three animated dots show instead of a static "…".
  const dots = page.getByRole('status', { name: /Thinking/ });
  await expect(dots).toBeVisible();
  await expect(dots.locator('.typing-dot').first()).toHaveCSS('animation-name', 'typing-bounce');

  await expect(page.getByText('Top categories for you:')).toBeVisible();
  await expect(page.locator('strong', { hasText: 'audio' })).toBeVisible();
  // Web-backed answers say so and link their sources.
  await expect(page.getByText('Live web data · 1 source')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sold audio listings' })).toHaveAttribute(
    'href',
    'https://www.ebay.co.uk/sch/audio-sold',
  );

  // With web search off, the same question is answered from the model's knowledge and labelled.
  await page.getByRole('button', { name: 'Web' }).click();
  await page.getByPlaceholder(/Message the assistant/).fill('And now?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('No web access — prices are estimates')).toBeVisible();
});

test('switching AI provider keeps each key', async ({ page }) => {
  await setup(page);
  const provider = page.getByLabel('Provider', { exact: true });
  await provider.selectOption('anthropic');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('claude-opus-5');
  await expect(page.getByLabel('API key')).toHaveValue('');
  await provider.selectOption('deepseek');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('deepseek-flash');
  await expect(page.getByLabel('API key')).toHaveValue('sk-test');
});
