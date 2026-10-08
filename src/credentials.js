// Deterministic credential parser (no AI/API needed).
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const KEY_PATTERNS = [
  /\b[a-z]{1,10}_(?:live|test|prod|sk|pk)_\S{3,}/i, // kc_live_xxx, sk_live_xxx
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/,
  /\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{10,}|\bgithub_pat_[A-Za-z0-9_]{10,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /\bAKIA[0-9A-Z]{12,}/,
  /\bhf_[A-Za-z0-9]{20,}/,
  /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{28,}\b/, // generic long token
];
const LABEL_RE = new RegExp(
  '^[*_#>\\s-]*(website|site|url|link|e-?mail|mail|user(?:name)?|login|password|pass|pwd|' +
  'api[\\s_-]*key|key|token|secret)[*_]*\\s*[:=]\\s*[*_]*\\s*(.+?)[*_]*\\s*$', 'i');
const LABEL_FIELD = {
  website: 'website', site: 'website', url: 'website', link: 'website',
  email: 'email', 'e-mail': 'email', mail: 'email',
  user: 'username', username: 'username', login: 'username',
  password: 'password', pass: 'password', pwd: 'password',
  apikey: 'apiKey', key: 'apiKey', token: 'apiKey', secret: 'apiKey',
};
const CRED_WORDS = /\b(passw\w*|api[\s_-]*key|credential\w*|login|token|secret|key)\b/i;

const stripUrlPunct = (u) => u.replace(/[.,;:!?)\]]+$/, '');
const findKey = (text) => {
  for (const re of KEY_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0].replace(/[,;)\]]+$/, '');
  }
  return null;
};

function siteName(website) {
  try {
    const parts = new URL(website).hostname.replace(/^www\./, '').split('.');
    let label = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    if (parts.length >= 3 && ['co', 'com', 'org', 'net', 'gov', 'ac'].includes(label)) label = parts[parts.length - 3];
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return null;
  }
}

const render = (name, bodyLines) =>
  [`> ### Credentials ${name}`, '> ', ...bodyLines.map((l) => `> ${l}`)].join('\n');

const NAME_RE = /^\p{L}[\p{L} &'-]{0,39}$/u;
const looksLikeSecret = (t) => /^\S{16,}$/.test(t) && /\d/.test(t) && !URL_RE.test(t) && !EMAIL_RE.test(t);

/**
 * "Name" on the first line, then one key per line, optionally followed (same line) by a description:
 *   Replit
 *   123504-b6d4...  Access Token
 * A description on its own line (after a key) is ignored.
 */
function parseNamedList(lines) {
  if (lines.length < 2 || !NAME_RE.test(lines[0])) return null;
  const keys = [];
  for (const line of lines.slice(1)) {
    const m = line.match(/^(\S+)(?:\s+(.+))?$/);
    if (m && looksLikeSecret(m[1])) keys.push({ key: m[1], desc: (m[2] || '').trim() });
  }
  if (!keys.length) return null;
  const name = lines[0].charAt(0).toUpperCase() + lines[0].slice(1);
  const body = keys.map(({ key, desc }) => `**Api Key${desc ? ` - ${desc}` : ''}:** ${key}`);
  return { status: 'ok', fields: { keys }, text: render(name, body) };
}

/** @returns {{status:'ok'|'incomplete'|'none', text?:string, fields?:object}} */
function parseCredentials(content) {
  const raw = (content || '').replace(/```(?:md|markdown)?/gi, '').trim();
  if (!raw) return { status: 'none' };

  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  if (!URL_RE.test(raw) && !EMAIL_RE.test(raw) && !lines.some((l) => LABEL_RE.test(l))) {
    const named = parseNamedList(lines.filter(Boolean));
    if (named) return named;
  }

  const f = {};
  const used = new Set();

  lines.forEach((line, i) => {
    const m = line.match(LABEL_RE);
    if (!m) return;
    const field = LABEL_FIELD[m[1].toLowerCase().replace(/[\s_-]+/g, '')];
    if (field && !f[field]) { f[field] = m[2]; used.add(i); }
  });

  if (!f.website) { const m = raw.match(URL_RE); if (m) f.website = stripUrlPunct(m[0]); }
  if (f.website) f.website = f.website.replace(/^<|>$/g, '');
  if (!f.email) { const m = raw.match(EMAIL_RE); if (m) f.email = m[0]; }

  const stripped = raw.replace(new RegExp(URL_RE, 'gi'), ' ').replace(new RegExp(EMAIL_RE, 'gi'), ' ');
  if (!f.apiKey) { const k = findKey(stripped); if (k) f.apiKey = k; }

  // Unlabeled password: a lone token line next to an email/username
  if (!f.password && (f.email || f.username)) {
    const line = lines.find((l, i) =>
      !used.has(i) && l && !/\s/.test(l) && !URL_RE.test(l) && !EMAIL_RE.test(l) && l !== f.apiKey && !LABEL_RE.test(l));
    if (line) f.password = line;
  }

  const hasSignal = !!(f.email || f.username || f.password || f.apiKey || CRED_WORDS.test(stripped));
  if (!hasSignal) return { status: 'none' };

  const complete = f.website && ((f.password && (f.email || f.username)) || f.apiKey);
  if (!complete) return { status: 'incomplete', fields: f };

  const body = [`**Website:** ${f.website}`];
  if (f.email) body.push(`**Email:** ${f.email}`);
  if (f.username) body.push(`**Username:** ${f.username}`);
  if (f.password) body.push(`**Password:** ${f.password}`);
  if (f.apiKey) body.push(`**Api Key:** ${f.apiKey}`);
  return { status: 'ok', fields: f, text: render(siteName(f.website) || 'Service', body) };
}

module.exports = { parseCredentials };
