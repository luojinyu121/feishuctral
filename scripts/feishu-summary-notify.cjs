#!/usr/bin/env node
/**
 * Feishu summary notification script for Claude Code stop hook.
 *
 * Sends session summary to Feishu. Unlike WeChat, Feishu supports true
 * proactive messaging via tenant_access_token — no user interaction needed.
 *
 * Usage: node feishu-summary-notify.cjs
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CTI_HOME = path.join(os.homedir(), '.claude-to-im');
const CONFIG_PATH = path.join(CTI_HOME, 'config.env');
const BINDINGS_PATH = path.join(CTI_HOME, 'data', 'bindings.json');
const SUMMARY_PATH = path.join(CTI_HOME, 'data', 'last-summary.txt');
const NOTIFY_LOG = path.join(CTI_HOME, 'logs', 'notify.log');

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  try { fs.mkdirSync(path.dirname(NOTIFY_LOG), { recursive: true }); fs.appendFileSync(NOTIFY_LOG, line + '\n'); } catch {}
  process.stderr.write(line + '\n');
}

function readJSON(fp, fallback) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return fallback; }
}

function parseEnv(fp) {
  const vars = {};
  try {
    fs.readFileSync(fp, 'utf-8').split(/\r?\n/).forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const idx = line.indexOf('=');
      if (idx > 0) vars[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
  } catch {}
  return vars;
}

function run(cmd, cwd) {
  try { return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return ''; }
}

// ── Auto-generate summary ──

function getProjectDir() {
  const cwd = process.cwd();
  let d = cwd;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(d, 'CLAUDE.md'))) return d;
    if (fs.existsSync(path.join(d, 'L5_code'))) return d;
    if (fs.existsSync(path.join(d, 'package.json'))) return d;
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return cwd;
}

function getProjectName(dir) {
  // Try to get a human-readable project name
  try {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      const j = JSON.parse(fs.readFileSync(pkg, 'utf-8'));
      if (j.name) return j.name;
    }
  } catch {}
  return path.basename(dir);
}

// Directories that should never be scanned for file changes
const NOISE_DIRS = new Set([
  'AppData', 'Application Data', 'Local Settings', 'Templates',
  'Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos',
  'Favorites', 'Links', 'Saved Games', 'Searches', 'Contacts',
  'OneDrive', 'Dropbox',
  'node_modules', '.git', '__pycache__', 'venv', '.venv', 'env',
  'dist', 'build', '.next', '.nuxt', 'target', 'bin', 'obj',
  'Debug', 'Release', 'objects', 'Listings', 'libraries', 'middlewares',
  '.cache', 'cache', 'tmp', 'temp', '.tmp',
  'logs', 'Logs', 'log',
  'BaiduYunKernel', 'BaiduYunGuanjia', 'ToDesk', 'NVIDIA Corporation',
  '腾讯电脑管家-全局搜',
]);

// File extensions worth reporting (code, config, docs)
const CODE_EXT = /\.(c|C|h|hpp|cpp|cxx|cc|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|cs|php|lua|sh|bash|zsh|ps1|bat|cmd|sql|md|mdx|rst|txt|json|yaml|yml|toml|ini|cfg|conf|env|xml|html|css|scss|less|vue|svelte|r|rmd|f|f90|jl|dart|ex|exs|erl|hrl|clj|cljs|edn|scm|ss|hs|lhs|elm|idr|lidr|idris|agda|v|vhd|sv|tcl|groovy|gradle|mk|cmake|dockerfile|makefile|proto|graphql)$/i;

// Home-directory markers — if dir looks like a user home, skip scan
function isHomeOrSystemDir(dir) {
  const normalized = path.normalize(dir).toLowerCase();
  const home = path.normalize(os.homedir()).toLowerCase();
  if (normalized === home) return true;
  // Also skip root directories
  if (normalized === 'c:\\' || normalized === 'd:\\' || normalized === '/') return true;
  if (normalized.endsWith('\\users') || normalized === '/users' || normalized === '/home') return true;
  return false;
}

function isRealProject(dir) {
  // Check for common project indicators
  const markers = [
    '.git', 'CLAUDE.md', 'package.json', 'Cargo.toml', 'go.mod',
    'Makefile', 'CMakeLists.txt', 'setup.py', 'pyproject.toml',
    'pom.xml', 'build.gradle', 'L5_code', 'src', 'lib',
  ];
  for (const m of markers) {
    if (fs.existsSync(path.join(dir, m))) return true;
  }
  return false;
}

function autoGenerateSummary(dir) {
  const parts = [];

  // 1. Git commits in last 2 hours
  const gitLog = run('git log --oneline -5 --since="2 hours ago"', dir);
  if (gitLog) {
    parts.push('📦 提交:');
    gitLog.split('\n').filter(Boolean).slice(0, 5).forEach(l => parts.push(`  ${l}`));
  }

  // 2. Git diff summary (unstaged + staged)
  if (!gitLog) {
    const diffStat = run('git diff --stat HEAD 2>/dev/null', dir) || run('git diff --stat --cached 2>/dev/null', dir);
    if (diffStat) {
      const lines = diffStat.split('\n').filter(l => l.includes('|'));
      if (lines.length > 0) {
        parts.push('📄 文件变更:');
        lines.slice(0, 8).forEach(l => {
          const file = l.split('|')[0].trim();
          const changes = l.split('|')[1]?.trim() || '';
          parts.push(`  ${file}  ${changes}`);
        });
        if (lines.length > 8) parts.push(`  ... 共 ${lines.length} 个文件`);
      }
    }
  }

  // 3. Recently modified CODE files — only in real projects, never in home dirs
  if (!gitLog && !parts.length) {
    if (!isHomeOrSystemDir(dir) && isRealProject(dir)) {
      const cutoff = Date.now() - 60 * 60 * 1000;
      const changed = [];
      function scanDir(subPath, depth) {
        if (depth > 3) return;
        const fullDir = path.join(dir, subPath);
        const basename = path.basename(fullDir);
        if (NOISE_DIRS.has(basename)) return;
        if (basename.startsWith('.') && basename !== '.claude') return;
        let entries;
        try { entries = fs.readdirSync(fullDir); } catch { return; }
        for (const entry of entries) {
          if (NOISE_DIRS.has(entry)) continue;
          if (entry.startsWith('.') && entry !== '.claude' && entry !== '.vscode') continue;
          const fp = path.join(fullDir, entry);
          let stat;
          try { stat = fs.statSync(fp); } catch { continue; }
          if (stat.isDirectory()) {
            scanDir(path.join(subPath, entry), depth + 1);
          } else if (stat.mtimeMs > cutoff && CODE_EXT.test(entry)) {
            changed.push({ file: path.relative(dir, fp), mtime: stat.mtimeMs });
          }
        }
      }
      scanDir('.', 0);
      if (changed.length > 0 && changed.length < 50) {
        changed.sort((a, b) => b.mtime - a.mtime);
        parts.push('📝 最近改动:');
        changed.slice(0, 8).forEach(c => parts.push(`  ${c.file}`));
        if (changed.length > 8) parts.push(`  ... 共 ${changed.length} 个文件`);
      }
    }
  }

  return parts.join('\n') || '';
}

// ── Feishu API helpers ──

async function getTenantToken(appId, appSecret, domain) {
  const url = `${domain}/open-apis/auth/v3/tenant_access_token/internal`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Feishu auth error: ${data.code} ${data.msg || ''}`);
  return data.tenant_access_token;
}

async function sendFeishuMessage(token, chatId, text, domain) {
  const content = JSON.stringify({ text });
  const url = `${domain}/open-apis/im/v1/messages?receive_id_type=chat_id`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: 'text',
      content,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Feishu send error: ${data.code} ${data.msg || ''}`);
  return data.data?.message_id;
}

// ── Main ──

async function main() {
  const env = parseEnv(CONFIG_PATH);
  const appId = env.CTI_FEISHU_APP_ID;
  const appSecret = env.CTI_FEISHU_APP_SECRET;
  const domainSetting = env.CTI_FEISHU_DOMAIN || 'feishu';
  const domain = domainSetting === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';

  if (!appId || !appSecret) {
    log('[feishu-summary] No Feishu credentials in config.env, skipping');
    return;
  }

  // Find active Feishu chat
  const bindings = readJSON(BINDINGS_PATH, {});
  let chatId = null;
  for (const [key, binding] of Object.entries(bindings)) {
    if (binding.channelType === 'feishu' && binding.active) {
      chatId = binding.chatId;
      break;
    }
  }
  // Fallback: any feishu binding
  if (!chatId) {
    for (const [key, binding] of Object.entries(bindings)) {
      if (binding.channelType === 'feishu') {
        chatId = binding.chatId;
        break;
      }
    }
  }

  if (!chatId) {
    log('[feishu-summary] No Feishu chat binding found (send a message to the bot first), skipping');
    return;
  }

  // Build message
  let message;
  try {
    message = fs.readFileSync(SUMMARY_PATH, 'utf-8').trim();
    fs.unlinkSync(SUMMARY_PATH);
    log('[feishu-summary] Read from summary file');
  } catch {
    log('[feishu-summary] No summary file, auto-generating...');
    const projectDir = getProjectDir();
    const projectName = getProjectName(projectDir);
    const autoSummary = autoGenerateSummary(projectDir);
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
    if (autoSummary) {
      message = `✅ ${timeStr} 任务完成 · ${projectName}\n\n${autoSummary}`;
    } else {
      message = `✅ ${timeStr} 任务完成 · ${projectName}\n\n💡 提示：让 Claude 在会话结束前写总结到 last-summary.txt 可获详细摘要`;
    }
  }

  if (message.length > 5000) message = message.slice(0, 4997) + '...';

  try {
    const token = await getTenantToken(appId, appSecret, domain);
    const msgId = await sendFeishuMessage(token, chatId, message, domain);
    log(`[feishu-summary] Sent (${message.length} chars, msgId: ${msgId})`);
  } catch (err) {
    log(`[feishu-summary] Send failed: ${err.message}`);
    process.exitCode = 1;
  }
}

main().catch(err => { log(`[feishu-summary] Error: ${err.message}`); process.exitCode = 1; });
