import { describe, it, expect } from 'vitest';
import { createServer } from 'http';
import type { AddressInfo } from 'net';

/**
 * 통합 시험의 `api()` 는 요청마다 새 연결로 보낸다 (T-140).
 *
 * 시험이 execSync 로 이벤트 루프를 몇 초 막는 사이 API 가 쉬던 keep-alive 연결을 닫으면, 연결을 다시 쓰는 fetch 는 그 닫힌
 * 소켓에 다음 요청을 실어 ECONNRESET 으로 실패했다(부하가 높을 때 lock-order·law-sync 가 흔들린 까닭). 경합이라 그대로
 * 재현하기는 어렵다 — 대신 "연결을 다시 쓰지 않는다"를 직접 센다.
 */
describe('통합 시험 api() — 요청마다 새 연결 (T-140)', () => {
  it('세 번 부르면 연결도 셋이고 모두 Connection: close — JSON·FormData 본문은 그대로 간다', async () => {
    let connections = 0;
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(`${req.method} ${req.url} | ${req.headers.connection} | ${req.headers['content-type'] ?? ''}`);
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ echo: body }));
      });
    });
    server.on('connection', () => (connections += 1));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.API_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const { api } = await import('./integration/helpers');
    try {
      expect((await api('/a', { token: 't' })).status).toBe(200);
      expect((await api('/b', { method: 'POST', json: { x: 1 } })).body).toEqual({ echo: '{"x":1}' });
      const form = new FormData();
      form.append('file', new Blob(['본문'], { type: 'text/plain' }), '규정.txt');
      const up = await api('/c', { method: 'POST', body: form });
      expect(up.body.echo).toContain('본문');
      expect(connections).toBe(3);
      expect(seen.map((l) => l.split(' | ')[1])).toEqual(['close', 'close', 'close']);
      expect(seen[1]).toContain('application/json');
      expect(seen[2]).toContain('multipart/form-data; boundary=');
    } finally {
      server.close();
    }
  });
});
