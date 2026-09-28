import { AiError, isAbort } from './types';

/** Yield the payload of each `data:` line of a server-sent-events response. */
export async function* sseData(body: NonNullable<Response['body']>): AsyncGenerator<string> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (t.startsWith('data:')) yield t.slice(5).trim();
      }
    }
    const rest = buffer.trim();
    if (rest.startsWith('data:')) yield rest.slice(5).trim();
  } catch (e) {
    if (isAbort(e)) throw new AiError('aborted', 'Cancelled');
    throw e;
  } finally {
    reader.releaseLock();
  }
}
