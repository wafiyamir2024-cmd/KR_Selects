import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticServer } from '../server.mjs';

test('serves assets with MIME types and blocks private paths/traversal', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kr-character-select-'));
  await mkdir(join(root, 'images'));
  await writeFile(join(root, 'index.html'), '<h1>Character select</h1>');
  await writeFile(join(root, 'data.json'), '[{"No":0}]');
  await writeFile(join(root, 'images', 'face one.png'), Buffer.from([137, 80, 78, 71]));
  await writeFile(join(root, '.secret'), 'private');
  const server = createStaticServer({ root });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const port = server.address().port;
  const request = (path, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });

  assert.equal((await request('/')).body, '<h1>Character select</h1>');
  const json = await request('/data.json?fresh=1');
  assert.equal(json.status, 200);
  assert.match(json.headers['content-type'], /application\/json/);
  assert.equal((await request('/images/face%20one.png')).status, 200);
  const head = await request('/data.json', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal((await request('/.secret')).status, 403);
  assert.equal((await request('/%2e%2e/secret')).status, 403);
  assert.equal((await request('/..%2fsecret')).status, 403);
  assert.equal((await request('/images%5c..%5csecret')).status, 400);
  assert.equal((await request('/missing.png')).status, 404);
  assert.equal((await request('/%XX')).status, 400);
  assert.equal((await request('/data.json', 'POST')).status, 405);
});
