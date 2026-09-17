import { expect, test } from 'bun:test';
import { createMisoApiClient, MisoApiContractError } from './client.js';

for (const [kind, method, data] of [
  ['compositions', 'getComposition', { id: '0x1', title: 'A song', state: { type: 'Published', timestampMs: 1 } }],
  ['recordings', 'getRecording', { id: '0x1', compositionId: '0x2', state: { type: 'Published', timestampMs: 1 } }],
] as const) {
  test(`${method} reads by work ID and returns only basic metadata`, async () => {
    const client = createMisoApiClient({ baseUrl: 'https://api.test', fetch: (async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(`https://api.test/v1/${kind}/0x1`);
      return Response.json({ ...data, lyrics: 'not part of this contract', credits: [] });
    }) as unknown as typeof fetch });
    expect(await client[method]('0x1')).toEqual(data);
  });
  test(`${method} distinguishes absence from invalid upstream data`, async () => {
    let status = 404;
    const client = createMisoApiClient({ baseUrl: 'https://api.test', fetch: (async () => Response.json({}, { status })) as unknown as typeof fetch });
    expect(await client[method]('0x1')).toBeNull();
    status = 200;
    expect(client[method]('0x1')).rejects.toBeInstanceOf(MisoApiContractError);
  });
}
