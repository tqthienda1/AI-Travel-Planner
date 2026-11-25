import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BUFFER = 32 * 1024 * 1024;
const WORKTREE_EXCLUDES = new Set(['.git', 'node_modules', '.next', 'out', 'build', 'dist', 'coverage']);
const SENSITIVE_NAME = /(?:api[_-]?key|secret|token|password|private[_-]?key|database[_-]?url)/i;
const PATTERNS = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ['openai-key', /\bsk-[A-Za-z0-9_-]{20,}/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['google-api-key', /\bAIza[A-Za-z0-9_-]{30,}/g],
  ['database-password', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:/@]+:([^\s/@]+)@/gi],
];

function git(repo, args, input) {
  const result = spawnSync('git', ['-C', repo, ...args], { input, maxBuffer: MAX_BUFFER, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('Git inspection failed; no clean result is available.');
  return result.stdout;
}

function inspect(buffer, paths, source, findings, stats) {
  let text;
  let utf8 = true;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { utf8 = false; text = buffer.toString('latin1'); }
  if (!utf8 || buffer.includes(0)) stats.binaryObjects += 1;
  const lines = text.split(/\r?\n/);
  const reported = new Set();
  function report(rule, line, path = paths[0]) {
    const key = `${rule}:${line}:${path}`;
    if (reported.has(key)) return;
    reported.add(key);
    findings.push({ rule, path, line, source });
  }
  for (const [rule, pattern] of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      report(rule, text.slice(0, match.index).split('\n').length);
    }
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const assignment = line.match(/^\s*(?:export\s+)?(?:const\s+|let\s+|var\s+)?["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*(?:=|:)\s*(.*)$/);
    if (!assignment) continue;
    const [, name, raw] = assignment;
    if (name.startsWith('NEXT_PUBLIC_') && SENSITIVE_NAME.test(name)) report('public-secret-variable', index + 1);
    const quoted = raw.match(/^["']([^"']*)["']\s*[,;]?\s*(?:(?:\/\/|#).*)?$/);
    const bare = raw.match(/^([^\s#'";,]+)\s*(?:#.*)?$/);
    const value = quoted?.[1] ?? bare?.[1] ?? '';
    if (SENSITIVE_NAME.test(name) && value.length >= 8 &&
        !/^(?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|process\.env\.[A-Za-z_][A-Za-z0-9_]*|undefined|null)$/i.test(value)) {
      report('secret-assignment', index + 1);
    }
    for (const path of paths) {
      if (basename(path) === '.env.example' && raw.trim() !== '') report('env-example-value', index + 1, path);
    }
  }
}

export function scanRepository(repoPath = process.cwd()) {
  const repo = resolve(repoPath);
  const root = git(repo, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
  if (resolve(root).toLowerCase() !== repo.toLowerCase()) throw new Error('Run from the repository root.');
  if (git(repo, ['rev-parse', '--is-shallow-repository']).toString('utf8').trim() === 'true') {
    throw new Error('Repository history is shallow; fetch full history before scanning.');
  }
  const findings = [];
  const stats = { historyBlobs: 0, indexBlobs: 0, workingFiles: 0, binaryObjects: 0 };
  const pathsByBlob = new Map();
  const commits = git(repo, ['rev-list', '--all']).toString('utf8').trim().split('\n').filter(Boolean);
  for (const commit of commits) {
    for (const entry of git(repo, ['ls-tree', '-rz', '--full-tree', commit]).toString('utf8').split('\0')) {
      if (!entry) continue;
      const tab = entry.indexOf('\t');
      const [mode, kind, oid] = entry.slice(0, tab).split(' ');
      const path = entry.slice(tab + 1);
      if (kind === 'commit') throw new Error('Submodules require a separate scan; no clean result is available.');
      if (kind !== 'blob') continue;
      if (!pathsByBlob.has(oid)) pathsByBlob.set(oid, new Set());
      pathsByBlob.get(oid).add(path);
    }
  }
  const objects = git(repo, ['rev-list', '--objects', '--all', '--no-object-names']).toString('utf8').trim();
  if (objects) {
    const metadata = git(repo, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], `${objects}\n`).toString('utf8');
    for (const line of metadata.trim().split('\n')) {
      const [oid, kind, size] = line.trim().split(' ');
      if (kind !== 'blob') continue;
      if (Number(size) > MAX_BUFFER) throw new Error(`Blob ${oid} exceeds the scan limit; no clean result is available.`);
      inspect(git(repo, ['cat-file', 'blob', oid]), [...(pathsByBlob.get(oid) ?? ['<unmapped blob>'])], oid, findings, stats);
      stats.historyBlobs += 1;
    }
  }
  for (const entry of git(repo, ['ls-files', '--stage', '-z']).toString('utf8').split('\0')) {
    if (!entry) continue;
    const tab = entry.indexOf('\t');
    const [mode, oid, stage] = entry.slice(0, tab).split(' ');
    if (stage !== '0') throw new Error('Unmerged index entries require resolution before scanning.');
    if (mode === '160000') throw new Error('Submodules require a separate scan; no clean result is available.');
    inspect(git(repo, ['cat-file', 'blob', oid]), [entry.slice(tab + 1)], `index:${oid}`, findings, stats);
    stats.indexBlobs += 1;
  }
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (WORKTREE_EXCLUDES.has(entry.name)) continue;
      if (entry.isSymbolicLink()) throw new Error('Working-tree symlinks require a separate scan; no clean result is available.');
      if (entry.isDirectory()) { walk(file); continue; }
      if (!entry.isFile()) throw new Error('Unsupported working-tree entry; no clean result is available.');
      if (lstatSync(file).size > MAX_BUFFER) throw new Error('A working file exceeds the scan limit; no clean result is available.');
      inspect(readFileSync(file), [relative(repo, file).replaceAll('\\', '/')], 'working-tree', findings, stats);
      stats.workingFiles += 1;
    }
  }
  walk(repo);
  return { findings, stats };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3) throw new Error('Usage: node scripts/scan-secrets.mjs [repository-root]');
    const result = scanRepository(process.argv[2]);
    for (const item of result.findings) console.error(JSON.stringify(item));
    console.log(`Inspected ${result.stats.historyBlobs} reachable history blobs, ${result.stats.indexBlobs} index blobs and ${result.stats.workingFiles} working files.`);
    console.log(`Binary/non-UTF8 objects: ${result.stats.binaryObjects}; raw bytes only, not embedded/compressed content.`);
    console.log(result.findings.length ? `${result.findings.length} secret-policy finding(s).` : 'No configured secret patterns found. This is not proof that all secrets are absent.');
    process.exitCode = result.findings.length ? 1 : 0;
  } catch (error) {
    console.error(`Secret scan incomplete: ${error.message}`);
    process.exitCode = 2;
  }
}
