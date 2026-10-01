const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const DATA_FILE = path.join(__dirname, 'data', 'ideas.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// Serialized write queue to prevent race conditions on concurrent requests
let writeQueue = Promise.resolve();

async function ensureDataFile() {
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    const seed = { ideas: [] };
    await fs.writeFile(DATA_FILE, JSON.stringify(seed, null, 2), 'utf8');
  }
}

async function readIdeasData() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.ideas)) {
    return { ideas: [] };
  }
  return parsed;
}

function writeIdeasData(data) {
  writeQueue = writeQueue.then(async () => {
    const tempFile = `${DATA_FILE}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tempFile, DATA_FILE);
  });
  return writeQueue;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, pathname) {
  // GET /api/ideas
  if (req.method === 'GET' && pathname === '/api/ideas') {
    const data = await readIdeasData();
    return sendJson(res, 200, data);
  }

  // POST /api/ideas
  if (req.method === 'POST' && pathname === '/api/ideas') {
    const body = await parseBody(req);
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return sendJson(res, 400, { error: 'Idea title is required.' });
    }

    const data = await readIdeasData();
    const maxId = data.ideas.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
    const newIdea = {
      id: maxId + 1,
      title,
      category: typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'General',
      difficulty: ['Easy', 'Medium', 'Hard'].includes(body.difficulty) ? body.difficulty : 'Medium',
      status: body.status === 'completed' ? 'completed' : 'available',
      createdAt: new Date().toISOString()
    };

    data.ideas.unshift(newIdea);
    await writeIdeasData(data);
    return sendJson(res, 201, { idea: newIdea, ideas: data.ideas });
  }

  // POST /api/ideas/restore-all
  if (req.method === 'POST' && pathname === '/api/ideas/restore-all') {
    const data = await readIdeasData();
    data.ideas = data.ideas.map((idea) => ({
      ...idea,
      status: 'available',
      completedAt: undefined
    }));
    await writeIdeasData(data);
    return sendJson(res, 200, { ideas: data.ideas });
  }

  // Match /api/ideas/:id
  const match = pathname.match(/^\/api\/ideas\/(\d+)$/);
  if (match) {
    const id = Number(match[1]);
    const data = await readIdeasData();
    const index = data.ideas.findIndex((item) => Number(item.id) === id);

    if (index === -1) {
      return sendJson(res, 404, { error: 'Idea not found.' });
    }

    // PUT /api/ideas/:id
    if (req.method === 'PUT') {
      const body = await parseBody(req);
      const current = data.ideas[index];

      const updatedTitle =
        typeof body.title === 'string' ? body.title.trim() : current.title;
      if (!updatedTitle) {
        return sendJson(res, 400, { error: 'Idea title cannot be empty.' });
      }

      const updatedStatus =
        body.status === 'completed' || body.status === 'available'
          ? body.status
          : current.status;

      const updatedIdea = {
        ...current,
        title: updatedTitle,
        category:
          typeof body.category === 'string' && body.category.trim()
            ? body.category.trim()
            : current.category || 'General',
        difficulty: ['Easy', 'Medium', 'Hard'].includes(body.difficulty)
          ? body.difficulty
          : current.difficulty || 'Medium',
        status: updatedStatus,
        completedAt:
          updatedStatus === 'completed'
            ? current.completedAt || new Date().toISOString()
            : undefined
      };

      data.ideas[index] = updatedIdea;
      await writeIdeasData(data);
      return sendJson(res, 200, { idea: updatedIdea, ideas: data.ideas });
    }

    // DELETE /api/ideas/:id
    if (req.method === 'DELETE') {
      const [removed] = data.ideas.splice(index, 1);
      await writeIdeasData(data);
      return sendJson(res, 200, { deleted: removed, ideas: data.ideas });
    }
  }

  return sendJson(res, 404, { error: 'API endpoint not found.' });
}

async function serveStatic(req, res, pathname) {
  const safePath = path.normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      return serveStatic(req, res, '/index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url.pathname);
    } else {
      await serveStatic(req, res, url.pathname);
    }
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { error: err.message || 'Internal server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Vibe Coding Idea Roulette running at http://${HOST}:${PORT}`);
});