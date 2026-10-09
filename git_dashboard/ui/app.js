'use strict';

/* =========================================================
   RepoPulse UI: constellation graph + focus view
   ========================================================= */

const $ = (s, el = document) => el.querySelector(s);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; }
function timeAgo(ts) {
  if (!ts) return '—';
  const s = Date.now() / 1000 - ts;
  for (const [n, l] of [[31536000, 'y'], [2592000, 'mo'], [604800, 'w'], [86400, 'd'], [3600, 'h'], [60, 'm']]) if (s >= n) return Math.floor(s / n) + l + ' ago';
  return 'just now';
}
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/* ---------- icons ---------- */
const ICONS = {
  menu: '<path d="M4 7h16M4 12h10M4 17h16"/>',
  graph: '<circle cx="12" cy="12" r="2.6"/><circle cx="5" cy="5" r="1.8"/><circle cx="19" cy="5" r="1.8"/><circle cx="5" cy="19" r="1.8"/><circle cx="19" cy="19" r="1.8"/><path d="M6.4 6.4l3.7 3.7M17.6 6.4l-3.7 3.7M6.4 17.6l3.7-3.7M17.6 17.6l-3.7-3.7"/>',
  tree: '<circle cx="12" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M12 7v5M6 17v-3h12v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  filter: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>',
  sort: '<path d="M4 6h9M4 12h6M4 18h3M17 5v14m0 0l-3-3m3 3l3-3"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M12 7.5l1.2 3.3 3.3 1.2-3.3 1.2-1.2 3.3-1.2-3.3-3.3-1.2 3.3-1.2z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  send: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9c0 5-7 4-11 8"/>',
  commit: '<circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/>',
  file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M13 10v6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c1.9.7 3.1 2.6 3.5 5.5"/>',
  download: '<path d="M12 4v12M6 10l6 6 6-6M5 20h14"/>',
  upload: '<path d="M12 20V8M6 14l6-6 6 6M5 4h14"/>',
  sync: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>',
  terminal: '<path d="M4 6l6 6-6 6M12 19h8"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevR: '<path d="M9 6l6 6-6 6"/>',
  arrowUR: '<path d="M7 17L17 7M8 7h9v9"/>',
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  alert: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4M12 17v.01"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  stash: '<path d="M3 8h18v12H3zM3 8l2-4h14l2 4M9 12h6"/>',
  tag: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  repo: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 7h6"/>',
  sparkleWave: '<path d="M3 17c2.5 0 2.5-4 5-4s2.5 4 5 4"/><path d="M16 3l1.1 3 3 1.1-3 1.1L16 11l-1.1-2.8-3-1.1 3-1.1z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
};
const icon = (n, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24">${ICONS[n] || ''}</svg>`;
document.querySelectorAll('[data-i]').forEach(el => el.insertAdjacentHTML('afterbegin', icon(el.dataset.i)));

/* ---------- palette ---------- */
const STATUS = {
  conflict: { label: 'Conflicts', core: '#ffb0b6', deep: '#7a1020', rgb: '255,110,120', css: '#ff6e78' },
  behind: { label: 'Behind', core: '#ffe0a8', deep: '#80500e', rgb: '255,196,110', css: '#ffc46e' },
  dirty: { label: 'Uncommitted', core: '#ffc4dd', deep: '#8a2558', rgb: '244,140,190', css: '#f48cbe' },
  ahead: { label: 'Unpushed', core: '#ddd0ff', deep: '#43288f', rgb: '176,150,255', css: '#b096ff' },
  clean: { label: 'Clean', core: '#c4fbe6', deep: '#0b5c4b', rgb: '110,230,190', css: '#6fe3c9' },
};
const STATUS_ORDER = ['conflict', 'behind', 'dirty', 'ahead', 'clean'];
const PAL = {
  hub: { core: '#fff1d6', deep: '#86602c', rgb: '240,200,140' },
  branch: { core: '#e4d8ff', deep: '#4a2ea6', rgb: '170,140,255' },
  mint: { core: '#c9ffe9', deep: '#11785a', rgb: '120,240,200' },
  gold: { core: '#ffe6bd', deep: '#8a5a14', rgb: '255,205,130' },
};
const statusOf = r => (r.counts.conflicts ? 'conflict' : r.behind ? 'behind' : r.changed ? 'dirty' : r.ahead ? 'ahead' : 'clean');
const needsAttention = r => statusOf(r) !== 'clean' || !r.upstream;

/* ---------- state ---------- */
const S = {
  repos: [], roots: [], user: '', demo: false,
  mode: 'radial', sort: 'health', filters: new Set(), query: '',
  focus: null, detail: null, tab: 'commits', scanning: false, insights: false,
};

/* =========================================================
   Data source: pywebview bridge or built-in demo
   ========================================================= */
const API = {
  async init() {
    const ok = await new Promise(res => {
      if (window.pywebview && window.pywebview.api) return res(true);
      window.addEventListener('pywebviewready', () => res(true), { once: true });
      setTimeout(() => res(!!(window.pywebview && window.pywebview.api)), 1500);
    });
    S.demo = !ok;
  },
  call(name, ...args) { return S.demo ? Demo[name](...args) : window.pywebview.api[name](...args); },
};

const Demo = (() => {
  const now = Date.now() / 1000;
  const people = ['Nanthu', 'Priya R', 'Alex Chen', 'Sam Okafor', 'Maya Ito', 'Leo Brandt'];
  const msgs = ['Fix token refresh race', 'Add retry to vector upsert', 'Refactor settings loader', 'Bump deps', 'Improve chunking for PDFs', 'Add dark mode toggle',
    'Cache embeddings on disk', 'Handle empty uploads', 'Speed up cold start', 'Add e2e tests for chat', 'Rename env vars', 'Fix flaky CI step', 'Docs: setup on Windows',
    'Stream responses in UI', 'Add citation snippets', 'Drop unused imports', 'Tune top-k default', 'Migrate to Chroma 0.5', 'Add health endpoint', 'Fix CRLF in scripts'];
  const spec = [
    ['rag_app', 'main', 3, 0, 2, 'nanthu-fs'], ['api-gateway', 'develop', 0, 2, 0, 'acme'], ['web-dashboard', 'feat/charts', 7, 0, 3, 'acme'],
    ['ml-pipeline', 'main', 0, 0, 0, 'acme'], ['auth-service', 'main', 1, 0, 0, 'acme', 2], ['mobile-app', 'release/2.4', 0, 5, 1, 'acme'],
    ['infra-terraform', 'main', 0, 0, 0, 'acme'], ['design-system', 'next', 12, 0, 4, 'acme'], ['data-etl', 'main', 0, 3, 0, 'nanthu-fs'],
    ['docs-site', 'main', 0, 0, 0, 'nanthu-fs'], ['chat-widget', 'feat/voice', 4, 0, 6, 'nanthu-fs'], ['payments-core', 'hotfix/rounding', 2, 1, 0, 'acme', 0, 1],
    ['analytics-sdk', 'main', 0, 0, 1, 'acme'], ['dotfiles', 'master', 0, 0, 0, 'nanthu-fs', 0, 0, true], ['cli-tools', 'main', 5, 0, 0, 'nanthu-fs'],
    ['vision-lab', 'exp/vit', 0, 0, 9, 'nanthu-fs'],
  ];
  const repos = spec.map(([name, branch, changed, behind, ahead, owner, conflicts = 0, stashes = 0, stale = false], i) => {
    const counts = { modified: Math.ceil(changed * 0.6), added: changed > 3 ? 1 : 0, deleted: changed > 6 ? 1 : 0, untracked: 0, conflicts };
    counts.untracked = Math.max(0, changed - counts.modified - counts.added - counts.deleted);
    const kinds = Object.entries(counts).flatMap(([k, v]) => Array(v).fill(k));
    const files = kinds.map((k, j) => ({ name: ['src/', 'app/', 'tests/', ''][j % 4] + ['index.ts', 'config.py', 'utils.js', 'README.md', 'api.ts', 'chart.tsx', 'store.ts'][j % 7], kind: k === 'conflicts' ? 'conflict' : k }));
    const branches = [branch, ...['main', 'develop', 'feat/search', 'fix/login', 'chore/deps', 'exp/cache'].filter(b => b !== branch).slice(0, 1 + (i % 4))];
    const t = stale ? now - 86400 * 160 : now - 3600 * (2 + i * 9 + hash(name) * 30);
    const r = {
      path: `C:\\Users\\dev\\source\\repos\\${name}`, name, branch, upstream: name === 'vision-lab' ? '' : `origin/${branch}`,
      ahead, behind, changed: changed + conflicts, counts, files, branches, stashes,
      last_commit: { hash: (hash(name) * 0xfffffff | 0).toString(16).slice(0, 7), subject: msgs[i % msgs.length], author: people[i % people.length], time: t },
      remote: `https://github.com/${owner}/${name}.git`,
    };
    r.health = health(r);
    return r;
  });
  function health(r) {
    let s = 100 - Math.min(r.changed * 3, 30) - Math.min(r.ahead * 4, 20) - Math.min(r.behind * 5, 25) - r.counts.conflicts * 15;
    if (!r.upstream) s -= 10;
    if (now - r.last_commit.time > 90 * 86400) s -= 10;
    return Math.max(0, s);
  }
  const find = p => repos.find(r => r.path === p);
  const ok = (p, out) => sleep(650 + Math.random() * 500).then(() => ({ ok: true, output: out, repo: find(p) }));
  return {
    scan: () => sleep(500).then(() => ({ roots: ['C:\\Users\\dev\\source\\repos', 'C:\\Users\\dev\\Documents\\GitHub'], repos: JSON.parse(JSON.stringify(repos)), user: 'Nanthu' })),
    detail: p => {
      const r = JSON.parse(JSON.stringify(find(p)));
      const seed = hash(p);
      r.commits = Array.from({ length: 40 }, (_, k) => ({
        hash: (hash(p + k) * 0xfffffff | 0).toString(16).padStart(7, '0').slice(0, 7), subject: msgs[(k * 7 + Math.floor(seed * 20)) % msgs.length],
        author: people[(k + Math.floor(seed * 6)) % people.length], time: r.last_commit.time - k * 3600 * (9 + 14 * seed), refs: k === 0 ? `HEAD -> ${r.branch}` : '',
      }));
      r.activity = Array.from({ length: 30 }, (_, d) => Math.max(0, Math.round((Math.sin(d * 0.6 + seed * 9) + 1) * 3 * hash(p + d) + (d > 22 ? 3 : 0))));
      r.contributors = people.slice(0, 3 + Math.floor(seed * 3)).map((n, k) => ({ name: n, commits: Math.round(180 / (k + 1) * (0.6 + seed)) }));
      r.total_commits = 120 + Math.round(seed * 900);
      r.tags = Math.round(seed * 14);
      return sleep(250).then(() => r);
    },
    fetch: p => ok(p, 'Fetched origin'),
    pull: p => { const r = find(p); r.behind = 0; r.health = health(r); return ok(p, 'Fast-forwarded'); },
    push: p => { const r = find(p); r.ahead = 0; r.health = health(r); return ok(p, 'Pushed to origin'); },
    fetch_all: ps => sleep(1400).then(() => ps.map(p => ({ ok: true, repo: find(p) }))),
    add_root: () => { toast('Folder picker is available in the desktop app'); return Promise.resolve(['C:\\Users\\dev\\source\\repos', 'C:\\Users\\dev\\Documents\\GitHub']); },
    remove_root: () => Promise.resolve(['C:\\Users\\dev\\source\\repos']),
    open_editor: () => (toast('Would open VS Code (desktop app)'), true),
    open_terminal: () => toast('Would open terminal (desktop app)'),
    open_folder: () => toast('Would open Explorer (desktop app)'),
    open_remote: u => toast('Would open ' + u),
  };
})();

/* =========================================================
   Graph engine
   ========================================================= */
const G = {
  cv: $('#gv'), fx: $('#fx'), ctx: null, fctx: null, w: 0, h: 0, dpr: 1,
  cam: { x: 0, y: 0, z: 0.35 }, camT: { x: 0, y: 0, z: 1 }, savedCam: null,
  nodes: [], edges: [], byId: new Map(), dust: [], t: 0, buildT: 0, last: 0,
  hover: null, drag: null, focusT: 0, scanPulse: [],
};
G.ctx = G.cv.getContext('2d');
G.fctx = G.fx.getContext('2d');
const SX = x => (x - G.cam.x) * G.cam.z + G.w / 2;
const SY = y => (y - G.cam.y) * G.cam.z + G.h * 0.45;

function resize() {
  G.dpr = Math.min(window.devicePixelRatio || 1, 2);
  G.w = innerWidth; G.h = innerHeight;
  for (const c of [G.cv, G.fx]) { c.width = G.w * G.dpr; c.height = G.h * G.dpr; }
  if (S.focus) layoutFocus();
}
addEventListener('resize', resize);
resize();
G.dust = Array.from({ length: 170 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.3 + 0.2, s: Math.random() * 0.6 + 0.2, a: Math.random() * 0.5 + 0.1, p: Math.random() * TAU }));

function visibleRepos() {
  let list = S.repos.filter(r => !S.filters.size || S.filters.has(statusOf(r)));
  const by = {
    health: (a, b) => a.health - b.health || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    recent: (a, b) => (b.last_commit?.time || 0) - (a.last_commit?.time || 0),
    changes: (a, b) => b.changed + b.ahead + b.behind - (a.changed + a.ahead + a.behind),
  }[S.sort];
  return list.sort(by);
}

function buildGraph(fit = true) {
  const prev = G.byId, nodes = [], edges = [];
  const add = (id, o, parent) => {
    const p = prev.get(id), par = parent || { x: 0, y: 0 };
    const n = Object.assign({ id, x: p ? p.x : par.x, y: p ? p.y : par.y, tx: 0, ty: 0, r: 6, appear: p ? p.appear : 0, delay: 0, h: 0 }, o);
    nodes.push(n);
    return n;
  };
  const repos = visibleRepos();
  const avg = repos.length ? Math.round(repos.reduce((s, r) => s + r.health, 0) / repos.length) : 100;
  const hub = add('hub', { type: 'hub', r: 36, label: 'Workspace', badge: avg + '%', pal: PAL.hub });

  const repoNode = (r, i, parent) => add('r:' + r.path, {
    type: 'repo', repo: r, r: 16 + Math.min(r.changed + r.ahead, 12) * 0.5, label: r.name, badge: r.health + '%',
    pal: STATUS[statusOf(r)], delay: 0.25 + i * 0.045,
  }, parent);

  if (S.mode === 'radial') {
    const N = repos.length, R = Math.max(300, 90 + N * 26);
    repos.forEach((r, i) => {
      const a = -Math.PI / 2 + ((i + 0.5) / N) * TAU + (hash(r.path) - 0.5) * 0.14;
      const rr = R * (i % 2 ? 0.72 : 1) + (hash(r.name) - 0.5) * 60;
      const n = repoNode(r, i, hub);
      n.tx = Math.cos(a) * rr * 1.5; n.ty = Math.sin(a) * rr;
      edges.push(beamEdge(hub, n));
      satellites(r, n, a, add, edges);
    });
  } else {
    const groups = STATUS_ORDER.map(k => ({ k, list: repos.filter(r => statusOf(r) === k) })).filter(g => g.list.length);
    const GR = 300 + repos.length * 9;
    let idx = 0;
    groups.forEach((g, gi) => {
      const ga = -Math.PI / 2 + (gi / groups.length) * TAU;
      const gn = add('g:' + g.k, { type: 'group', r: 22, label: STATUS[g.k].label, badge: String(g.list.length), pal: STATUS[g.k], delay: 0.15 + gi * 0.06, status: g.k }, hub);
      gn.tx = Math.cos(ga) * GR * 1.55; gn.ty = Math.sin(ga) * GR;
      edges.push(beamEdge(hub, gn));
      const M = g.list.length, spread = Math.min(Math.PI * 1.2, 0.5 + M * 0.34), rad = 200 + M * 14;
      g.list.forEach((r, i) => {
        const a = ga + (M === 1 ? 0 : (i / (M - 1) - 0.5) * spread);
        const rr = rad * (i % 2 ? 0.78 : 1);
        const n = repoNode(r, idx++, gn);
        n.tx = gn.tx + Math.cos(a) * rr; n.ty = gn.ty + Math.sin(a) * rr;
        edges.push(beamEdge(gn, n, 0.7));
        satellites(r, n, a, add, edges);
      });
    });
  }

  // faint teal links between repos that share a remote owner
  const owners = {};
  for (const n of nodes) if (n.type === 'repo') {
    const m = (n.repo.remote || '').match(/[:/]([^/:]+)\/[^/]+?(?:\.git)?$/);
    if (m) (owners[m[1].toLowerCase()] ||= []).push(n);
  }
  for (const list of Object.values(owners)) for (let i = 1; i < list.length; i++) if (i % 2 || list.length < 5) edges.push({ a: list[i - 1], b: list[i], kind: 'link' });

  G.nodes = nodes.sort((a, b) => ORDER[a.type] - ORDER[b.type]);
  G.edges = edges;
  G.byId = new Map(nodes.map(n => [n.id, n]));
  G.buildT = G.t;
  if (fit) fitView();
  $('#empty').classList.toggle('show', !S.scanning && !S.repos.length);
}
const ORDER = { num: 0, branch: 1, repo: 2, group: 3, hub: 4 };
const beamEdge = (a, b, k = 1) => ({ a, b, kind: 'beam', k, parts: [Math.random(), Math.random() * 0.5 + 0.5].slice(0, 1 + (Math.random() > 0.4)) });

function satellites(r, n, a, add, edges) {
  const sat = (id, o, ang, dist, parent = n) => {
    const s = add(id, Object.assign({ repo: r, delay: n.delay + 0.3 + Math.random() * 0.25, sub: parent !== n }, o), parent);
    s.tx = parent.tx + Math.cos(ang) * dist; s.ty = parent.ty + Math.sin(ang) * dist;
    edges.push({ a: parent, b: s, kind: 'dash' });
    return s;
  };
  const others = r.branches.filter(b => b !== r.branch).slice(0, 3);
  others.forEach((b, k) => sat(`b:${r.path}:${b}`, { type: 'branch', r: 9, pal: PAL.branch, label: b }, a + (k - (others.length - 1) / 2) * 0.5, 112 + k * 16));
  if (r.changed) {
    const c = sat(`c:${r.path}`, { type: 'num', r: 4.5, pal: PAL.gold, num: r.changed, label: 'changed files' }, a - 1.1, 68);
    Object.entries(r.counts).filter(([, v]) => v > 0 && v !== r.changed).slice(0, 3)
      .forEach(([k, v], j) => sat(`c:${r.path}:${k}`, { type: 'num', r: 3.5, pal: k === 'untracked' ? PAL.mint : k === 'conflicts' ? STATUS.conflict : PAL.gold, num: v, label: k }, a - 1.1 + (j - 1) * 0.6, 46, c));
  }
  if (r.ahead) sat(`a:${r.path}`, { type: 'num', r: 5.5, pal: PAL.mint, num: r.ahead, arrow: '↑', label: 'unpushed commits' }, a + 1.05, 62);
  if (r.behind) sat(`bh:${r.path}`, { type: 'num', r: 5.5, pal: STATUS.behind, num: r.behind, arrow: '↓', label: 'commits behind remote' }, a + 1.45, 72);
  if (r.stashes) sat(`s:${r.path}`, { type: 'num', r: 3.5, pal: PAL.branch, num: r.stashes, label: 'stashes' }, a + 0.55, 52);
}

function fitView() {
  if (!G.nodes.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of G.nodes) { x0 = Math.min(x0, n.tx); y0 = Math.min(y0, n.ty); x1 = Math.max(x1, n.tx); y1 = Math.max(y1, n.ty); }
  const bw = x1 - x0 + 260, bh = y1 - y0 + 160;
  const z = clamp(Math.min((G.w - 60) / bw, (G.h - 250) / bh), 0.3, 1.35);
  G.camT = { x: (x0 + x1) / 2 + 40, y: (y0 + y1) / 2 + 30, z };
}

/* ---------- drawing primitives ---------- */
function orb(c, x, y, r, pal, o = {}) {
  const glow = o.glow ?? 1;
  c.globalCompositeOperation = 'lighter';
  let g = c.createRadialGradient(x, y, r * 0.4, x, y, r * 3.4);
  g.addColorStop(0, `rgba(${pal.rgb},${0.32 * glow})`);
  g.addColorStop(0.4, `rgba(${pal.rgb},${0.09 * glow})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 3.4, 0, TAU); c.fill();
  c.globalCompositeOperation = 'source-over';
  if (o.rings) {
    for (const [k, al] of [[1.3, 0.55], [1.52, 0.32], [1.74, 0.16]]) {
      c.strokeStyle = `rgba(${pal.rgb},${al * glow})`; c.lineWidth = Math.max(0.8, r * 0.07);
      c.beginPath(); c.arc(x, y, r * k, 0, TAU); c.stroke();
    }
  }
  c.fillStyle = 'rgba(6,12,12,.75)'; c.beginPath(); c.arc(x, y, r * 1.12, 0, TAU); c.fill();
  g = c.createRadialGradient(x - r * 0.35, y - r * 0.42, r * 0.04, x, y, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.22, pal.core); g.addColorStop(0.78, pal.deep); g.addColorStop(1, 'rgba(10,6,14,1)');
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  // rim light
  c.strokeStyle = `rgba(${pal.rgb},.75)`; c.lineWidth = Math.max(0.6, r * 0.06);
  c.beginPath(); c.arc(x, y, r * 0.93, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
  // specular
  c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.ellipse(x - r * 0.33, y - r * 0.45, r * 0.28, r * 0.16, -0.6, 0, TAU); c.fill();
}

const wave = (i, t, f = 1) => 0.5 + 0.5 * Math.sin(i * 0.61 * f + t * 2.1) * Math.sin(i * 0.23 * f - t * 1.3 + 1.7) * Math.cos(i * 0.11 + t * 0.7);

function spikes(c, x, y, r0, len, count, t, rgb, alpha, lw = 1) {
  c.globalCompositeOperation = 'lighter';
  c.strokeStyle = `rgba(${rgb},${alpha})`; c.lineWidth = lw;
  c.beginPath();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU, l = len * (0.25 + 0.75 * wave(i, t));
    c.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    c.lineTo(x + Math.cos(a) * (r0 + l), y + Math.sin(a) * (r0 + l));
  }
  c.stroke();
  c.globalCompositeOperation = 'source-over';
}

function waveRing(c, x, y, r0, amp, t, rgb, alpha, lw = 1, f = 1) {
  c.globalCompositeOperation = 'lighter';
  c.strokeStyle = `rgba(${rgb},${alpha})`; c.lineWidth = lw;
  c.beginPath();
  const n = 220;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU, rr = r0 + amp * (wave(i * 1.7, t, f) - 0.5) * 2 + amp * 0.4 * Math.sin(i * 1.9 + t * 6);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    i ? c.lineTo(px, py) : c.moveTo(px, py);
  }
  c.stroke();
  c.globalCompositeOperation = 'source-over';
}

function taper(c, ax, ay, bx, by, w0, w1, rgb, al, mid = 0.28) {
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  const g = c.createLinearGradient(ax, ay, bx, by);
  g.addColorStop(0, `rgba(${rgb},${al})`); g.addColorStop(0.55, `rgba(${rgb},${al * mid})`); g.addColorStop(1, `rgba(${rgb},${al * 0.75})`);
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(ax + nx * w0, ay + ny * w0); c.lineTo(bx + nx * w1, by + ny * w1);
  c.lineTo(bx - nx * w1, by - ny * w1); c.lineTo(ax - nx * w0, ay - ny * w0);
  c.closePath(); c.fill();
}

function badge(c, x, y, text, fs, gold) {
  const isPct = text.endsWith('%'), main = isPct ? text.slice(0, -1) : text;
  c.font = `600 ${fs}px ${COND}`;
  const tw = c.measureText(main).width + (isPct ? fs * 0.5 : 0);
  const h = fs * 1.35, w = tw + fs * (isPct ? 1.15 : 0.9), sk = h * 0.28;
  c.fillStyle = 'rgba(78,88,88,.82)';
  c.beginPath(); c.moveTo(x + sk, y); c.lineTo(x + w + sk, y); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath(); c.fill();
  c.fillStyle = gold ? '#f0cf98' : '#eef3f2'; c.textBaseline = 'middle';
  c.fillText(main, x + fs * 0.5, y + h / 2 + 0.5);
  if (isPct) { c.font = `600 ${fs * 0.58}px ${COND}`; c.fillText('%', x + fs * 0.5 + c.measureText(main).width + 1 + (fs - fs * 0.58) * 0.2, y + h * 0.36); }
}
let COND = '"Roboto Condensed","Bahnschrift SemiCondensed","Bahnschrift","Arial Narrow",sans-serif';
const label = (c, x, y, text, fs, alpha = 1) => {
  c.font = `500 ${fs}px ${COND}`; c.textBaseline = 'alphabetic';
  c.shadowColor = 'rgba(0,0,0,.9)'; c.shadowBlur = 10;
  c.fillStyle = `rgba(240,245,244,${alpha})`; c.fillText(text, x, y);
  c.shadowBlur = 0;
};

/* ---------- frame ---------- */
function activeSet() {
  const h = G.hover;
  if (h && h.type !== 'hub' && h.type !== 'group' && h.repo) return { repo: h.repo.path };
  if (h && h.type === 'group') return { status: h.status };
  if (S.query) return { q: S.query.toLowerCase() };
  return null;
}
function isActive(n, set) {
  if (!set || n.type === 'hub') return true;
  if (set.repo) return n.repo?.path === set.repo;
  if (set.status) return n.type === 'group' ? n.status === set.status : n.repo && statusOf(n.repo) === set.status;
  if (set.q) return n.type === 'group' || (n.repo && (n.repo.name.toLowerCase().includes(set.q) || n.repo.branch.toLowerCase().includes(set.q)));
  return true;
}

function frame(ts) {
  const dt = Math.min(0.05, (ts - (G.last || ts)) / 1000);
  G.last = ts; G.t += dt;
  const k = 1 - Math.pow(0.004, dt), kn = 1 - Math.pow(0.0025, dt);
  G.cam.x = lerp(G.cam.x, G.camT.x, k); G.cam.y = lerp(G.cam.y, G.camT.y, k); G.cam.z = lerp(G.cam.z, G.camT.z, k);
  G.focusT = lerp(G.focusT, document.body.classList.contains('focused') ? 1 : 0, 1 - Math.pow(0.01, dt));
  const since = G.t - G.buildT;
  for (const n of G.nodes) {
    n.x = lerp(n.x, n.tx, kn); n.y = lerp(n.y, n.ty, kn);
    if (since > n.delay) n.appear = Math.min(1, n.appear + dt * 2.2);
    n.h = lerp(n.h, n === G.hover ? 1 : 0, 1 - Math.pow(0.0001, dt));
  }
  drawGraph(dt);
  drawFocus(dt);
  requestAnimationFrame(frame);
}

function drawGraph(dt) {
  const c = G.ctx, { w, h, t } = G, z = G.cam.z;
  c.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  c.globalAlpha = 1;
  c.fillStyle = '#020505'; c.fillRect(0, 0, w, h);
  let g = c.createRadialGradient(w * 0.5, h * 0.36, 0, w * 0.5, h * 0.45, Math.max(w, h) * 0.78);
  g.addColorStop(0, '#22413d'); g.addColorStop(0.35, '#10231f'); g.addColorStop(0.7, '#050c0b'); g.addColorStop(1, '#010303');
  c.fillStyle = g; c.fillRect(0, 0, w, h);

  // drifting dust with slight parallax
  c.globalCompositeOperation = 'lighter';
  for (const d of G.dust) {
    d.y -= d.s * dt * 0.006; if (d.y < 0) d.y += 1;
    const px = (((d.x * w - G.cam.x * z * 0.06 * d.s) % w) + w) % w, py = (((d.y * h - G.cam.y * z * 0.06 * d.s) % h) + h) % h;
    c.fillStyle = `rgba(170,240,225,${d.a * (0.6 + 0.4 * Math.sin(t * 1.5 + d.p))})`;
    c.beginPath(); c.arc(px, py, d.r, 0, TAU); c.fill();
  }
  c.globalCompositeOperation = 'source-over';

  const A = 1 - G.focusT;
  if (A < 0.01) return;
  const set = activeSet();
  const act = new Map(G.nodes.map(n => [n, isActive(n, set)]));
  const dimA = n => (act.get(n) ? 1 : 0.16);

  // links
  c.globalCompositeOperation = 'lighter';
  for (const e of G.edges) if (e.kind === 'link') {
    const al = Math.min(e.a.appear, e.b.appear) * A * Math.min(dimA(e.a), dimA(e.b));
    c.strokeStyle = `rgba(110,225,215,${0.22 * al})`; c.lineWidth = 1;
    c.beginPath(); c.moveTo(SX(e.a.x), SY(e.a.y)); c.lineTo(SX(e.b.x), SY(e.b.y)); c.stroke();
  }

  // beams + comets
  for (const e of G.edges) if (e.kind === 'beam') {
    const p = ease(Math.min(e.a.appear, e.b.appear));
    if (p <= 0) continue;
    const al = A * Math.min(dimA(e.a), dimA(e.b));
    let ax = SX(e.a.x), ay = SY(e.a.y), bx = SX(e.b.x), by = SY(e.b.y);
    const L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L;
    const ra = e.a.r * z * 1.3, rb = e.b.r * z * 1.25;
    ax += ux * ra; ay += uy * ra;
    const ex = lerp(ax, bx - ux * rb, p), ey = lerp(ay, by - uy * rb, p);
    const hl = G.hover && (G.hover === e.b || G.hover.repo === e.b.repo) ? 1.6 : 1;
    const w0 = Math.max(1.6, 4.6 * z * e.k);
    const rgb = e.b.pal?.rgb && e.b.type === 'group' ? e.b.pal.rgb : '255,200,135';
    taper(c, ax, ay, ex, ey, w0 * 5, w0 * 1.6, rgb, 0.07 * al * hl, 0.15);
    taper(c, ax, ay, ex, ey, w0 * 2.2, w0 * 0.5, rgb, 0.16 * al * hl, 0.2);
    taper(c, ax, ay, ex, ey, w0 * 0.7, 0.5, '255,226,180', 0.6 * al * hl, 0.22);
    taper(c, ax, ay, ex, ey, w0 * 0.22, 0.2, '255,255,255', 0.55 * al * hl, 0.2);
    if (p >= 1) for (let i = 0; i < e.parts.length; i++) {
      e.parts[i] = (e.parts[i] + dt * (90 / L) * (0.7 + 0.3 * e.k)) % 1;
      const q = e.parts[i], hx = lerp(ex, ax, q), hy = lerp(ey, ay, q);
      const tl = Math.min(46, L * 0.25), tx = hx + ux * tl, ty = hy + uy * tl;
      const fade = Math.sin(q * Math.PI);
      const gg = c.createLinearGradient(hx, hy, tx, ty);
      gg.addColorStop(0, `rgba(255,250,235,${0.95 * fade * al})`); gg.addColorStop(1, 'rgba(255,220,170,0)');
      c.strokeStyle = gg; c.lineWidth = Math.max(1.4, 2.4 * z); c.lineCap = 'round';
      c.beginPath(); c.moveTo(hx, hy); c.lineTo(tx, ty); c.stroke();
      const rg = c.createRadialGradient(hx, hy, 0, hx, hy, 9);
      rg.addColorStop(0, `rgba(255,245,220,${0.7 * fade * al})`); rg.addColorStop(1, 'rgba(255,220,170,0)');
      c.fillStyle = rg; c.beginPath(); c.arc(hx, hy, 9, 0, TAU); c.fill();
    }
  }
  c.globalCompositeOperation = 'source-over';

  // dashed satellite edges
  c.setLineDash([2, 4]);
  for (const e of G.edges) if (e.kind === 'dash') {
    const p = ease(e.b.appear);
    if (p <= 0) continue;
    const al = A * dimA(e.b) * p;
    const ax = SX(e.a.x), ay = SY(e.a.y), bx = SX(lerp(e.a.x, e.b.x, p)), by = SY(lerp(e.a.y, e.b.y, p));
    c.strokeStyle = `rgba(230,240,238,${0.42 * al})`; c.lineWidth = 1;
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
  }
  c.setLineDash([]);

  // scan pulses
  for (const sp of G.scanPulse) {
    sp.t += dt;
    if (sp.t <= 0) continue;
    const rr = sp.t * 520 * z, al = Math.max(0, 1 - sp.t / 1.6) * A;
    c.strokeStyle = `rgba(240,205,150,${0.45 * al})`; c.lineWidth = 2;
    c.beginPath(); c.arc(SX(0), SY(0), rr, 0, TAU); c.stroke();
  }
  G.scanPulse = G.scanPulse.filter(s => s.t < 1.6);

  // nodes
  for (const n of G.nodes) {
    if (n.appear <= 0) continue;
    const ap = ease(n.appear), al = A * ap * dimA(n);
    const x = SX(n.x), y = SY(n.y);
    const minR = { hub: 24, group: 14, repo: 10.5, branch: 5.5, num: 3 }[n.type];
    const r = Math.max(minR, n.r * z) * (0.5 + 0.5 * ap) * (1 + 0.22 * n.h);
    if (x < -120 || x > w + 120 || y < -120 || y > h + 120) continue;
    c.globalAlpha = al;
    if (n.type === 'hub') {
      const rot = t * 0.25;
      spikes(c, x, y, r * 1.18, r * 0.55, 140, t + rot, '255,215,160', 0.55, 1);
      spikes(c, x, y, r * 1.05, r * 0.3, 90, -t * 1.3, '120,230,210', 0.4, 1);
      waveRing(c, x, y, r * 1.85, r * 0.08, t, '255,210,150', 0.35, 1);
      orb(c, x, y, r, n.pal, { glow: 1.3 + (S.scanning ? 0.6 * Math.sin(t * 8) : 0) });
      label(c, x + r * 2 + 6, y - 2, n.label, clamp(20 * Math.sqrt(z), 17, 26), al);
      badge(c, x + r * 2 + 6, y + 7, n.badge, clamp(12 * Math.sqrt(z), 11, 15));
    } else if (n.type === 'group') {
      spikes(c, x, y, r * 1.2, r * 0.5, 90, t * 0.8 + n.r, n.pal.rgb, 0.5, 1);
      orb(c, x, y, r, n.pal, { rings: true, glow: 1.2 });
      label(c, x + r * 2 + 4, y - 2, n.label, clamp(18 * Math.sqrt(z), 15, 24), al);
      badge(c, x + r * 2 + 4, y + 6, n.badge + ' repos', clamp(11 * Math.sqrt(z), 10, 14), true);
    } else if (n.type === 'repo') {
      const st = statusOf(n.repo);
      if (st !== 'clean') {
        const ph = (t * 0.6 + hash(n.id)) % 1;
        c.strokeStyle = `rgba(${n.pal.rgb},${0.5 * (1 - ph) * al})`; c.lineWidth = 1.2;
        c.beginPath(); c.arc(x, y, r * (1.6 + ph * 2.2), 0, TAU); c.stroke();
      }
      orb(c, x, y, r, n.pal, { rings: true, glow: 1 + n.h * 0.8 });
      const fs = clamp(16 * Math.sqrt(z), 13.5, 22);
      label(c, x + r * 1.9 + 6, y - 1, trunc(n.label, 22), fs, al);
      badge(c, x + r * 1.9 + 6, y + 5, n.badge, fs * 0.66);
    } else if (n.type === 'branch') {
      orb(c, x, y, r, n.pal, { rings: true, glow: 0.8 + n.h });
      if (n.h > 0.05 || z > 1.25) { c.globalAlpha = al * Math.max(n.h, z > 1.25 ? 0.7 : 0); label(c, x + r * 1.8 + 3, y + 4, trunc(n.label, 26), clamp(11 * Math.sqrt(z), 10, 14)); }
    } else {
      orb(c, x, y, r, n.pal, { glow: 0.9 + n.h });
      if (n.sub && !(z > 1.1 || n.h > 0.05 || (set && set.repo === n.repo.path))) continue;
      c.font = `600 ${clamp(10 * Math.sqrt(z), 9, 13)}px ${COND}`; c.textBaseline = 'alphabetic';
      c.fillStyle = '#0b1212'; const txt = (n.arrow || '') + n.num, tw = c.measureText(txt).width;
      const bx = x + r + 2, by = y - r - 13;
      c.globalAlpha = al * 0.85; c.beginPath(); c.roundRect(bx - 3, by - 1, tw + 6, 14, 3); c.fill();
      c.globalAlpha = al; c.fillStyle = '#eef3f2'; c.fillText(txt, bx, by + 10);
    }
  }
  c.globalAlpha = 1;
}

/* ---------- interaction ---------- */
function pick(mx, my) {
  let best = null, bd = Infinity;
  for (const n of G.nodes) {
    if (n.appear < 0.5) continue;
    const d = Math.hypot(SX(n.x) - mx, SY(n.y) - my), r = Math.max({ hub: 18, group: 14, repo: 12, branch: 9, num: 7 }[n.type], n.r * G.cam.z * 1.6);
    if (d < r && d < bd) { bd = d; best = n; }
  }
  return best;
}
G.cv.addEventListener('mousedown', e => { G.drag = { x: e.clientX, y: e.clientY, cx: G.camT.x, cy: G.camT.y, moved: false }; closePops(); });
addEventListener('mousemove', e => {
  if (S.focus) return;
  if (G.drag) {
    const dx = e.clientX - G.drag.x, dy = e.clientY - G.drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) G.drag.moved = true;
    G.camT.x = G.drag.cx - dx / G.cam.z; G.camT.y = G.drag.cy - dy / G.cam.z;
    G.cam.x = lerp(G.cam.x, G.camT.x, 0.6); G.cam.y = lerp(G.cam.y, G.camT.y, 0.6);
    hideTip();
    return;
  }
  if (e.target !== G.cv) { if (G.hover) { G.hover = null; hideTip(); } return; }
  const n = pick(e.clientX, e.clientY);
  if (n !== G.hover) { G.hover = n; n ? showTip(n) : hideTip(); }
  if (n) placeTip(e.clientX, e.clientY);
  G.cv.style.cursor = n ? 'pointer' : 'grab';
});
addEventListener('mouseup', e => {
  const d = G.drag; G.drag = null;
  if (!d || d.moved || e.target !== G.cv) return;
  const n = pick(e.clientX, e.clientY);
  if (!n) return;
  if (n.type === 'repo') openFocus(n.repo);
  else if (n.type === 'branch') openFocus(n.repo, 'branches');
  else if (n.type === 'num') openFocus(n.repo, n.label.includes('commit') ? 'commits' : 'changes');
  else if (n.type === 'group') { G.camT = { x: n.tx, y: n.ty, z: Math.max(G.cam.z, 1) * 1.4 }; }
  else fitView();
});
G.cv.addEventListener('dblclick', () => fitView());
G.cv.addEventListener('wheel', e => {
  e.preventDefault();
  const f = Math.exp(-e.deltaY * 0.0015), nz = clamp(G.camT.z * f, 0.2, 4);
  const wx = (e.clientX - G.w / 2) / G.camT.z + G.camT.x, wy = (e.clientY - G.h * 0.45) / G.camT.z + G.camT.y;
  G.camT.z = nz; G.camT.x = wx - (e.clientX - G.w / 2) / nz; G.camT.y = wy - (e.clientY - G.h * 0.45) / nz;
}, { passive: false });

/* ---------- tooltip ---------- */
const tip = $('#tip');
function statusTag(r) { const s = statusOf(r); return `<span class="tag s-${s}">${STATUS[s].label}</span>`; }
function showTip(n) {
  let html = '';
  if (n.type === 'repo') {
    const r = n.repo;
    html = `<h4>${esc(r.name)}</h4><div class="p">${esc(r.path)}</div>
      <div class="row"><span class="tag">${icon('branch')} ${esc(r.branch)}</span>${statusTag(r)}
      ${r.ahead ? `<span class="tag s-ahead">↑ ${r.ahead}</span>` : ''}${r.behind ? `<span class="tag s-behind">↓ ${r.behind}</span>` : ''}
      ${r.changed ? `<span class="tag s-dirty">${r.changed} changed</span>` : ''}</div>
      ${r.last_commit ? `<div class="c">“${esc(trunc(r.last_commit.subject, 60))}” · ${timeAgo(r.last_commit.time)}</div>` : ''}
      <div class="hint">Click to open ›</div>`;
  } else if (n.type === 'branch') html = `<h4>${esc(n.label)}</h4><div class="c">Local branch in ${esc(n.repo.name)}</div>`;
  else if (n.type === 'num') html = `<h4>${n.arrow || ''}${n.num} ${esc(n.label)}</h4><div class="c">${esc(n.repo.name)}</div>`;
  else if (n.type === 'group') html = `<h4>${esc(n.label)}</h4><div class="c">${n.badge} repositories</div>`;
  else html = `<h4>Workspace</h4><div class="c">${S.repos.length} repositories across ${S.roots.length} folder(s)</div><div class="hint">Double-click empty space to recenter</div>`;
  tip.innerHTML = html;
  tip.querySelectorAll('svg').forEach(s => (s.style.cssText = 'width:11px;height:11px'));
  tip.classList.add('show');
}
function placeTip(x, y) {
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(x + 18, G.w - r.width - 12) + 'px';
  tip.style.top = Math.min(y + 18, G.h - r.height - 12) + 'px';
}
function hideTip() { tip.classList.remove('show'); }

/* =========================================================
   Focus view
   ========================================================= */
const F = { ox: 0, oy: 0, cards: [], items: [], t0: 0, comets: [] };
const TABS = [
  { k: 'commits', icon: 'commit', label: 'Commits' },
  { k: 'branches', icon: 'branch', label: 'Branches' },
  { k: 'changes', icon: 'file', label: 'Changed Files' },
  { k: 'contributors', icon: 'users', label: 'Contributors' },
  { k: 'stats', icon: 'tag', label: 'Tags & Stashes', static: true },
];

async function openFocus(r, tab = 'commits') {
  if (S.focus) { S.tab = tab; S.focus = r; }
  else G.savedCam = { ...G.camT };
  hideTip(); G.hover = null; closePops();
  S.focus = r; S.tab = tab; S.detail = null;
  const n = G.byId.get('r:' + r.path);
  if (n) G.camT = { x: n.x, y: n.y, z: Math.max(G.cam.z * 3, 2.6) };
  const [d] = await Promise.all([API.call('detail', r.path), sleep(420)]);
  if (S.focus !== r) return;
  S.detail = d;
  document.body.classList.add('focused');
  renderFocus();
}
function closeFocus() {
  if (!S.focus) return;
  document.body.classList.remove('focused');
  S.focus = null;
  if (G.savedCam) G.camT = G.savedCam;
  $('#fItems').innerHTML = '';
}

function tabList(d, k) {
  if (k === 'commits') return d.commits.map(c => {
    const age = (Date.now() / 1000 - c.time) / 86400;
    return { t: c.subject, tag: c.hash, who: `${c.author} · ${timeAgo(c.time)}`, c: age < 3 ? '#3cd59b' : age < 21 ? '#ffb347' : '#ff5d6c', w: 1 };
  });
  if (k === 'branches') return d.branches.map(b => ({ t: b, tag: b === d.branch ? 'HEAD' : 'local', who: b === d.branch ? (d.upstream ? `tracks ${d.upstream}` : 'no upstream') : '', c: b === d.branch ? '#e8c38a' : '#8b7bd8' }));
  if (k === 'changes') {
    const col = { modified: '#ffb347', added: '#3cd59b', deleted: '#ff5d6c', untracked: '#7fd6ff', conflict: '#ff3b5c' };
    return d.files.map(f => ({ t: f.name, tag: f.kind.toUpperCase(), who: '', c: col[f.kind] || '#aaa' }));
  }
  if (k === 'contributors') {
    const max = Math.max(1, ...d.contributors.map(c => c.commits));
    return d.contributors.map(c => ({ t: c.name, tag: `${c.commits} commits`, who: '', c: '#6fe3c9', w: c.commits / max }));
  }
  return [];
}
const tabCount = (d, k) => ({ commits: d.total_commits, branches: d.branches.length, changes: d.changed, contributors: d.contributors.length, stats: `${d.tags} · ${d.stashes}` }[k]);

function renderFocus() {
  const d = S.detail, st = statusOf(d), pal = STATUS[st];
  $('#fHead').innerHTML = `<h1>${esc(d.name)}</h1><p>on <b>${esc(trunc(d.branch, 28))}</b></p>`;
  $('#fMeta').innerHTML = `<span class="skew"><span>HEALTH<b>${d.health}</b></span></span>
    <div class="meter">${icon('pulse')}<i style="--w:${Math.max(6, d.health)}%;--c:${d.health > 79 ? '#3cd59b' : d.health > 49 ? '#ffb347' : '#ff4d63'}"></i></div>`;
  $('#fCards').innerHTML = TABS.map(t => `<button class="f-card ${t.k === S.tab ? 'on' : ''}" data-tab="${t.k}">
    <div class="n">${icon(t.icon)}${esc(String(tabCount(d, t.k)))}</div><small>${t.label}</small></button>`).join('');
  $('#fCards').querySelectorAll('.f-card').forEach(b => b.addEventListener('click', () => {
    const t = TABS.find(x => x.k === b.dataset.tab);
    if (t.static) return toast(`${d.tags} tag(s), ${d.stashes} stash(es)`);
    S.tab = t.k; renderFocus();
  }));
  $('#fCrumb').innerHTML = `<button id="crumbHome">Overview</button><span>›</span>${esc(d.name)}<span>›</span>${esc(trunc(d.branch, 30))}`;
  $('#crumbHome').onclick = closeFocus;

  const healthCls = d.health > 79 ? 'good' : d.health > 49 ? 'mid' : '';
  const healthWord = d.health > 79 ? 'Healthy' : d.health > 49 ? 'Moderate' : 'Critical';
  const lc = d.last_commit;
  $('#fPanel').innerHTML = `
    <div class="p-kicker">${icon('repo')}Repository</div>
    <h2 title="${esc(d.name)}">${esc(d.name)}</h2>
    <div class="p-path" title="${esc(d.path)}">${esc(d.path)}</div>
    <div class="p-status">
      <div><span class="pill" style="color:${pal.css}">${pal.label}</span>
      <p>${lc ? `Last commit <b>${timeAgo(lc.time)}</b> by <b>${esc(lc.author)}</b>` : 'No commits yet'}</p></div>
      <button class="ghost" data-act="code">Open in VS Code ${icon('chevR')}</button>
    </div>
    <div class="p-health ${healthCls}">
      <div class="ph-top"><span>Repo Health</span><span class="pill">${healthWord}</span></div>
      <div class="ph-main"><div class="big">${d.health}%</div>
        <div class="delta"><b style="color:#9ff5d2">↑${d.ahead}</b> <b style="color:#ffd08a">↓${d.behind}</b><br>vs ${esc(d.upstream || 'no remote')}</div>
        <canvas id="matrix"></canvas></div>
    </div>
    <div class="p-grid">
      <div class="tile"><div class="n">${icon('file')}${d.changed}</div><small>Changed Files</small></div>
      <div class="tile"><div class="n">${icon('branch')}${d.branches.length}</div><small>Local Branches</small></div>
      <div class="tile"><div class="n">${icon('upload')}${d.ahead}</div><small>Unpushed Commits</small></div>
      <div class="tile"><div class="n">${icon('download')}${d.behind}</div><small>Behind Remote</small></div>
    </div>
    <div class="p-ins"><h4>${icon('sparkleWave')}Pulse Analysis</h4>
      ${repoInsights(d).map(i => `<div class="it ${i.lvl}"><b>${esc(i.title)}</b><p>${esc(i.text)}</p></div>`).join('')}</div>
    <div class="p-actions">
      <button data-act="fetch">${icon('sync')}Fetch</button>
      <button data-act="pull" class="${d.behind ? 'primary' : ''}">${icon('download')}Pull</button>
      <button data-act="push" class="${d.ahead ? 'primary' : ''}">${icon('upload')}Push</button>
      <button data-act="term">${icon('terminal')}Terminal</button>
    </div>`;
  $('#fPanel').querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => action(b.dataset.act, d, b)));
  if (d.remote) {
    $('#fPanel .p-kicker').insertAdjacentHTML('beforeend', `<button class="ghost" style="margin-left:auto;height:28px" data-act="remote">${icon('external')}Remote</button><button class="ghost" style="height:28px" data-act="folder">${icon('folder')}</button>`);
    $('#fPanel .p-kicker').querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => action(b.dataset.act, d, b)));
  }
  layoutFocus();
  drawMatrix($('#matrix'), d.activity, pal);
}

function layoutFocus() {
  if (!S.detail) return;
  const d = S.detail, w = G.w, h = G.h;
  const panelW = Math.min(430, w * 0.31) + 24;
  const aw = w - panelW - 24;
  F.ox = clamp(aw * 0.14, 120, 220); F.oy = h * 0.54;
  F.diskR = Math.min(240, aw * 0.2);
  const head = $('#fHead'), meta = $('#fMeta');
  head.style.left = F.ox + 'px'; head.style.top = F.oy - 92 + 'px';
  meta.style.left = F.ox + 'px'; meta.style.top = F.oy + 82 + 'px';

  const cx = Math.max(F.ox + 150, aw * 0.3), gap = Math.min(78, (h - 260) / TABS.length);
  F.cards = TABS.map((t, i) => ({ k: t.k, x: cx, y: F.oy + (i - (TABS.length - 1) / 2) * gap }));
  $('#fCards').querySelectorAll('.f-card').forEach((el, i) => { el.style.left = F.cards[i].x + 'px'; el.style.top = F.cards[i].y - 29 + 'px'; });

  const list = tabList(d, S.tab), M = Math.min(list.length, Math.floor((h - 220) / 36), 18);
  const H = Math.min(h - 230, Math.max(M - 1, 1) * 38), xm = Math.max(cx + 260, aw * 0.74), curve = (xm - cx - 190) * 0.55;
  F.items = list.slice(0, M).map((it, k) => {
    const tt = M === 1 ? 0 : (k / (M - 1)) * 2 - 1;
    return { ...it, x: xm - tt * tt * curve, y: F.oy + (tt * H) / 2, fade: 1 - Math.pow(Math.abs(tt), 4) * 0.65 };
  });
  const sel = F.cards.find(c => c.k === S.tab) || F.cards[0];
  F.sel = { x: sel.x + 156, y: sel.y };
  F.t0 = G.t;
  F.comets = F.items.length ? Array.from({ length: 4 }, (_, i) => ({ i: Math.floor(Math.random() * F.items.length), p: -i * 0.35, c: ['255,255,255', '110,230,210', '255,230,120', '200,240,255'][i] })) : [];

  const box = $('#fItems');
  box.innerHTML = F.items.map((it, k) => `<div class="f-item pre" style="left:${it.x}px;top:${it.y}px;max-width:${Math.max(120, aw - it.x - 10)}px;transition-delay:${0.25 + k * 0.035}s">
      <div class="t">${esc(it.t)}</div>
      <div class="m"><span class="tag">${esc(it.tag)}</span>${it.who ? `<span class="who">${esc(it.who)}</span>` : ''}<span class="bar" style="--c:${it.c};width:${Math.round(8 + 22 * (it.w ?? 1))}px"></span></div></div>`).join('');
  requestAnimationFrame(() => box.querySelectorAll('.f-item').forEach((el, k) => { el.classList.remove('pre'); el.style.opacity = F.items[k].fade; }));
  if (!F.items.length) box.innerHTML = `<div class="f-item" style="left:${xm - 60}px;top:${F.oy}px"><div class="t" style="color:#8ea4a1">Nothing here — all clear ✓</div></div>`;
}

const bez = (p0, p1, p2, p3, t) => { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3; };
function curvePts(it) {
  const sx = F.sel.x, sy = F.sel.y, ex = it.x - 2, ey = it.y;
  return [sx, sy, sx + (ex - sx) * 0.42, sy, sx + (ex - sx) * 0.5, ey, ex, ey];
}

function drawFocus(dt) {
  const c = G.fctx, { w, h, t } = G;
  c.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const A = G.focusT;
  if (A < 0.01 || !S.detail) return;
  c.globalAlpha = A;
  const { ox, oy } = F, pal = STATUS[statusOf(S.detail)];

  // dark well behind the orb
  let g = c.createRadialGradient(ox, oy, 0, ox, oy, F.diskR * 1.4);
  g.addColorStop(0, 'rgba(0,0,0,.6)'); g.addColorStop(0.65, 'rgba(0,0,0,.38)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.beginPath(); c.arc(ox, oy, F.diskR * 1.4, 0, TAU); c.fill();
  c.strokeStyle = 'rgba(120,220,200,.06)'; c.lineWidth = 1;
  c.beginPath(); c.arc(ox, oy, F.diskR, -Math.PI / 2.4, Math.PI / 2.4); c.stroke();

  // orb -> cards
  for (const cd of F.cards) {
    const on = cd.k === S.tab;
    c.strokeStyle = on ? 'rgba(255,225,180,.75)' : 'rgba(140,220,205,.28)'; c.lineWidth = on ? 1.4 : 1;
    c.beginPath(); c.moveTo(ox + 50, oy);
    c.bezierCurveTo(ox + 50 + (cd.x - ox) * 0.45, oy, cd.x - 60, cd.y, cd.x - 2, cd.y); c.stroke();
  }

  // fan curves
  const p = ease(clamp((G.t - F.t0 - 0.1) / 1.1, 0, 1));
  c.globalCompositeOperation = 'lighter';
  F.items.forEach((it, k) => {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = curvePts(it);
    const L = Math.hypot(x3 - x0, y3 - y0) * 1.15;
    const gg = c.createLinearGradient(x0, y0, x3, y3);
    gg.addColorStop(0, `rgba(255,230,190,${0.75 * A})`); gg.addColorStop(1, `rgba(220,240,235,${0.35 * it.fade * A})`);
    c.strokeStyle = gg; c.lineWidth = 1.1;
    c.setLineDash([L * p, L]);
    c.beginPath(); c.moveTo(x0, y0); c.bezierCurveTo(x1, y1, x2, y2, x3, y3); c.stroke();
    c.setLineDash([]);
    if (p > 0.85) { c.globalAlpha = A * it.fade; orb(c, x3, y3, 3.4, PAL.gold, { glow: 0.8 }); c.globalAlpha = A; c.globalCompositeOperation = 'lighter'; }
  });
  // glow at the fan origin
  g = c.createRadialGradient(F.sel.x, F.sel.y, 0, F.sel.x, F.sel.y, 40);
  g.addColorStop(0, `rgba(255,225,170,${0.55 * p})`); g.addColorStop(1, 'rgba(255,225,170,0)');
  c.fillStyle = g; c.beginPath(); c.arc(F.sel.x, F.sel.y, 40, 0, TAU); c.fill();

  // comets riding the curves
  if (p >= 1) for (const cm of F.comets) {
    cm.p += dt * 0.55;
    if (cm.p > 1) { cm.p = 0; cm.i = Math.floor(Math.random() * F.items.length); }
    if (cm.p < 0) continue;
    const pts = curvePts(F.items[cm.i]);
    for (let s = 0; s < 14; s++) {
      const q = cm.p - s * 0.012; if (q < 0) break;
      const x = bez(pts[0], pts[2], pts[4], pts[6], q), y = bez(pts[1], pts[3], pts[5], pts[7], q);
      c.fillStyle = `rgba(${cm.c},${(1 - s / 14) * 0.9 * A})`;
      c.beginPath(); c.arc(x, y, 2.4 * (1 - s / 16), 0, TAU); c.fill();
    }
    const x = bez(pts[0], pts[2], pts[4], pts[6], cm.p), y = bez(pts[1], pts[3], pts[5], pts[7], cm.p);
    const rg = c.createRadialGradient(x, y, 0, x, y, 12);
    rg.addColorStop(0, `rgba(${cm.c},${0.8 * A})`); rg.addColorStop(1, `rgba(${cm.c},0)`);
    c.fillStyle = rg; c.beginPath(); c.arc(x, y, 12, 0, TAU); c.fill();
  }
  c.globalCompositeOperation = 'source-over';

  // the orb
  const R = 34;
  waveRing(c, ox, oy, R * 2.05, R * 0.14, t * 0.9, pal.rgb, 0.55, 1.1, 1.3);
  waveRing(c, ox, oy, R * 2.0, R * 0.1, -t * 1.1 + 2, '176,150,255', 0.4, 1, 0.8);
  spikes(c, ox, oy, R * 1.12, R * 0.42, 110, t * 1.4, '120,230,210', 0.65, 1.1);
  spikes(c, ox, oy, R * 1.5, R * 0.18, 160, -t, pal.rgb, 0.3, 1);
  orb(c, ox, oy, R, pal, { glow: 1.4 });
  c.globalAlpha = 1;
}

function drawMatrix(cv, data, pal) {
  if (!cv) return;
  const dpr = G.dpr, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const c = cv.getContext('2d'); c.scale(dpr, dpr);
  const n = data.length, rows = 9, cw = W / n, max = Math.max(1, ...data);
  const peak = data.indexOf(max);
  for (let i = 0; i < n; i++) {
    const lit = Math.round((data[i] / max) * rows);
    for (let j = 0; j < rows; j++) {
      const on = j < lit, x = i * cw + cw / 2, y = H - 3 - j * (H / rows);
      c.fillStyle = on ? (i === peak ? '#ffffff' : `rgba(${pal.rgb},${0.55 + 0.45 * (j / rows)})`) : 'rgba(255,255,255,.09)';
      c.beginPath(); c.arc(x, y, on ? 1.4 : 1, 0, TAU); c.fill();
    }
  }
}

function repoInsights(r) {
  const out = [];
  if (r.counts.conflicts) out.push({ lvl: 'crit', title: 'Resolve merge conflicts', text: `${r.counts.conflicts} conflicted file(s) are blocking commits.` });
  if (r.behind) out.push({ lvl: 'warn', title: 'Pull recommended', text: `${r.behind} commit(s) on ${r.upstream} you don't have yet.` });
  if (r.ahead) out.push({ lvl: 'info', title: 'Push your work', text: `${r.ahead} local commit(s) aren't on the remote yet.` });
  if (r.changed) {
    const parts = Object.entries(r.counts).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ');
    out.push({ lvl: 'info', title: 'Uncommitted changes', text: `${r.changed} file(s): ${parts}.` });
  }
  if (!r.upstream) out.push({ lvl: 'warn', title: 'No upstream branch', text: `${r.branch} isn't tracking a remote branch, so it can't be synced.` });
  if (r.stashes) out.push({ lvl: 'info', title: 'Forgotten stashes?', text: `${r.stashes} stash entr${r.stashes > 1 ? 'ies' : 'y'} waiting to be applied or dropped.` });
  if (r.last_commit && Date.now() / 1000 - r.last_commit.time > 90 * 86400) out.push({ lvl: 'warn', title: 'Going stale', text: `No commits for ${timeAgo(r.last_commit.time).replace(' ago', '')}. Archive it?` });
  if (!out.length) out.push({ lvl: 'ok', title: 'All synced', text: 'Working tree is clean and in step with the remote.' });
  return out;
}

/* =========================================================
   Overview chrome: KPIs, insights, popovers, commands
   ========================================================= */
function animateNum(el, to) {
  const from = Number(el.textContent) || 0, t0 = performance.now();
  const step = now => { const k = ease(Math.min(1, (now - t0) / 900)); el.textContent = Math.round(lerp(from, to, k)); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function renderChrome() {
  const R = S.repos;
  animateNum($('#kRepos'), R.length);
  animateNum($('#kHealth'), R.length ? Math.round(R.reduce((s, r) => s + r.health, 0) / R.length) : 0);
  const attn = R.filter(needsAttention).length;
  animateNum($('#kAttn'), attn);
  animateNum($('#kAhead'), R.reduce((s, r) => s + r.ahead, 0));
  $('#attnLabel').textContent = '+' + attn;
  $('#rootsLabel').textContent = S.roots.length === 1 ? S.roots[0].split(/[\\/]/).filter(Boolean).pop() : `${S.roots.length} folders`;
  $('#avatar').textContent = (S.user || 'Git').split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase();
  $('#filterDot').textContent = S.filters.size; $('#filterDot').classList.toggle('show', S.filters.size > 0);
  $('#sortDot').textContent = { health: 'H', name: 'A', recent: 'R', changes: 'C' }[S.sort];
  $('#demoFlag').hidden = !S.demo;
  renderInsights();
}

function renderInsights() {
  const R = S.repos, by = f => R.filter(f);
  const cards = [];
  const conf = by(r => r.counts.conflicts), behind = by(r => r.behind), ahead = by(r => r.ahead), dirty = by(r => r.changed && !r.counts.conflicts);
  const noUp = by(r => !r.upstream), stale = by(r => r.last_commit && Date.now() / 1000 - r.last_commit.time > 90 * 86400);
  if (conf.length) cards.push({ lvl: 'crit', title: 'Critical: merge conflicts', tgt: conf[0], text: `${conf.length} repo(s) have unresolved conflicts blocking further work.`, list: conf });
  if (behind.length) cards.push({ lvl: 'warn', title: 'Pull recommended', tgt: behind[0], text: `${behind.reduce((s, r) => s + r.behind, 0)} incoming commit(s) across ${behind.length} repo(s).`, list: behind, cmd: 'pull' });
  if (ahead.length) cards.push({ lvl: 'info', title: 'Unpushed work', tgt: ahead[0], text: `${ahead.reduce((s, r) => s + r.ahead, 0)} local commit(s) not backed up to a remote.`, list: ahead });
  if (dirty.length) cards.push({ lvl: 'info', title: 'Uncommitted changes', tgt: dirty[0], text: `${dirty.reduce((s, r) => s + r.changed, 0)} changed file(s) across ${dirty.length} repo(s).`, list: dirty });
  if (noUp.length) cards.push({ lvl: 'warn', title: 'No upstream', tgt: noUp[0], text: `${noUp.length} branch(es) aren't tracking a remote.`, list: noUp });
  if (stale.length) cards.push({ lvl: 'warn', title: 'Going stale', tgt: stale[0], text: `${stale.length} repo(s) with no commits in 90+ days.`, list: stale });
  if (!cards.length) cards.push({ lvl: 'ok', title: 'Everything is in sync', text: 'All repositories are clean and up to date. Nice.', list: [] });
  $('#insList').innerHTML = cards.map((c, i) => `<div class="card-i ${c.lvl}">
    <div class="h"><b>${esc(c.title)}</b>${c.tgt ? `<button class="tgt" data-open="${i}">${esc(c.tgt.name)} ${icon('arrowUR')}</button>` : ''}</div>
    <p>${esc(c.text)}</p>
    ${c.list.length > 1 ? `<div class="repo-chips">${c.list.slice(0, 8).map((r, j) => `<button data-c="${i}:${j}">${esc(r.name)}</button>`).join('')}</div>` : ''}</div>`).join('');
  $('#insList').querySelectorAll('[data-open]').forEach(b => (b.onclick = () => openFocus(cards[b.dataset.open].tgt)));
  $('#insList').querySelectorAll('[data-c]').forEach(b => { const [i, j] = b.dataset.c.split(':'); b.onclick = () => openFocus(cards[i].list[j]); });
  placeInsights();
}
function placeInsights() { const d = $('#dock').getBoundingClientRect(); $('#insights').style.bottom = G.h - d.top + 12 + 'px'; }
addEventListener('resize', placeInsights);
function toggleInsights(on = !S.insights) { S.insights = on; $('#insights').classList.toggle('open', on); $('#pulseBtn').classList.toggle('on', on); placeInsights(); }

/* ---------- popovers ---------- */
function openPop(id, anchor, html, bind) {
  const pop = $(id), wasOpen = pop.classList.contains('open');
  closePops();
  if (wasOpen) return;
  pop.innerHTML = html; bind?.(pop);
  const a = anchor.getBoundingClientRect();
  pop.classList.add('open');
  const r = pop.getBoundingClientRect();
  const below = a.bottom + 10 + r.height < G.h;
  pop.style.left = clamp(a.left + a.width / 2 - r.width / 2, 12, G.w - r.width - 12) + 'px';
  pop.style.top = (below ? a.bottom + 10 : a.top - r.height - 10) + 'px';
}
function closePops() { document.querySelectorAll('.pop.open').forEach(p => p.classList.remove('open')); }
addEventListener('mousedown', e => { if (!e.target.closest('.pop, .tg button, .chip, #menuBtn')) closePops(); });

function filterPop() {
  openPop('#filterPop', $('#filterBtn'), `<h5>Show status</h5>${STATUS_ORDER.map(k => `<button class="opt ${S.filters.has(k) ? 'on' : ''}" data-k="${k}">
    <span class="sw" style="background:${STATUS[k].css};box-shadow:0 0 8px ${STATUS[k].css}"></span>${STATUS[k].label}
    <span style="color:#5d716e;margin-left:6px">${S.repos.filter(r => statusOf(r) === k).length}</span><span class="ck"></span></button>`).join('')}`, pop =>
    pop.querySelectorAll('.opt').forEach(b => (b.onclick = () => { const k = b.dataset.k; S.filters.has(k) ? S.filters.delete(k) : S.filters.add(k); b.classList.toggle('on'); buildGraph(); renderChrome(); })));
}
function sortPop() {
  const opts = [['health', 'Health (worst first)'], ['changes', 'Most activity'], ['recent', 'Recently committed'], ['name', 'Name']];
  openPop('#sortPop', $('#sortBtn'), `<h5>Order repos by</h5>${opts.map(([k, l]) => `<button class="opt ${S.sort === k ? 'on' : ''}" data-k="${k}">${l}<span class="ck"></span></button>`).join('')}`, pop =>
    pop.querySelectorAll('.opt').forEach(b => (b.onclick = () => { S.sort = b.dataset.k; closePops(); buildGraph(false); renderChrome(); })));
}
function rootsPop(anchor) {
  openPop('#rootsPop', anchor, `<h5>Scanned folders</h5>${S.roots.map((r, i) => `<div class="root">${icon('folder')}<span title="${esc(r)}">${esc(r)}</span><button data-i="${i}" title="Remove">${icon('close')}</button></div>`).join('')}
    <button class="btn-gold add" id="popAdd">${icon('plus')}Add Folder</button>`, pop => {
    pop.querySelectorAll('.root button').forEach(b => (b.onclick = async () => { S.roots = await API.call('remove_root', S.roots[b.dataset.i]); closePops(); scan(); }));
    $('#popAdd', pop).onclick = () => { closePops(); addRoot(); };
  });
}

/* ---------- actions ---------- */
async function scan() {
  if (S.scanning) return;
  S.scanning = true; document.body.classList.add('scanning'); $('#statusText').textContent = 'Scanning…';
  G.scanPulse.push({ t: 0 }, { t: -0.4 });
  try {
    const res = await API.call('scan');
    S.repos = res.repos; S.roots = res.roots; S.user = res.user || S.user;
    $('#statusText').textContent = `Synced ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (e) {
    toast('Scan failed: ' + e, false); $('#statusText').textContent = 'Scan failed';
  }
  S.scanning = false; document.body.classList.remove('scanning');
  buildGraph(); renderChrome();
}
async function addRoot() {
  const before = S.roots.length;
  S.roots = await API.call('add_root');
  if (S.roots.length !== before) scan();
}
function updateRepo(r) {
  if (!r) return;
  const i = S.repos.findIndex(x => x.path === r.path);
  if (i >= 0) S.repos[i] = r;
  buildGraph(false); renderChrome();
}
async function action(kind, r, btn) {
  const fn = { fetch: 'fetch', pull: 'pull', push: 'push', code: 'open_editor', open: 'open_editor', term: 'open_terminal', terminal: 'open_terminal', folder: 'open_folder', remote: 'open_remote' }[kind];
  if (!fn) return;
  if (fn === 'open_remote') return API.call(fn, r.remote);
  if (!['fetch', 'pull', 'push'].includes(fn)) {
    const ok = await API.call(fn, r.path);
    if (fn === 'open_editor' && ok === false) toast('VS Code (`code`) not found on PATH', false);
    return;
  }
  btn?.classList.add('busy');
  try {
    const res = await API.call(fn, r.path);
    toast(`${r.name}: ${res.ok ? (res.output.split('\n').pop() || `${fn} complete`) : `${fn} failed — ${res.output.split('\n').pop()}`}`, res.ok);
    updateRepo(res.repo);
    if (S.focus && S.focus.path === r.path) { S.detail = await API.call('detail', r.path); S.focus = res.repo; renderFocus(); }
  } finally { btn?.classList.remove('busy'); }
}
async function fetchAll() {
  if (!S.repos.length) return;
  const btn = $('#fetchAllBtn'); btn.querySelector('svg').style.animation = 'spin 1s linear infinite';
  toast(`Fetching ${S.repos.length} repositories…`);
  const res = await API.call('fetch_all', S.repos.map(r => r.path));
  res.forEach(x => { const i = S.repos.findIndex(r => r.path === x.repo.path); if (i >= 0) S.repos[i] = x.repo; });
  btn.querySelector('svg').style.animation = '';
  const failed = res.filter(x => !x.ok).length;
  toast(failed ? `Fetched with ${failed} failure(s)` : 'All repositories fetched', !failed);
  G.scanPulse.push({ t: 0 });
  buildGraph(false); renderChrome();
}
const findRepo = q => { q = q.toLowerCase().trim(); return S.repos.find(r => r.name.toLowerCase() === q) || S.repos.find(r => r.name.toLowerCase().startsWith(q)) || S.repos.find(r => r.name.toLowerCase().includes(q)); };
async function runCommand(text) {
  const t = text.trim(); if (!t) return;
  let m;
  if (/^(fetch|sync)( all)?$/i.test(t)) return fetchAll();
  if (/^(scan|refresh|rescan)$/i.test(t)) return scan();
  if (/^(insights?|pulse|analy[sz]e)$/i.test(t)) return toggleInsights(true);
  if ((m = t.match(/^(fetch|pull|push|code|open|term(?:inal)?|folder|remote)\s+(.+)$/i))) {
    const r = findRepo(m[2]);
    if (!r) return toast(`No repo matches “${m[2]}”`, false);
    return action(m[1].toLowerCase(), r);
  }
  const r = findRepo(t);
  r ? openFocus(r) : toast(`No repo matches “${t}”`, false);
}

function toast(msg, ok = true) {
  const el = document.createElement('div');
  el.className = 'toast glass' + (ok ? '' : ' bad');
  el.innerHTML = `<i></i><span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 3200);
}

/* ---------- wiring ---------- */
function setMode(m) { S.mode = m; $('#modeRadial').classList.toggle('on', m === 'radial'); $('#modeStatus').classList.toggle('on', m === 'status'); buildGraph(); }
$('#modeRadial').onclick = () => setMode('radial');
$('#modeStatus').onclick = () => setMode('status');
$('#zoomIn').onclick = () => (G.camT.z = clamp(G.camT.z * 1.25, 0.2, 4));
$('#zoomOut').onclick = () => (G.camT.z = clamp(G.camT.z / 1.25, 0.2, 4));
$('#filterBtn').onclick = filterPop;
$('#sortBtn').onclick = sortPop;
$('#scanBtn').onclick = () => { closeFocus(); scan(); };
$('#addRootBtn').onclick = addRoot;
$('#emptyAdd').onclick = addRoot;
$('#fetchAllBtn').onclick = fetchAll;
$('#searchBtn').onclick = () => { closeFocus(); $('#ask').focus(); };
$('#menuBtn').onclick = e => rootsPop(e.currentTarget);
$('#rootsChip').onclick = e => rootsPop(e.currentTarget);
$('#attnChip').onclick = () => { S.filters = new Set(['conflict', 'behind', 'dirty', 'ahead']); buildGraph(); renderChrome(); toast('Showing repos that need attention — clear in Filter'); };
$('#pulseBtn').onclick = () => toggleInsights();
$('#insClose').onclick = () => toggleInsights(false);
$('#backBtn').onclick = closeFocus;
$('#ask').addEventListener('input', e => { S.query = /^(fetch|pull|push|code|open|term|folder|remote|scan|refresh)\b/i.test(e.target.value) ? '' : e.target.value.trim(); });
$('#askForm').addEventListener('submit', e => { e.preventDefault(); const v = $('#ask').value; $('#ask').value = ''; S.query = ''; runCommand(v); });
addEventListener('keydown', e => {
  const typing = e.target.tagName === 'INPUT';
  if (e.key === 'Escape') { if (typing) e.target.blur(); closePops(); if (S.focus) closeFocus(); else if (S.insights) toggleInsights(false); }
  if (typing) return;
  if (e.key === '/') { e.preventDefault(); closeFocus(); $('#ask').focus(); }
  if (e.key === 'r' || e.key === 'R') scan();
  if (e.key === 'f' || e.key === 'F') fitView();
  if (e.key === 'i' || e.key === 'I') toggleInsights();
});

/* ---------- boot ---------- */
(async function boot() {
  requestAnimationFrame(frame);
  await API.init();
  if (document.fonts) document.fonts.ready.then(() => { if (!document.fonts.check('12px "Roboto Condensed"')) COND = '"Bahnschrift SemiCondensed","Bahnschrift","Arial Narrow",sans-serif'; });
  await scan();
  setTimeout(() => document.body.classList.remove('intro'), 120);
})();
