import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

function staysInside(root, path) {
  const within = relative(root, path);
  return within === '' || (!isAbsolute(within) && within !== '..' && !within.startsWith(`..${sep}`));
}

/** A small static server; exported so it can be tested on an ephemeral port. */
export function createStaticServer({ root = projectRoot } = {}) {
  const absoluteRoot = resolve(root);
  const canonicalRoot = realpath(absoluteRoot);

  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Cache-Control', 'no-cache');

    const reply = (code, message) => {
      response.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : message);
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      reply(405, 'Method not allowed');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent((request.url || '/').split('?')[0]);
    } catch {
      reply(400, 'Invalid URL encoding');
      return;
    }
    if (!pathname.startsWith('/') || /[\\\0:]/.test(pathname)) {
      reply(400, 'Invalid path');
      return;
    }

    const segments = pathname.split('/').filter(Boolean);
    if (segments.some((segment) => segment.startsWith('.'))) {
      reply(403, 'Forbidden');
      return;
    }

    let filename = resolve(absoluteRoot, ...segments);
    if (!staysInside(absoluteRoot, filename)) {
      reply(403, 'Forbidden');
      return;
    }

    try {
      let information = await stat(filename);
      if (information.isDirectory()) {
        filename = join(filename, 'index.html');
        information = await stat(filename);
      }

      const canonicalFile = await realpath(filename);
      if (!staysInside(await canonicalRoot, canonicalFile)) {
        reply(403, 'Forbidden');
        return;
      }
      if (!information.isFile()) {
        reply(404, 'Not found');
        return;
      }

      response.writeHead(200, {
        'Content-Type': mimeTypes[extname(filename).toLowerCase()] || 'application/octet-stream',
        'Content-Length': information.size,
        'Last-Modified': information.mtime.toUTCString(),
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      const stream = createReadStream(canonicalFile);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const missing = error.code === 'ENOENT' || error.code === 'ENOTDIR';
      reply(missing ? 404 : 500, missing ? 'Not found' : 'Unable to read file');
    }
  });
}

const isEntryPoint = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  const port = Number(process.env.PORT || 2022);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be an integer between 1 and 65535.');
    process.exitCode = 1;
  } else {
    const server = createStaticServer();
    server.on('error', (error) => {
      console.error(`Unable to start character select: ${error.message}`);
      process.exitCode = 1;
    });
    server.listen(port, host, () => {
      console.log(`Character select is running at http://${host}:${port}`);
    });
    const stop = () => server.close(() => { process.exitCode = 0; });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
}
