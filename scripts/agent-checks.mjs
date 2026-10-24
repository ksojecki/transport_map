#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const mode = process.argv[2];
const cliFiles = process.argv.slice(3);

const lintExtensions = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx']);
const formatExtensions = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.ts',
  '.tsx',
  '.json',
  '.jsonc',
  '.yml',
  '.yaml',
  '.css',
  '.html',
  '.md',
]);
const ignoredPrefixes = ['dist/', 'node_modules/', 'coverage/', 'build/', '.git/'];
const fileLikeKeyPattern = /(file|path)/i;
const changedFileEnvVars = [
  'CHANGED_FILES',
  'FILES',
  'FILE_PATH',
  'CODEX_CHANGED_FILES',
  'OPENCODE_CHANGED_FILES',
  'COPILOT_CHANGED_FILES',
];

function runOrExit(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function splitCandidateString(value) {
  return value
    .split(/[\n,\s]+/)
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function collectStringsFromObject(value, output) {
  if (typeof value === 'string') {
    output.push(...splitCandidateString(value));
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringsFromObject(item, output);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === 'string' && fileLikeKeyPattern.test(key)) {
      output.push(...splitCandidateString(nested));
      continue;
    }
    collectStringsFromObject(nested, output);
  }
}

function readStdinPayload() {
  if (process.stdin.isTTY) {
    return '';
  }
  try {
    return readFileSync(0, 'utf8').trim();
  } catch {
    return '';
  }
}

function normalizePath(filePath) {
  const unquoted = filePath.trim().replace(/^['"]|['"]$/g, '');
  if (!unquoted) {
    return null;
  }

  const asRelative = path.isAbsolute(unquoted) ? path.relative(process.cwd(), unquoted) : unquoted;
  const normalized = asRelative.replaceAll('\\', '/').replace(/^\.\/+/, '');
  if (!normalized) {
    return null;
  }

  if (ignoredPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return null;
  }

  if (!existsSync(path.resolve(process.cwd(), normalized))) {
    return null;
  }

  return normalized;
}

function gatherChangedFiles() {
  const candidates = [...cliFiles];

  for (const envVar of changedFileEnvVars) {
    const value = process.env[envVar];
    if (value) {
      candidates.push(...splitCandidateString(value));
    }
  }

  const stdinPayload = readStdinPayload();
  if (stdinPayload) {
    if (stdinPayload.startsWith('{') || stdinPayload.startsWith('[')) {
      try {
        const parsed = JSON.parse(stdinPayload);
        collectStringsFromObject(parsed, candidates);
      } catch {
        candidates.push(...splitCandidateString(stdinPayload));
      }
    } else {
      candidates.push(...splitCandidateString(stdinPayload));
    }
  }

  const normalized = candidates.map(normalizePath).filter((item) => item !== null);

  return [...new Set(normalized)];
}

function runChangedChecks() {
  const changedFiles = gatherChangedFiles();
  if (changedFiles.length === 0) {
    console.log('No supported changed files found, skipping changed-file checks.');
    return;
  }

  const lintFiles = changedFiles.filter((file) => lintExtensions.has(path.extname(file)));
  const formatFiles = changedFiles.filter((file) => formatExtensions.has(path.extname(file)));

  if (lintFiles.length > 0) {
    runOrExit('npm', ['exec', '--', 'oxlint', ...lintFiles]);
  }

  if (formatFiles.length > 0) {
    runOrExit('npm', ['exec', '--', 'oxfmt', '--check', ...formatFiles]);
  }

  if (lintFiles.length === 0 && formatFiles.length === 0) {
    console.log('No lint/format-supported changed files found, skipping checks.');
  }
}

function runFullChecks() {
  runOrExit('npm', ['test']);
  runOrExit('npm', ['run', 'lint']);
  runOrExit('npm', ['run', 'format:check']);
}

if (mode === 'changed') {
  runChangedChecks();
  process.exit(0);
}

if (mode === 'full') {
  runFullChecks();
  process.exit(0);
}

console.error('Usage: node scripts/agent-checks.mjs <changed|full> [files...]');
process.exit(1);
