import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8787);
const OWNER = 'zaintarq';
const ROOT = path.dirname(new URL(import.meta.url).pathname);

function gh(args, cwd) {
  return execFileSync('gh', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function slug(text) {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return base || 'project';
}

function writeProject(dir, idea) {
  fs.mkdirSync(dir, { recursive: true });
  const name = slug(idea);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    description: idea,
    scripts: { start: 'node src/main.js' },
  }, null, 2) + '\n');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/main.js'), `const idea = ${JSON.stringify(idea)};

export function summary() {
  return {
    idea,
    status: 'started',
    next: 'Ask for a specific improvement and it will be committed on top of this.',
  };
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  console.log(JSON.stringify(summary(), null, 2));
}
`);
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n\n${idea}\n\nRun \`npm start\` to print the current summary.\n`);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
}

function improve(dir, note) {
  const file = path.join(dir, 'IMPROVEMENTS.md');
  const block = `\n## ${new Date().toISOString()}\n\n${note}\n`;
  fs.appendFileSync(file, fs.existsSync(file) ? block : `# Improvements\n${block}`);
  const main = path.join(dir, 'src/main.js');
  if (fs.existsSync(main)) {
    const src = fs.readFileSync(main, 'utf8');
    if (!src.includes('latestImprovement')) {
      fs.appendFileSync(main, `\nexport const latestImprovement = ${JSON.stringify(note)};\n`);
    } else {
      fs.writeFileSync(main, src.replace(/export const latestImprovement = .*;/, `export const latestImprovement = ${JSON.stringify(note)};`));
    }
  }
}

function activity() {
  const raw = gh(['repo', 'list', OWNER, '--limit', '12', '--json', 'name,url,description,updatedAt,isPrivate']);
  const repos = JSON.parse(raw);
  return repos.map((repo) => {
    let commits = [];
    try {
      const log = gh(['api', `repos/${OWNER}/${repo.name}/commits?per_page=3`, '--jq', '.[] | {sha: .sha[0:7], message: .commit.message, date: .commit.author.date}']);
      commits = log.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } catch {
      commits = [];
    }
    return { ...repo, commits };
  });
}

function createFromIdea(idea) {
  const name = slug(idea);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idea-'));
  writeProject(dir, idea);
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['checkout', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', `Start ${name}\n\n${idea}`], { cwd: dir });
  try {
    gh(['repo', 'create', `${OWNER}/${name}`, '--public', '--source', dir, '--remote', 'origin', '--push']);
  } catch (error) {
    const message = String(error.stderr || error.message || error);
    if (!/already exists/i.test(message)) throw error;
    throw new Error(`A repository named ${name} already exists. Phrase the idea differently.`);
  }
  return { name, url: `https://github.com/${OWNER}/${name}`, idea };
}

function improveRepo(name, note) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'improve-'));
  gh(['repo', 'clone', `${OWNER}/${name}`, dir]);
  improve(dir, note);
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', note.split('\n')[0].slice(0, 72)], { cwd: dir });
  execFileSync('git', ['push'], { cwd: dir });
  return { name, url: `https://github.com/${OWNER}/${name}`, note };
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    return send(res, 200, fs.readFileSync(path.join(ROOT, 'index.html')), 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && req.url === '/api/activity') {
    try {
      return send(res, 200, { repos: activity() });
    } catch (error) {
      return send(res, 500, { error: String(error.stderr || error.message) });
    }
  }
  if (req.method !== 'POST') return send(res, 404, { error: 'Not found' });
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    try {
      const body = JSON.parse(raw || '{}');
      if (req.url === '/api/idea') {
        if (!body.idea || String(body.idea).trim().length < 8) {
          return send(res, 400, { error: 'Describe the project in at least a sentence.' });
        }
        return send(res, 200, createFromIdea(String(body.idea).trim()));
      }
      if (req.url === '/api/improve') {
        if (!body.repo || !body.note) return send(res, 400, { error: 'Choose a repository and write the improvement.' });
        return send(res, 200, improveRepo(String(body.repo), String(body.note).trim()));
      }
      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      return send(res, 500, { error: String(error.stderr || error.message || error) });
    }
  });
}).listen(PORT, () => {
  console.log(`http://127.0.0.1:${PORT}`);
});
