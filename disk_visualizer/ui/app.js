'use strict';

/* =========================================================
   DiskPulse UI: storage constellation, sunburst and focus view
   ========================================================= */

const $ = (s, el = document) => el.querySelector(s);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; }
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
function timeAgo(ts) {
  if (!ts) return '—';
  const s = Date.now() / 1000 - ts;
  for (const [n, l] of [[31536000, 'y'], [2592000, 'mo'], [604800, 'w'], [86400, 'd'], [3600, 'h'], [60, 'm']]) if (s >= n) return Math.floor(s / n) + l + ' ago';
  return 'just now';
}
function fmtB(b) {
  if (!b || b < 1) return ['0', 'B'];
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'], i = Math.min(5, Math.floor(Math.log(b) / Math.log(1024))), v = b / 1024 ** i;
  return [v >= 100 || i === 0 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2), u[i]];
}
const fmt = b => fmtB(b).join(' ');
const fmtShort = b => { const [v, u] = fmtB(b); return v + u[0]; };
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const pctTxt = (a, b) => { const p = pct(a, b); return (p >= 10 ? p.toFixed(0) : p.toFixed(1)) + '%'; };
const nfmt = n => Number(n || 0).toLocaleString();

/* ---------- icons ---------- */
const ICONS = {
  menu: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 14h.01M11 14h6"/>',
  graph: '<circle cx="12" cy="12" r="2.6"/><circle cx="5" cy="5" r="1.8"/><circle cx="19" cy="5" r="1.8"/><circle cx="5" cy="19" r="1.8"/><circle cx="19" cy="19" r="1.8"/><path d="M6.4 6.4l3.7 3.7M17.6 6.4l-3.7 3.7M6.4 17.6l3.7-3.7M17.6 17.6l-3.7-3.7"/>',
  rings: '<circle cx="12" cy="12" r="2.5"/><path d="M12 5.5A6.5 6.5 0 0 1 18.5 12M12 2a10 10 0 0 1 10 10M5.5 12A6.5 6.5 0 0 0 12 18.5M2 12a10 10 0 0 0 10 10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  details: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16M17 8h1M17 11h1M6 9h5M6 12h5M6 15h3"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M12 7.5l1.2 3.3 3.3 1.2-3.3 1.2-1.2 3.3-1.2-3.3-3.3-1.2 3.3-1.2z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  send: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  disk: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 14h.01M11 14h6"/>',
  pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevR: '<path d="M9 6l6 6-6 6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  reveal: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  sparkleWave: '<path d="M3 17c2.5 0 2.5-4 5-4s2.5 4 5 4"/><path d="M16 3l1.1 3 3 1.1-3 1.1L16 11l-1.1-2.8-3-1.1 3-1.1z"/>',
  arrowUR: '<path d="M7 17L17 7M8 7h9v9"/>',
};
const icon = (n, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24">${ICONS[n] || ''}</svg>`;
document.querySelectorAll('[data-i]').forEach(el => el.insertAdjacentHTML('afterbegin', icon(el.dataset.i)));

/* ---------- categories ---------- */
const CAT = {
  video: { label: 'Video', core: '#ffc4dd', deep: '#8a2558', rgb: '244,140,190', css: '#f48cbe' },
  images: { label: 'Images', core: '#ffe0a8', deep: '#80500e', rgb: '255,196,110', css: '#ffc46e' },
  audio: { label: 'Audio', core: '#ffc9b8', deep: '#8a3018', rgb: '255,140,110', css: '#ff8c6e' },
  archives: { label: 'Archives', core: '#ddd0ff', deep: '#43288f', rgb: '176,150,255', css: '#b096ff' },
  apps: { label: 'Apps & System', core: '#d3e3ff', deep: '#1f3f8a', rgb: '120,170,255', css: '#78aaff' },
  docs: { label: 'Documents', core: '#c4fbe6', deep: '#0b5c4b', rgb: '110,230,190', css: '#6fe3c9' },
  code: { label: 'Code & Dev', core: '#c8f6ff', deep: '#0b5368', rgb: '90,215,235', css: '#5ad7eb' },
  other: { label: 'Other', core: '#e4ecea', deep: '#34423f', rgb: '170,190,186', css: '#aabeba' },
};
const CAT_ORDER = ['video', 'images', 'audio', 'archives', 'apps', 'docs', 'code', 'other'];
const EXTS = {
  video: '.mp4 .mkv .avi .mov .wmv .webm .m4v .flv .mpg .mpeg .ts .vob', images: '.jpg .jpeg .png .gif .bmp .tif .tiff .psd .raw .cr2 .nef .heic .webp .svg .ico .dng',
  audio: '.mp3 .wav .flac .aac .ogg .m4a .wma .opus', archives: '.zip .rar .7z .tar .gz .tgz .bz2 .xz .iso .img .dmg .cab .vhd .vhdx .wim',
  apps: '.exe .dll .msi .sys .bin .so .dylib .appx .msix .pak .vdf .esd', docs: '.pdf .doc .docx .xls .xlsx .ppt .pptx .txt .md .csv .rtf .odt .epub .one .pst .ost',
  code: '.js .ts .jsx .tsx .py .pyc .java .class .jar .c .cpp .h .cs .go .rs .rb .php .json .map .node .whl .onnx .pt .pth .ckpt .safetensors .gguf .ipynb .lock',
};
const CAT_OF = Object.fromEntries(Object.entries(EXTS).flatMap(([c, s]) => s.split(' ').map(e => [e, c])));
const extOf = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i).toLowerCase() : ''; };
const catOfName = n => CAT_OF[extOf(n)] || 'other';
const domCat = cats => { let b = 'other', bv = -1; for (const [k, v] of Object.entries(cats || {})) if (v > bv) { bv = v; b = k; } return b; };
const PAL = {
  hub: { core: '#fff1d6', deep: '#86602c', rgb: '240,200,140' },
  ok: { core: '#c4fbe6', deep: '#0b5c4b', rgb: '110,230,190' },
  warn: { core: '#ffe0a8', deep: '#80500e', rgb: '255,196,110' },
  crit: { core: '#ffb0b6', deep: '#7a1020', rgb: '255,110,120' },
};

/* ---------- state ---------- */
const S = {
  view: 'drives', mode: 'orbit', demo: false, user: '', home: '', drives: [],
  tree: null, scanTarget: '', hidden: new Set(), query: '',
  focus: false, detail: null, tab: 'largest', insights: false, nav: false, lastScan: null,
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
  const GB = 1024 ** 3, now = Date.now() / 1000;
  const NAMES = {
    video: ['Trip_Iceland_4K.mp4', 'Recording_0412.mkv', 'Lecture_07.mp4', 'Wedding_final_cut.mov', 'gameplay_raw.mp4', 'Interview_B-roll.mov'],
    images: ['IMG_2041.HEIC', 'Panorama_Alps.tif', 'DSC_0193.NEF', 'poster_export_4k.psd', 'Screenshot 2025-03-02.png', 'catalog-previews.lrdata'],
    audio: ['Mixdown_v3.wav', 'Podcast_EP42.mp3', 'Album_FLAC.flac', 'Voice_memo.m4a'],
    archives: ['dataset_v2.zip', 'backup_2023.7z', 'ubuntu-24.04-desktop.iso', 'photos_2019.rar', 'docker_data.vhdx', 'windows11.wim'],
    apps: ['DockerDesktopInstaller.exe', 'vs_community.exe', 'game_data.pak', 'libcef.dll', 'resources.bin', 'textures.pak'],
    docs: ['Thesis_final_v9.pdf', 'Budget_2025.xlsx', 'Quarterly_Report.pptx', 'Outlook.pst', 'Scans_contracts.pdf'],
    code: ['model.safetensors', 'bundle.js.map', 'pytorch_model.bin', 'llama-3-8b.Q4.gguf', 'libtorch_cuda.so', 'train.ckpt'],
    other: ['cache.db', 'thumbcache_1024.db', 'trace.etl', 'index.dat', 'blob_storage.log'],
  };
  const SUBS = {
    video: ['2023', '2024', 'Raw', 'Exports'], images: ['2022', '2023', '2024', 'Edited'], audio: ['Albums', 'Stems', 'Podcasts'],
    archives: ['old', 'images', 'backups'], apps: ['bin', 'data', 'resources', 'lib'], docs: ['Archive', 'Shared', 'Scans'],
    code: ['models', 'build', 'cache', 'lib'], other: ['blobs', 'logs', 'data'], mixed: ['Old', 'New', 'Misc'],
  };
  const MIX = { video: 0.35, archives: 0.3, apps: 0.2, docs: 0.1, images: 0.05 };
  const STALE = { video: 0.55, images: 0.5, audio: 0.6, archives: 0.6, apps: 0.25, docs: 0.45, code: 0.2, other: 0.35, mixed: 0.5 };
  const SPEC = [
    ['Users', 'docs', [['dev', 'docs', [
      ['Videos', 'video', [['Screen Recordings', 18], ['Trips', 24.5], ['Lectures', 11.2], ['Edits', 6.4]]],
      ['Downloads', 'mixed', [['Installers', 9.8, 'apps'], ['Movies', 14.2, 'video'], ['Datasets', 8.6, 'archives'], ['Papers', 1.4, 'docs'], ['misc', 3.1]]],
      ['AppData', 'other', [['Local', 'other', [['Temp', 7.2], ['Docker', 12.4, 'archives'], ['npm-cache', 3.9, 'code'], ['Google', 3.4], ['Microsoft', 2.6], ['JetBrains', 2.2, 'code'], ['pip', 1.6, 'code']]], ['Roaming', 'other', [['Code', 1.8, 'code'], ['Spotify', 2.4, 'audio'], ['Discord', 0.9]]]]],
      ['Pictures', 'images', [['Camera Roll', 12.8], ['Screenshots', 2.1], ['Lightroom', 6.3]]],
      ['source', 'code', [['repos', 'code', [['ml-pipeline', 'code', [['data', 7.1, 'archives'], ['.venv', 1.9], ['checkpoints', 4.2]]], ['web-dashboard', 'code', [['node_modules', 2.4], ['dist', 0.3]]], ['rag_app', 'code', [['.venv', 0.9], ['chroma_db', 0.4, 'other']]], ['mobile-app', 'code', [['node_modules', 1.7], ['android', 1.2, 'apps']]]]]]],
      ['Documents', 'docs', [['Projects', 3.2], ['Finance', 0.6], ['Thesis', 1.8], ['Zoom', 2.4, 'video']]],
      ['Music', 'audio', [['Library', 8.4], ['Podcasts', 2.2]]],
      ['OneDrive', 'docs', [['Backups', 4.1, 'archives'], ['Shared', 1.2]]],
      ['.cache', 'code', [['huggingface', 6.8], ['torch', 1.4]]],
    ]], ['Public', 0.4]]],
    ['Windows', 'apps', [['WinSxS', 14.1], ['System32', 9.2], ['Installer', 6.1], ['SoftwareDistribution', 3.3, 'archives'], ['assembly', 2.2], ['Temp', 1.4, 'other'], ['Fonts', 0.6, 'other'], ['Logs', 0.4, 'other']]],
    ['Program Files', 'apps', [['Adobe', 18.2], ['Docker', 5.1], ['JetBrains', 6.0], ['Microsoft Office', 4.5], ['NVIDIA Corporation', 2.1], ['Git', 0.4], ['nodejs', 0.2, 'code']]],
    ['Program Files (x86)', 'apps', [['Steam', [['steamapps', 38.5], ['bin', 0.9]]], ['Microsoft', 1.9], ['Common Files', 1.1]]],
    ['XboxGames', 'apps', [['Forza Horizon 5', 41.2], ['Halo Infinite', 27.4]]],
    ['ProgramData', 'apps', [['Microsoft', 4.4], ['Package Cache', 5.6, 'archives'], ['NVIDIA', 1.2]]],
    ['$Recycle.Bin', 'other', [['S-1-5-21-1001', 6.2, 'mixed']]],
  ];
  const ROOT_FILES = [['pagefile.sys', 16], ['hiberfil.sys', 12.8], ['swapfile.sys', 0.26]];
  const index = new Map();
  const join = (p, n) => (p.endsWith('\\') ? p + n : p + '\\' + n);
  const mk = (name, path, parent) => { const n = { name, path, parent, size: 0, files: 0, dirs: 0, stale: 0, cats: {}, exts: {}, top: [], children: [] }; index.set(path.toLowerCase(), n); return n; };
  const addFile = (n, name, size, mtime) => {
    n.size += size; n.files += 1;
    const c = catOfName(name), e = extOf(name) || '(none)';
    n.cats[c] = (n.cats[c] || 0) + size; n.exts[e] = (n.exts[e] || 0) + size;
    if (now - mtime > 365 * 86400) n.stale += size;
    n.top.push([size, name, mtime]);
  };
  function fillLeaf(n, bytes, hint, depth) {
    const mix = hint === 'mixed' ? MIX : { [hint]: 1 };
    if (depth < 1 && bytes > 2 * GB) {
      const subs = SUBS[hint] || SUBS.mixed, k = 2 + Math.floor(hash(n.path) * (subs.length - 1));
      let left = bytes * 0.72;
      subs.slice(0, k).forEach((s, i) => { const part = i === k - 1 ? left : left * (0.35 + hash(n.path + s) * 0.3); left -= part; const c = mk(s, join(n.path, s), n); fillLeaf(c, part, hint, depth + 1); n.children.push(c); });
      bytes *= 0.28;
    }
    const fr = [0.3, 0.17, 0.1, 0.06, 0.04, 0.03];
    let used = 0;
    Object.entries(mix).forEach(([cat, share]) => {
      const names = NAMES[cat] || NAMES.other, b = bytes * share;
      fr.slice(0, 2 + Math.floor(hash(n.path + cat) * 4)).forEach((f, i) => {
        const nm = names[(i + Math.floor(hash(n.path) * 9)) % names.length].replace(/(\.[^.]+)$/, i ? `_${i}$1` : '$1');
        addFile(n, nm, b * f, now - hash(n.path + nm) * 3.2 * 365 * 86400); used += b * f;
      });
    });
    const rest = bytes - used, cat = hint === 'mixed' ? 'other' : hint;
    n.size += rest; n.files += Math.round(bytes / GB * 380 + 12);
    n.cats[cat] = (n.cats[cat] || 0) + rest;
    const e = (EXTS[cat] || '.dat').split(' ')[0]; n.exts[e] = (n.exts[e] || 0) + rest;
    n.stale += rest * (STALE[hint] || 0.3) * (0.6 + 0.8 * hash(n.path));
  }
  function build(spec, parent, hint) {
    for (const e of spec) {
      let [name, a, b] = e, h = hint, children = null, size = null;
      if (typeof a === 'number') { size = a; h = b || hint; } else if (Array.isArray(a)) children = a; else { h = a; if (typeof b === 'number') size = b; else children = b; }
      const n = mk(name, join(parent.path, name), parent);
      if (size != null) fillLeaf(n, size * GB, h, 0); else build(children, n, h);
      parent.children.push(n);
    }
    aggregate(parent);
  }
  function aggregate(n) {
    n.dirs = n.children.length;
    for (const c of n.children) {
      if (!c._agg) aggregate(c);
      n.size += c.size; n.files += c.files; n.dirs += c.dirs; n.stale += c.stale;
      for (const [k, v] of Object.entries(c.cats)) n.cats[k] = (n.cats[k] || 0) + v;
      for (const [k, v] of Object.entries(c.exts)) n.exts[k] = (n.exts[k] || 0) + v;
    }
    n.children.sort((a, b) => b.size - a.size);
    n.top.sort((a, b) => b[0] - a[0]);
    n._agg = true;
  }
  const root = mk('C:\\', 'C:\\', null);
  ROOT_FILES.forEach(([nm, gb]) => addFile(root, nm, gb * GB, now - 86400 * 3));
  build(SPEC, root, 'other');
  const drives = [
    { path: 'C:\\', label: 'Windows', total: Math.round(root.size / 0.86), used: root.size, free: Math.round(root.size / 0.86) - root.size },
    { path: 'D:\\', label: 'Data', total: 1863 * GB, used: 1104 * GB, free: 759 * GB },
    { path: 'E:\\', label: 'USB Drive', total: 58 * GB, used: 54.1 * GB, free: 3.9 * GB },
  ];
  const all = [...index.values()];
  const files = n => n.top.slice(0, 99).map(([s, nm, m]) => ({ name: nm, size: s, mtime: m, path: join(n.path, nm) }));
  const json = (n, depth, top, nf) => {
    const d = { path: n.path, name: n.name, size: n.size, files: n.files, dirs: n.dirs, cats: n.cats, stale: n.stale, error: false, top_files: files(n).slice(0, nf) };
    if (depth > 0) {
      d.children = n.children.slice(0, top).map(c => json(c, depth - 1, 4, depth === 2 ? 2 : 0));
      const rest = n.children.slice(top);
      d.other = { size: rest.reduce((s, c) => s + c.size, 0), count: rest.length };
    }
    return d;
  };
  const sub = function* (n) { const st = [n]; while (st.length) { const x = st.pop(); yield x; st.push(...x.children); } };
  const node = p => (p ? index.get(String(p).toLowerCase()) : root);
  let t0 = 0, scanning = false, target = 'C:\\';
  return {
    info: () => Promise.resolve({ user: 'Nanthu', home: 'C:\\Users\\dev', drives }),
    drives: () => Promise.resolve(drives),
    start_scan: p => { target = p; t0 = Date.now(); scanning = true; if (!p.toUpperCase().startsWith('C:')) toast('Demo mode uses sample data for C:\\'); return Promise.resolve(true); },
    stop_scan: () => { t0 = Date.now() - 99999; },
    progress: () => {
      const el = (Date.now() - t0) / 1000, f = Math.min(1, el / 3.2);
      if (f >= 1) scanning = false;
      return Promise.resolve({ running: scanning, files: Math.round(root.files * ease(f)), bytes: root.size * ease(f), errors: 0, current: all[Math.floor(f * (all.length - 1))].path, target, elapsed: el, ready: !scanning });
    },
    pick_folder: () => Promise.resolve('C:\\Users\\dev'),
    tree: p => {
      const n = node(p); if (!n) return Promise.resolve(null);
      const d = json(n, 2, 18, 6);
      d.parent = n.parent ? n.parent.path : null; d.root = root.path;
      const crumbs = []; for (let x = n; x; x = x.parent) crumbs.unshift({ name: x.name, path: x.path });
      d.crumbs = crumbs;
      return sleep(120).then(() => d);
    },
    details: p => {
      const n = node(p), big = [], stale = [];
      for (const x of sub(n)) for (const [s, nm, m] of x.top) { const it = { name: nm, size: s, mtime: m, path: join(x.path, nm), dir: x.path }; big.push(it); if (now - m > 365 * 86400) stale.push(it); }
      big.sort((a, b) => b.size - a.size); stale.sort((a, b) => b.size - a.size);
      return sleep(150).then(() => ({
        path: n.path, name: n.name, size: n.size, files: n.files, dirs: n.dirs, cats: n.cats, stale: n.stale,
        largest: big.slice(0, 60), stale_files: stale.slice(0, 40),
        exts: Object.entries(n.exts).map(([ext, size]) => ({ ext, size })).sort((a, b) => b.size - a.size).slice(0, 24),
        subfolders: n.children.slice(0, 60).map(c => ({ name: c.name, path: c.path, size: c.size, files: c.files, cats: c.cats })),
      }));
    },
    insights: p => {
      const n = node(p), groups = { dev: [], cache: [], recycle: [], downloads: [] }, big = [], inst = [];
      const DEV = ['node_modules', '__pycache__', '.venv', 'venv', '.gradle', '.next'], CACHE = ['temp', 'tmp', 'cache', '.cache', 'npm-cache', 'pip', 'inetcache'];
      const st = [n];
      while (st.length) {
        const x = st.pop(), low = x.name.toLowerCase();
        if (x !== n && DEV.includes(low)) { groups.dev.push(x); continue; }
        if (x !== n && CACHE.includes(low)) { groups.cache.push(x); continue; }
        if (low === '$recycle.bin') { groups.recycle.push(x); continue; }
        if (low === 'downloads') groups.downloads.push(x);
        for (const [s, nm] of x.top) { if (s >= GB) big.push({ name: nm, path: join(x.path, nm), size: s, kind: 'file' }); if (s > 100 * 1024 ** 2 && /\.(exe|msi|iso|zip|rar|7z)$/i.test(nm) && /download/i.test(x.path)) inst.push({ name: nm, path: join(x.path, nm), size: s, kind: 'file' }); }
        st.push(...x.children);
      }
      const fold = l => l.sort((a, b) => b.size - a.size).map(c => ({ name: c.name, path: c.path, size: c.size, kind: 'dir' }));
      const sum = l => l.reduce((s, c) => s + c.size, 0);
      const cards = [];
      if (groups.dev.length) cards.push({ lvl: 'warn', title: 'Dev dependencies & build caches', size: sum(groups.dev), items: fold(groups.dev).slice(0, 8), text: `${groups.dev.length} folders like node_modules, .venv and __pycache__ can be regenerated.` });
      if (groups.cache.length) cards.push({ lvl: 'warn', title: 'Temp & cache folders', size: sum(groups.cache), items: fold(groups.cache).slice(0, 8), text: `${groups.cache.length} temp/cache folders are usually safe to clear.` });
      if (groups.recycle.length) cards.push({ lvl: 'crit', title: 'Recycle Bin', size: sum(groups.recycle), items: fold(groups.recycle), text: 'Deleted files still taking space.' });
      if (groups.downloads.length) cards.push({ lvl: 'info', title: 'Downloads', size: sum(groups.downloads), items: fold(groups.downloads), text: 'Your downloads folder often hides forgotten installers and videos.' });
      if (big.length) cards.push({ lvl: 'info', title: 'Huge files (1 GB+)', size: sum(big), items: big.sort((a, b) => b.size - a.size).slice(0, 8), text: `${big.length} files over 1 GB.` });
      if (inst.length) cards.push({ lvl: 'warn', title: 'Old installers & archives', size: sum(inst), items: inst.slice(0, 8), text: 'Setup files and archives in Downloads you probably no longer need.' });
      if (n.stale) cards.push({ lvl: 'info', title: 'Untouched for a year', size: n.stale, items: [], text: `${Math.round(pct(n.stale, n.size))}% of this folder hasn't been modified in 12+ months. Consider archiving.` });
      return sleep(200).then(() => cards.sort((a, b) => b.size - a.size));
    },
    search: (q, p) => {
      q = q.trim().toLowerCase(); const out = [], ext = q.startsWith('.') ? q : null;
      for (const x of sub(node(p))) {
        if (!ext && x.name.toLowerCase().includes(q) && x !== node(p)) out.push({ name: x.name, path: x.path, size: x.size, kind: 'dir' });
        for (const [s, nm] of x.top) if (ext ? nm.toLowerCase().endsWith(ext) : nm.toLowerCase().includes(q)) out.push({ name: nm, path: join(x.path, nm), size: s, kind: 'file' });
      }
      return Promise.resolve(out.sort((a, b) => b.size - a.size).slice(0, 24));
    },
    recycle: p => {
      const n = node(p);
      let size, parent;
      if (n && n.parent) { parent = n.parent; parent.children.splice(parent.children.indexOf(n), 1); size = n.size; }
      else { const i = p.lastIndexOf('\\'); parent = node(p.slice(0, i) || 'C:\\'); const k = parent.top.findIndex(t => t[1] === p.slice(i + 1)); if (k < 0) return Promise.resolve({ ok: false, error: 'not found' }); size = parent.top[k][0]; parent.top.splice(k, 1); }
      for (let x = parent; x; x = x.parent) x.size -= size;
      return sleep(300).then(() => ({ ok: true }));
    },
    open_folder: p => toast('Would open ' + p + ' in Explorer'),
    reveal: p => toast('Would reveal ' + p + ' in Explorer'),
  };
})();

/* =========================================================
   Graph engine
   ========================================================= */
const G = {
  cv: $('#gv'), fx: $('#fx'), ctx: null, fctx: null, w: 0, h: 0, dpr: 1,
  cam: { x: 0, y: 0, z: 0.35 }, camT: { x: 0, y: 0, z: 1 }, savedCam: null,
  nodes: [], edges: [], byId: new Map(), arcs: [], ring: [], dust: [], sparks: [], t: 0, buildT: 0, last: 0,
  hover: null, hoverArc: null, drag: null, focusT: 0, pulses: [],
};
G.ctx = G.cv.getContext('2d');
G.fctx = G.fx.getContext('2d');
const SX = x => (x - G.cam.x) * G.cam.z + G.w / 2;
const SY = y => (y - G.cam.y) * G.cam.z + G.h * 0.47;

function resize() {
  G.dpr = Math.min(window.devicePixelRatio || 1, 2);
  G.w = innerWidth; G.h = innerHeight;
  for (const c of [G.cv, G.fx]) { c.width = G.w * G.dpr; c.height = G.h * G.dpr; }
  if (S.focus) layoutFocus();
}
addEventListener('resize', resize);
resize();
G.dust = Array.from({ length: 170 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.3 + 0.2, s: Math.random() * 0.6 + 0.2, a: Math.random() * 0.5 + 0.1, p: Math.random() * TAU }));

const ORDER = { file: 0, sub: 1, other: 2, dir: 3, drive: 3, hub: 4 };
const beamEdge = (a, b, k = 1) => ({ a, b, kind: 'beam', k, parts: [Math.random(), Math.random() * 0.5 + 0.5].slice(0, 1 + (Math.random() > 0.4)) });

function startBuild(fresh) {
  const prev = fresh ? new Map() : G.byId, nodes = [], edges = [];
  const add = (id, o, parent) => {
    const p = prev.get(id), par = parent || { x: 0, y: 0 };
    const n = Object.assign({ id, x: p ? p.x : par.x, y: p ? p.y : par.y, tx: 0, ty: 0, r: 6, appear: p ? p.appear : 0, delay: 0, h: 0 }, o);
    nodes.push(n);
    return n;
  };
  return { nodes, edges, add };
}
function finishBuild(b, fit) {
  G.nodes = b.nodes.sort((a, c) => ORDER[a.type] - ORDER[c.type]);
  G.edges = b.edges;
  G.byId = new Map(b.nodes.map(n => [n.id, n]));
  G.buildT = G.t;
  if (fit) fitView();
}

function buildDrives() {
  const b = startBuild(true), D = S.drives;
  const total = D.reduce((s, d) => s + d.total, 0), maxT = Math.max(1, ...D.map(d => d.total));
  const hub = b.add('pc', { type: 'hub', r: 34, label: 'This PC', badge: fmt(total), pal: PAL.hub });
  const list = [...D.map(d => ({ ...d, kind: 'drive' })), ...(S.home ? [{ path: S.home, label: 'Home folder', kind: 'home' }] : [])];
  list.forEach((d, i) => {
    const a = -Math.PI / 2 + ((i + 0.5) / list.length) * TAU + 0.35, R = 270;
    const used = d.total ? d.used / d.total : 0;
    const pal = d.kind === 'home' ? CAT.docs : used > 0.9 ? PAL.crit : used > 0.75 ? PAL.warn : PAL.ok;
    const letter = d.kind === 'home' ? '~' : d.path.replace(/[\\/]+$/, '');
    const n = b.add('drv:' + d.path, {
      type: 'drive', data: d, used, pal, r: d.kind === 'home' ? 15 : 17 + 16 * Math.sqrt(d.total / maxT),
      label: d.kind === 'home' ? 'Home folder' : `${letter}  ${d.label}`, badge: d.kind === 'home' ? 'quick scan' : `${fmt(d.free)} free`, delay: 0.3 + i * 0.1,
    }, hub);
    n.tx = Math.cos(a) * R * 1.45; n.ty = Math.sin(a) * R;
    b.edges.push(beamEdge(hub, n, 1));
  });
  G.ring = [];
  G.arcs = [];
  finishBuild(b, true);
}

function buildScanning(name) {
  const b = startBuild(true);
  const hub = b.add('scan', { type: 'hub', r: 40, label: '', badge: '', pal: PAL.hub, appear: 1 });
  hub.scan = true;
  G.ring = []; G.arcs = [];
  finishBuild(b, false);
  G.camT = { x: 0, y: 30, z: 1.1 };
}

function buildTree(fresh = false, fit = true) {
  const d = S.tree, b = startBuild(fresh), total = d.size || 1;
  const hub = b.add('hub:' + d.path, { type: 'hub', r: 36, label: d.name, badge: fmt(d.size), pal: PAL.hub, data: d });
  const kids = d.children.filter(c => !S.hidden.has(domCat(c.cats)));
  const N = kids.length + (d.other.count ? 1 : 0), R = Math.max(290, 130 + N * 24);
  kids.forEach((c, i) => {
    const share = c.size / total, a = -Math.PI / 2 + ((i + 0.5) / N) * TAU;
    const rr = R * (i % 2 ? 0.72 : 1) + (hash(c.path) - 0.5) * 50;
    const n = b.add('d:' + c.path, { type: 'dir', data: c, r: 10 + 34 * Math.sqrt(share), label: c.name, badge: fmt(c.size), pal: CAT[domCat(c.cats)], share, delay: 0.2 + i * 0.04 }, hub);
    n.tx = Math.cos(a) * rr * 1.5; n.ty = Math.sin(a) * rr;
    b.edges.push(beamEdge(hub, n, 0.4 + 1.5 * Math.sqrt(share)));
    const sat = (id, o, ang, dist) => {
      const s = b.add(id, Object.assign({ delay: n.delay + 0.3 + Math.random() * 0.25, parentNode: n }, o), n);
      s.tx = n.tx + Math.cos(ang) * dist; s.ty = n.ty + Math.sin(ang) * dist;
      b.edges.push({ a: n, b: s, kind: 'dash' });
    };
    const gk = c.children || [];
    gk.forEach((g, k) => sat('d:' + g.path, { type: 'sub', data: g, r: 4 + 10 * Math.sqrt(g.size / (c.size || 1)), pal: CAT[domCat(g.cats)], label: g.name }, a + (k - (gk.length - 1) / 2) * 0.42, n.r + 74 + k * 8));
    (c.top_files || []).filter(f => !S.hidden.has(catOfName(f.name))).forEach((f, k) =>
      sat('f:' + f.path, { type: 'file', data: f, r: 3.5 + 5 * Math.sqrt(f.size / (c.size || 1)), pal: CAT[catOfName(f.name)], label: f.name, tag: fmtShort(f.size) }, a - 1.2 + k * 0.55, n.r + 46));
  });
  if (d.other.count) {
    const a = -Math.PI / 2 + ((N - 0.5) / N) * TAU, n = b.add('other:' + d.path, { type: 'other', r: 10 + 20 * Math.sqrt(d.other.size / total), label: `+${d.other.count} more`, badge: fmt(d.other.size), pal: CAT.other, delay: 0.25 + N * 0.04 }, hub);
    n.tx = Math.cos(a) * R * 0.86 * 1.5; n.ty = Math.sin(a) * R * 0.86;
    b.edges.push(beamEdge(hub, n, 0.4));
  }
  (d.top_files || []).filter(f => !S.hidden.has(catOfName(f.name))).forEach((f, i, arr) => {
    const a = (i / arr.length) * TAU + 0.5, dist = 105 + (i % 2) * 26;
    const s = b.add('f:' + f.path, { type: 'file', data: f, r: 3.5 + 6 * Math.sqrt(f.size / total), pal: CAT[catOfName(f.name)], label: f.name, tag: fmtShort(f.size), delay: 0.5 + i * 0.05 }, hub);
    s.tx = Math.cos(a) * dist * 1.2; s.ty = Math.sin(a) * dist;
    b.edges.push({ a: hub, b: s, kind: 'dash' });
  });

  // storage ring + sunburst arcs
  const filesBytes = Math.max(0, d.size - d.children.reduce((s, c) => s + c.size, 0) - d.other.size);
  G.ring = [...d.children.map(c => ({ frac: c.size / total, pal: CAT[domCat(c.cats)], id: 'd:' + c.path })),
    ...(d.other.size ? [{ frac: d.other.size / total, pal: CAT.other, id: 'other:' + d.path }] : []),
    ...(filesBytes ? [{ frac: filesBytes / total, pal: CAT[domCat(d.cats)], id: 'files', files: true }] : [])];
  G.arcs = [];
  let a0 = -Math.PI / 2;
  for (const c of d.children) {
    const span = (c.size / total) * TAU, l1 = { a0, a1: a0 + span, level: 1, data: c, pal: CAT[domCat(c.cats)] };
    G.arcs.push(l1);
    let b0 = a0;
    for (const g of c.children || []) { const s2 = (g.size / total) * TAU; G.arcs.push({ a0: b0, a1: b0 + s2, level: 2, data: g, pal: CAT[domCat(g.cats)], parent: c }); b0 += s2; }
    a0 += span;
  }
  if (d.other.size) G.arcs.push({ a0, a1: a0 + (d.other.size / total) * TAU, level: 1, data: { name: `${d.other.count} smaller folders`, size: d.other.size }, pal: CAT.other, other: true });
  finishBuild(b, fit);
}

function fitView() {
  if (!G.nodes.length) return;
  if (S.mode === 'rings' && S.view === 'tree') { G.camT = { x: 0, y: 20, z: clamp(Math.min(G.w - 200, G.h - 300) / 620, 0.5, 1.6) }; return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of G.nodes) { x0 = Math.min(x0, n.tx); y0 = Math.min(y0, n.ty); x1 = Math.max(x1, n.tx); y1 = Math.max(y1, n.ty); }
  const bw = x1 - x0 + 300, bh = y1 - y0 + 170;
  const z = clamp(Math.min((G.w - 60) / bw, (G.h - 270) / bh), 0.3, 1.35);
  G.camT = { x: (x0 + x1) / 2 + 40, y: (y0 + y1) / 2 + 25, z };
}

/* ---------- drawing primitives ---------- */
function orb(c, x, y, r, pal, o = {}) {
  const glow = o.glow ?? 1;
  c.globalCompositeOperation = 'lighter';
  let g = c.createRadialGradient(x, y, r * 0.4, x, y, r * 3.4);
  g.addColorStop(0, `rgba(${pal.rgb},${0.32 * glow})`); g.addColorStop(0.4, `rgba(${pal.rgb},${0.09 * glow})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 3.4, 0, TAU); c.fill();
  c.globalCompositeOperation = 'source-over';
  if (o.rings) for (const [k, al] of [[1.3, 0.55], [1.52, 0.32], [1.74, 0.16]]) {
    c.strokeStyle = `rgba(${pal.rgb},${al * glow})`; c.lineWidth = Math.max(0.8, r * 0.07);
    c.beginPath(); c.arc(x, y, r * k, 0, TAU); c.stroke();
  }
  c.fillStyle = 'rgba(6,12,12,.75)'; c.beginPath(); c.arc(x, y, r * 1.12, 0, TAU); c.fill();
  g = c.createRadialGradient(x - r * 0.35, y - r * 0.42, r * 0.04, x, y, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.22, pal.core); g.addColorStop(0.78, pal.deep); g.addColorStop(1, 'rgba(10,6,14,1)');
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  c.strokeStyle = `rgba(${pal.rgb},.75)`; c.lineWidth = Math.max(0.6, r * 0.06);
  c.beginPath(); c.arc(x, y, r * 0.93, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
  c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.ellipse(x - r * 0.33, y - r * 0.45, r * 0.28, r * 0.16, -0.6, 0, TAU); c.fill();
}
const wave = (i, t, f = 1) => 0.5 + 0.5 * Math.sin(i * 0.61 * f + t * 2.1) * Math.sin(i * 0.23 * f - t * 1.3 + 1.7) * Math.cos(i * 0.11 + t * 0.7);
function spikes(c, x, y, r0, len, count, t, rgb, alpha, lw = 1) {
  c.globalCompositeOperation = 'lighter';
  c.strokeStyle = `rgba(${rgb},${alpha})`; c.lineWidth = lw;
  c.beginPath();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU, l = len * (0.25 + 0.75 * wave(i, t));
    c.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); c.lineTo(x + Math.cos(a) * (r0 + l), y + Math.sin(a) * (r0 + l));
  }
  c.stroke();
  c.globalCompositeOperation = 'source-over';
}
function waveRing(c, x, y, r0, amp, t, rgb, alpha, lw = 1, f = 1) {
  c.globalCompositeOperation = 'lighter';
  c.strokeStyle = `rgba(${rgb},${alpha})`; c.lineWidth = lw;
  c.beginPath();
  for (let i = 0; i <= 220; i++) {
    const a = (i / 220) * TAU, rr = r0 + amp * (wave(i * 1.7, t, f) - 0.5) * 2 + amp * 0.4 * Math.sin(i * 1.9 + t * 6);
    i ? c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.stroke();
  c.globalCompositeOperation = 'source-over';
}
function taper(c, ax, ay, bx, by, w0, w1, rgb, al, mid = 0.28) {
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  const g = c.createLinearGradient(ax, ay, bx, by);
  g.addColorStop(0, `rgba(${rgb},${al})`); g.addColorStop(0.55, `rgba(${rgb},${al * mid})`); g.addColorStop(1, `rgba(${rgb},${al * 0.75})`);
  c.fillStyle = g;
  c.beginPath(); c.moveTo(ax + nx * w0, ay + ny * w0); c.lineTo(bx + nx * w1, by + ny * w1); c.lineTo(bx - nx * w1, by - ny * w1); c.lineTo(ax - nx * w0, ay - ny * w0); c.closePath(); c.fill();
}
let COND = '"Roboto Condensed","Bahnschrift SemiCondensed","Bahnschrift","Arial Narrow",sans-serif';
function badge(c, x, y, text, fs, gold) {
  c.font = `600 ${fs}px ${COND}`;
  const tw = c.measureText(text).width, h = fs * 1.35, w = tw + fs * 0.9, sk = h * 0.28;
  c.fillStyle = 'rgba(78,88,88,.82)';
  c.beginPath(); c.moveTo(x + sk, y); c.lineTo(x + w + sk, y); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath(); c.fill();
  c.fillStyle = gold ? '#f0cf98' : '#eef3f2'; c.textBaseline = 'middle';
  c.fillText(text, x + fs * 0.5, y + h / 2 + 0.5);
}
function label(c, x, y, text, fs, alpha = 1) {
  c.font = `500 ${fs}px ${COND}`; c.textBaseline = 'alphabetic';
  c.shadowColor = 'rgba(0,0,0,.9)'; c.shadowBlur = 10;
  c.fillStyle = `rgba(240,245,244,${alpha})`; c.fillText(text, x, y);
  c.shadowBlur = 0;
}
function arcRing(c, x, y, r, a0, a1, rgb, al, lw) {
  c.globalCompositeOperation = 'lighter';
  c.strokeStyle = `rgba(${rgb},${al * 0.18})`; c.lineWidth = lw * 3.2; c.beginPath(); c.arc(x, y, r, a0, a1); c.stroke();
  c.strokeStyle = `rgba(${rgb},${al})`; c.lineWidth = lw; c.beginPath(); c.arc(x, y, r, a0, a1); c.stroke();
  c.globalCompositeOperation = 'source-over';
}

/* ---------- frame ---------- */
const nodeName = n => (n.data?.name || n.label || '').toLowerCase();
function isActive(n) {
  const h = G.hover;
  if (h && (h.type === 'dir' || h.type === 'sub' || h.type === 'file') && n.type !== 'hub') {
    const root = h.parentNode || h;
    return n === root || n.parentNode === root;
  }
  if (S.query && n.type !== 'hub') return nodeName(n).includes(S.query.toLowerCase()) || (n.parentNode && nodeName(n.parentNode).includes(S.query.toLowerCase()));
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

function drawBackground(c, dt) {
  const { w, h, t } = G, z = G.cam.z;
  c.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  c.globalAlpha = 1;
  c.fillStyle = '#020505'; c.fillRect(0, 0, w, h);
  const g = c.createRadialGradient(w * 0.5, h * 0.36, 0, w * 0.5, h * 0.45, Math.max(w, h) * 0.78);
  g.addColorStop(0, '#22413d'); g.addColorStop(0.35, '#10231f'); g.addColorStop(0.7, '#050c0b'); g.addColorStop(1, '#010303');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'lighter';
  for (const d of G.dust) {
    d.y -= d.s * dt * 0.006; if (d.y < 0) d.y += 1;
    const px = (((d.x * w - G.cam.x * z * 0.06 * d.s) % w) + w) % w, py = (((d.y * h - G.cam.y * z * 0.06 * d.s) % h) + h) % h;
    c.fillStyle = `rgba(170,240,225,${d.a * (0.6 + 0.4 * Math.sin(t * 1.5 + d.p))})`;
    c.beginPath(); c.arc(px, py, d.r, 0, TAU); c.fill();
  }
  c.globalCompositeOperation = 'source-over';
}

function drawGraph(dt) {
  const c = G.ctx, { w, h, t } = G, z = G.cam.z;
  drawBackground(c, dt);
  const A = 1 - G.focusT;
  if (A < 0.01) return;
  c.globalAlpha = A;
  if (S.view === 'scanning') drawScanFx(c, dt, A);
  if (S.view === 'tree' && S.mode === 'rings') { drawSunburst(c, A); return; }

  const act = new Map(G.nodes.map(n => [n, isActive(n)]));
  const dimA = n => (act.get(n) ? 1 : 0.15);

  // beams + comets
  c.globalCompositeOperation = 'lighter';
  for (const e of G.edges) if (e.kind === 'beam') {
    const p = ease(Math.min(e.a.appear, e.b.appear));
    if (p <= 0) continue;
    const al = A * Math.min(dimA(e.a), dimA(e.b));
    let ax = SX(e.a.x), ay = SY(e.a.y);
    const bx = SX(e.b.x), by = SY(e.b.y);
    const L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L;
    const ra = e.a.r * z * 1.3 + (e.a.type === 'hub' && G.ring.length ? 30 : 0), rb = Math.max(9, e.b.r * z) * 1.25;
    ax += ux * ra; ay += uy * ra;
    const ex = lerp(ax, bx - ux * rb, p), ey = lerp(ay, by - uy * rb, p);
    const hl = G.hover && (G.hover === e.b || G.hover.parentNode === e.b) ? 1.6 : 1;
    const w0 = Math.max(1.4, 4.4 * z * e.k), rgb = e.b.pal?.rgb && e.b.type !== 'drive' ? e.b.pal.rgb : '255,200,135';
    taper(c, ax, ay, ex, ey, w0 * 5, w0 * 1.6, rgb, 0.07 * al * hl, 0.15);
    taper(c, ax, ay, ex, ey, w0 * 2.2, w0 * 0.5, rgb, 0.16 * al * hl, 0.2);
    taper(c, ax, ay, ex, ey, w0 * 0.7, 0.5, '255,226,180', 0.55 * al * hl, 0.22);
    taper(c, ax, ay, ex, ey, w0 * 0.22, 0.2, '255,255,255', 0.5 * al * hl, 0.2);
    if (p >= 1) for (let i = 0; i < e.parts.length; i++) {
      e.parts[i] = (e.parts[i] + dt * (90 / L) * (0.6 + 0.4 * e.k)) % 1;
      const q = e.parts[i], hx = lerp(ax, ex, q), hy = lerp(ay, ey, q);   // outward: data flowing to folders
      const tl = Math.min(46, L * 0.25), tx = hx - ux * tl, ty = hy - uy * tl, fade = Math.sin(q * Math.PI);
      const gg = c.createLinearGradient(hx, hy, tx, ty);
      gg.addColorStop(0, `rgba(255,250,235,${0.95 * fade * al})`); gg.addColorStop(1, `rgba(${rgb},0)`);
      c.strokeStyle = gg; c.lineWidth = Math.max(1.4, 2.4 * z); c.lineCap = 'round';
      c.beginPath(); c.moveTo(hx, hy); c.lineTo(tx, ty); c.stroke();
      const rg = c.createRadialGradient(hx, hy, 0, hx, hy, 9);
      rg.addColorStop(0, `rgba(255,245,220,${0.7 * fade * al})`); rg.addColorStop(1, 'rgba(255,220,170,0)');
      c.fillStyle = rg; c.beginPath(); c.arc(hx, hy, 9, 0, TAU); c.fill();
    }
  }
  c.globalCompositeOperation = 'source-over';

  c.setLineDash([2, 4]);
  for (const e of G.edges) if (e.kind === 'dash') {
    const p = ease(e.b.appear);
    if (p <= 0) continue;
    c.strokeStyle = `rgba(230,240,238,${0.4 * A * dimA(e.b) * p})`; c.lineWidth = 1;
    c.beginPath(); c.moveTo(SX(e.a.x), SY(e.a.y)); c.lineTo(SX(lerp(e.a.x, e.b.x, p)), SY(lerp(e.a.y, e.b.y, p))); c.stroke();
  }
  c.setLineDash([]);

  for (const sp of G.pulses) {
    sp.t += dt;
    if (sp.t <= 0) continue;
    c.strokeStyle = `rgba(240,205,150,${0.45 * Math.max(0, 1 - sp.t / 1.6) * A})`; c.lineWidth = 2;
    c.beginPath(); c.arc(SX(0), SY(0), sp.t * 520 * z, 0, TAU); c.stroke();
  }
  G.pulses = G.pulses.filter(s => s.t < 1.6);

  for (const n of G.nodes) {
    if (n.appear <= 0) continue;
    const ap = ease(n.appear), al = A * ap * dimA(n);
    const x = SX(n.x), y = SY(n.y);
    const minR = { hub: 24, drive: 16, dir: 10, other: 9, sub: 5, file: 3 }[n.type];
    const r = Math.max(minR, n.r * z) * (0.5 + 0.5 * ap) * (1 + 0.22 * n.h);
    if (x < -140 || x > w + 140 || y < -140 || y > h + 140) continue;
    c.globalAlpha = al;
    if (n.type === 'hub') {
      if (G.ring.length) drawStorageRing(c, x, y, r * 2.15, ap, al);
      spikes(c, x, y, r * 1.18, r * (n.scan ? 0.9 : 0.55), 140, t * (n.scan ? 2.5 : 1), '255,215,160', 0.55, 1);
      spikes(c, x, y, r * 1.05, r * 0.3, 90, -t * 1.3, '120,230,210', 0.4, 1);
      if (!G.ring.length) waveRing(c, x, y, r * 1.85, r * 0.08, t, '255,210,150', 0.35, 1);
      orb(c, x, y, r, n.pal, { glow: 1.3 + (n.scan ? 0.5 * Math.sin(t * 6) : 0) });
      if (n.label) {
        const lx = x + (G.ring.length ? r * 2.15 + 26 : r * 2 + 6);
        label(c, lx, y - 2, trunc(n.label, 28), clamp(20 * Math.sqrt(z), 17, 26), al);
        badge(c, lx, y + 7, n.badge, clamp(12 * Math.sqrt(z), 11, 15), true);
      }
    } else if (n.type === 'drive') {
      c.strokeStyle = `rgba(255,255,255,${0.1 * al})`; c.lineWidth = 3; c.beginPath(); c.arc(x, y, r * 1.95, 0, TAU); c.stroke();
      if (n.data.total) arcRing(c, x, y, r * 1.95, -Math.PI / 2, -Math.PI / 2 + TAU * n.used * ap, n.pal.rgb, al, 3);
      orb(c, x, y, r, n.pal, { glow: 1 + n.h * 0.8 });
      const fs = clamp(17 * Math.sqrt(z), 15, 22);
      label(c, x + r * 2.3 + 8, y - 2, n.label, fs, al);
      badge(c, x + r * 2.3 + 8, y + 6, n.badge, fs * 0.66, n.data.kind === 'home');
      if (n.data.total) { c.font = `500 ${fs * 0.62}px ${COND}`; c.fillStyle = `rgba(160,180,176,${al})`; c.fillText(`${Math.round(n.used * 100)}% used of ${fmt(n.data.total)}`, x + r * 2.3 + 8, y + fs * 1.75); }
    } else if (n.type === 'dir' || n.type === 'other') {
      if (n.share > 0.2) {
        const ph = (t * 0.5 + hash(n.id)) % 1;
        c.strokeStyle = `rgba(${n.pal.rgb},${0.45 * (1 - ph) * al})`; c.lineWidth = 1.2;
        c.beginPath(); c.arc(x, y, r * (1.6 + ph * 2.2), 0, TAU); c.stroke();
      }
      orb(c, x, y, r, n.pal, { rings: n.type === 'dir', glow: 1 + n.h * 0.8 });
      const fs = clamp(16 * Math.sqrt(z), 13.5, 22);
      label(c, x + r * 1.9 + 6, y - 1, trunc(n.label, 24), fs, al);
      badge(c, x + r * 1.9 + 6, y + 5, n.badge, fs * 0.66);
    } else if (n.type === 'sub') {
      orb(c, x, y, r, n.pal, { rings: true, glow: 0.8 + n.h });
      if (n.h > 0.05 || z > 1.25) { c.globalAlpha = al * Math.max(n.h, z > 1.25 ? 0.75 : 0); label(c, x + r * 1.8 + 3, y + 4, trunc(n.label, 24), clamp(11.5 * Math.sqrt(z), 10.5, 14)); }
    } else {
      orb(c, x, y, r, n.pal, { glow: 0.9 + n.h });
      c.font = `600 ${clamp(10 * Math.sqrt(z), 9, 13)}px ${COND}`; c.textBaseline = 'alphabetic';
      const tw = c.measureText(n.tag).width, bx = x + r + 2, by = y - r - 13;
      c.fillStyle = '#0b1212'; c.globalAlpha = al * 0.85; c.beginPath(); c.roundRect(bx - 3, by - 1, tw + 6, 14, 3); c.fill();
      c.globalAlpha = al; c.fillStyle = n.pal.css; c.fillText(n.tag, bx, by + 10);
    }
  }
  c.globalAlpha = 1;
}

function drawStorageRing(c, x, y, R, ap, al) {
  const grow = ease(clamp((G.t - G.buildT - 0.1) / 1.3, 0, 1)), gap = 0.012, total = TAU * grow;
  c.strokeStyle = `rgba(255,255,255,${0.06 * al})`; c.lineWidth = 6; c.beginPath(); c.arc(x, y, R, 0, TAU); c.stroke();
  let a = -Math.PI / 2;
  for (const s of G.ring) {
    const span = s.frac * total;
    if (span > gap * 1.5) {
      const hov = G.hover && (G.hover.id === s.id || G.hover.parentNode?.id === s.id);
      arcRing(c, x, y, R + (hov ? 4 : 0), a + gap / 2, a + span - gap / 2, s.pal.rgb, al * (hov ? 1 : 0.8), hov ? 7 : 5);
    }
    a += span;
  }
  c.strokeStyle = `rgba(232,195,138,${0.25 * al})`; c.lineWidth = 1;
  c.beginPath(); c.arc(x, y, R + 12, 0, TAU); c.stroke();
  const tick = -Math.PI / 2 + (G.t * 0.35) % TAU;
  c.fillStyle = `rgba(255,230,190,${0.9 * al})`; c.beginPath(); c.arc(x + Math.cos(tick) * (R + 12), y + Math.sin(tick) * (R + 12), 2.2, 0, TAU); c.fill();
}

function drawScanFx(c, dt, A) {
  const x = SX(0), y = SY(0), z = G.cam.z, t = G.t, R = Math.max(G.w, G.h) * 0.42;
  // radar sweep
  const ang = (t * 1.6) % TAU;
  const cg = c.createConicGradient(ang, x, y);
  cg.addColorStop(0, 'rgba(232,195,138,.22)'); cg.addColorStop(0.08, 'rgba(232,195,138,0)'); cg.addColorStop(1, 'rgba(232,195,138,0)');
  c.fillStyle = cg; c.beginPath(); c.arc(x, y, R, 0, TAU); c.fill();
  for (let i = 1; i <= 4; i++) {
    c.strokeStyle = `rgba(140,220,205,${0.06 + 0.04 * Math.sin(t * 2 - i)})`; c.lineWidth = 1;
    c.beginPath(); c.arc(x, y, (R / 4) * i, 0, TAU); c.stroke();
  }
  // data sparks flying into the core
  if (G.sparks.length < 90) for (let k = 0; k < 3; k++) {
    const a = Math.random() * TAU, cat = CAT[CAT_ORDER[Math.floor(Math.random() * CAT_ORDER.length)]];
    G.sparks.push({ a, d: R * (0.7 + Math.random() * 0.4), v: 120 + Math.random() * 260, rgb: cat.rgb });
  }
  c.globalCompositeOperation = 'lighter';
  for (const s of G.sparks) {
    s.d -= s.v * dt * (1 + (R - s.d) / R);
    const hx = x + Math.cos(s.a) * s.d, hy = y + Math.sin(s.a) * s.d, tx = x + Math.cos(s.a) * (s.d + 30), ty = y + Math.sin(s.a) * (s.d + 30);
    const g = c.createLinearGradient(hx, hy, tx, ty);
    g.addColorStop(0, `rgba(${s.rgb},${0.9 * A})`); g.addColorStop(1, `rgba(${s.rgb},0)`);
    c.strokeStyle = g; c.lineWidth = 2; c.beginPath(); c.moveTo(hx, hy); c.lineTo(tx, ty); c.stroke();
  }
  c.globalCompositeOperation = 'source-over';
  G.sparks = G.sparks.filter(s => s.d > 50 * z);
}

function drawSunburst(c, A) {
  const x = SX(0), y = SY(0), z = G.cam.z, d = S.tree;
  const p = ease(clamp((G.t - G.buildT) / 1.2, 0, 1));
  const R = { r0: 92 * z, r1: 190 * z, r2: 200 * z, r3: 270 * z };
  const start = -Math.PI / 2, sweep = a => start + (a - start) * p;
  c.globalCompositeOperation = 'lighter';
  let g = c.createRadialGradient(x, y, R.r0, x, y, R.r3 * 1.3);
  g.addColorStop(0, 'rgba(232,195,138,.06)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.beginPath(); c.arc(x, y, R.r3 * 1.3, 0, TAU); c.fill();
  c.globalCompositeOperation = 'source-over';
  for (const a of G.arcs) {
    const a0 = sweep(a.a0), a1 = sweep(a.a1);
    if (a1 - a0 < 0.004) continue;
    const hov = G.hoverArc === a || (G.hoverArc && G.hoverArc.level === 1 && a.parent === G.hoverArc.data);
    const hidden = !a.other && S.hidden.has(domCat(a.data.cats));
    const [ri, ro] = a.level === 1 ? [R.r0, R.r1] : [R.r2, R.r3];
    const push = hov ? 6 * z : 0, gap = Math.min(0.012, (a1 - a0) * 0.2);
    c.beginPath(); c.arc(x, y, ro + push, a0 + gap, a1 - gap); c.arc(x, y, ri + push, a1 - gap, a0 + gap, true); c.closePath();
    g = c.createRadialGradient(x, y, ri, x, y, ro + push);
    g.addColorStop(0, `rgba(${a.pal.rgb},${(hidden ? 0.05 : a.level === 1 ? 0.5 : 0.32) * A})`);
    g.addColorStop(1, `rgba(${a.pal.rgb},${(hidden ? 0.08 : hov ? 0.95 : a.level === 1 ? 0.78 : 0.55) * A})`);
    c.fillStyle = g; c.fill();
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = `rgba(${a.pal.rgb},${(hov ? 0.9 : 0.45) * A})`; c.lineWidth = hov ? 2 : 1; c.stroke();
    c.globalCompositeOperation = 'source-over';
  }
  // labels for big first-level arcs
  if (p > 0.9) {
    c.globalAlpha = A * clamp((p - 0.9) * 10, 0, 1);
    const fs = clamp(14 * Math.sqrt(z), 12, 18);
    c.textAlign = 'center';
    for (const a of G.arcs) {
      if (a.level !== 1 || a.a1 - a.a0 < 0.22) continue;
      const m = (a.a0 + a.a1) / 2, rm = (R.r0 + R.r1) / 2;
      label(c, x + Math.cos(m) * rm, y + Math.sin(m) * rm + 2, trunc(a.data.name, 14), fs * 0.9);
      c.font = `600 ${fs * 0.66}px ${COND}`; c.fillStyle = 'rgba(255,240,215,.9)';
      c.fillText(fmt(a.data.size), x + Math.cos(m) * rm, y + Math.sin(m) * rm + fs * 0.95);
    }
    c.textAlign = 'left';
    for (const a of G.arcs) {
      if (a.level !== 2 || a.a1 - a.a0 < 0.16) continue;
      const m = (a.a0 + a.a1) / 2, cx = Math.cos(m), cy = Math.sin(m);
      const px = x + cx * (R.r3 + 14 * z), py = y + cy * (R.r3 + 14 * z), ex = px + (cx >= 0 ? 26 : -26);
      c.strokeStyle = 'rgba(230,240,238,.45)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x + cx * R.r3, y + cy * R.r3); c.lineTo(px, py); c.lineTo(ex, py); c.stroke();
      c.fillStyle = a.pal.css; c.beginPath(); c.arc(ex, py, 2.5, 0, TAU); c.fill();
      c.textAlign = cx >= 0 ? 'left' : 'right';
      label(c, ex + (cx >= 0 ? 8 : -8), py - 1, trunc(a.data.name, 22), fs);
      c.font = `600 ${fs * 0.72}px ${COND}`; c.fillStyle = 'rgba(200,215,212,.85)';
      c.fillText(`${fmt(a.data.size)} · ${pctTxt(a.data.size, d.size)}`, ex + (cx >= 0 ? 8 : -8), py + fs * 0.95);
      c.textAlign = 'left';
    }
    c.globalAlpha = A;
  }
  // core
  spikes(c, x, y, R.r0 * 0.62, R.r0 * 0.2, 120, G.t, '255,215,160', 0.45, 1);
  orb(c, x, y, R.r0 * 0.45, PAL.hub, { glow: 1.1 });
  c.textAlign = 'center';
  label(c, x, y + R.r0 * 0.45 + 22, trunc(d.name, 20), clamp(15 * Math.sqrt(z), 13, 20));
  c.font = `600 ${clamp(12 * Math.sqrt(z), 11, 15)}px ${COND}`; c.fillStyle = '#f0cf98'; c.fillText(fmt(d.size), x, y + R.r0 * 0.45 + 40);
  c.textAlign = 'left';
}

/* ---------- interaction ---------- */
function pick(mx, my) {
  if (S.view === 'tree' && S.mode === 'rings') return null;
  let best = null, bd = Infinity;
  for (const n of G.nodes) {
    if (n.appear < 0.5 || n.scan) continue;
    const d = Math.hypot(SX(n.x) - mx, SY(n.y) - my), r = Math.max({ hub: 22, drive: 20, dir: 14, other: 12, sub: 9, file: 7 }[n.type], n.r * G.cam.z * 1.6);
    if (d < r && d < bd) { bd = d; best = n; }
  }
  return best;
}
function pickArc(mx, my) {
  if (!(S.view === 'tree' && S.mode === 'rings')) return null;
  const z = G.cam.z, dx = mx - SX(0), dy = my - SY(0), r = Math.hypot(dx, dy);
  let a = Math.atan2(dy, dx); if (a < -Math.PI / 2) a += TAU;
  const lvl = r >= 92 * z && r <= 190 * z ? 1 : r >= 200 * z && r <= 276 * z ? 2 : 0;
  if (!lvl) return r < 92 * z * 0.6 ? 'core' : null;
  return G.arcs.find(x => x.level === lvl && a >= x.a0 && a < x.a1) || null;
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
  if (e.target !== G.cv) { if (G.hover || G.hoverArc) { G.hover = G.hoverArc = null; hideTip(); } return; }
  const n = pick(e.clientX, e.clientY), arc = pickArc(e.clientX, e.clientY);
  if (n !== G.hover || arc !== G.hoverArc) { G.hover = n; G.hoverArc = arc; n ? showTip(n) : arc && arc !== 'core' ? showArcTip(arc) : hideTip(); }
  if (n || (arc && arc !== 'core')) placeTip(e.clientX, e.clientY);
  G.cv.style.cursor = n || arc ? 'pointer' : 'grab';
});
addEventListener('mouseup', e => {
  const d = G.drag; G.drag = null;
  if (!d || d.moved || e.target !== G.cv) return;
  const arc = pickArc(e.clientX, e.clientY);
  if (arc === 'core') return openFocus();
  if (arc) { if (!arc.other) navigate(arc.data.path); else openFocus('subfolders'); return; }
  const n = pick(e.clientX, e.clientY);
  if (!n) return;
  if (n.type === 'drive') startScan(n.data.path);
  else if (n.type === 'dir' || n.type === 'sub') navigate(n.data.path, n);
  else if (n.type === 'file') confirmRecycleOrReveal(n.data);
  else if (n.type === 'other') openFocus('subfolders');
  else if (n.type === 'hub' && S.view === 'tree') openFocus();
});
G.cv.addEventListener('dblclick', () => fitView());
G.cv.addEventListener('wheel', e => {
  e.preventDefault();
  const f = Math.exp(-e.deltaY * 0.0015), nz = clamp(G.camT.z * f, 0.2, 4);
  const wx = (e.clientX - G.w / 2) / G.camT.z + G.camT.x, wy = (e.clientY - G.h * 0.47) / G.camT.z + G.camT.y;
  G.camT.z = nz; G.camT.x = wx - (e.clientX - G.w / 2) / nz; G.camT.y = wy - (e.clientY - G.h * 0.47) / nz;
}, { passive: false });

/* ---------- tooltip ---------- */
const tip = $('#tip');
function catTags(cats, size) {
  return Object.entries(cats || {}).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v]) => `<span class="tag" style="color:${CAT[k].css};background:rgba(${CAT[k].rgb},.13)">${CAT[k].label} ${pctTxt(v, size)}</span>`).join('');
}
function showTip(n) {
  let html = '';
  const total = S.tree?.size;
  if (n.type === 'dir' || n.type === 'sub') {
    const d = n.data;
    html = `<h4>${esc(d.name)}</h4><div class="p">${esc(d.path)}</div>
      <div class="row"><span class="tag">${fmt(d.size)}</span>${total ? `<span class="tag" style="color:#f0cf98">${pctTxt(d.size, total)} of ${esc(S.tree.name)}</span>` : ''}</div>
      <div class="row">${catTags(d.cats, d.size)}</div>
      <div class="c">${nfmt(d.files)} files · ${nfmt(d.dirs)} folders</div><div class="hint">Click to dive in ›</div>`;
  } else if (n.type === 'file') {
    const f = n.data, cat = CAT[catOfName(f.name)];
    html = `<h4>${esc(f.name)}</h4><div class="p">${esc(f.path)}</div>
      <div class="row"><span class="tag">${fmt(f.size)}</span><span class="tag" style="color:${cat.css};background:rgba(${cat.rgb},.13)">${cat.label}</span></div>
      <div class="c">Modified ${timeAgo(f.mtime)}</div><div class="hint">Click for actions ›</div>`;
  } else if (n.type === 'drive') {
    const d = n.data;
    html = d.kind === 'home' ? `<h4>Home folder</h4><div class="p">${esc(d.path)}</div><div class="hint">Click to scan ›</div>`
      : `<h4>${esc(d.path)} ${esc(d.label)}</h4><div class="row"><span class="tag">${fmt(d.used)} used</span><span class="tag s-clean">${fmt(d.free)} free</span></div>
        <div class="c">${Math.round(n.used * 100)}% of ${fmt(d.total)}</div><div class="hint">Click to scan ›</div>`;
  } else if (n.type === 'other') html = `<h4>${esc(n.label)}</h4><div class="c">${n.badge} in smaller folders</div><div class="hint">Click to list them ›</div>`;
  else html = S.view === 'tree' ? `<h4>${esc(S.tree.name)}</h4><div class="p">${esc(S.tree.path)}</div><div class="row">${catTags(S.tree.cats, S.tree.size)}</div><div class="hint">Click for details ›</div>` : `<h4>This PC</h4><div class="c">${S.drives.length} drive(s)</div>`;
  tip.innerHTML = html;
  tip.classList.add('show');
}
function showArcTip(a) {
  const d = a.data;
  tip.innerHTML = `<h4>${esc(d.name)}</h4>${d.path ? `<div class="p">${esc(d.path)}</div>` : ''}
    <div class="row"><span class="tag">${fmt(d.size)}</span><span class="tag" style="color:#f0cf98">${pctTxt(d.size, S.tree.size)}</span></div>
    ${d.cats ? `<div class="row">${catTags(d.cats, d.size)}</div>` : ''}<div class="hint">${a.other ? 'Click to list them' : 'Click to dive in'} ›</div>`;
  tip.classList.add('show');
}
function placeTip(x, y) {
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(x + 18, G.w - r.width - 12) + 'px';
  tip.style.top = Math.min(y + 18, G.h - r.height - 12) + 'px';
}
function hideTip() { tip.classList.remove('show'); }

/* =========================================================
   Views: drives, scanning, tree
   ========================================================= */
function setView(v) {
  S.view = v;
  document.body.classList.toggle('v-drives', v === 'drives');
  document.body.classList.toggle('v-scanning', v === 'scanning');
  document.body.classList.toggle('v-tree', v === 'tree');
  renderChrome();
}
function showDrives() { closeFocus(true); toggleInsights(false); setView('drives'); buildDrives(); }

async function startScan(path) {
  if (!path) return;
  closeFocus(true); toggleInsights(false); hideTip();
  const ok = await API.call('start_scan', path);
  if (!ok) return toast(`Can't scan ${path}`, false);
  S.scanTarget = path; S.hidden.clear();
  setView('scanning');
  buildScanning();
  document.body.classList.add('scanning');
  $('#statusText').textContent = 'Scanning…';
  pollScan();
}
async function pollScan() {
  const p = await API.call('progress');
  const [bv, bu] = fmtB(p.bytes);
  $('#hudBytes').innerHTML = `${bv}<em>${bu}</em>`;
  $('#hudFiles').textContent = nfmt(p.files);
  $('#hudTime').textContent = `${p.elapsed.toFixed(1)}s`;
  $('#hudPath').textContent = p.current || p.target;
  if (p.running) return setTimeout(pollScan, 120);
  document.body.classList.remove('scanning');
  S.lastScan = { target: p.target, elapsed: p.elapsed, errors: p.errors };
  $('#statusText').textContent = `Scanned in ${p.elapsed.toFixed(1)}s${p.errors ? ` · ${p.errors} skipped` : ''}`;
  if (!p.ready) { toast('Scan stopped', false); return showDrives(); }
  S.tree = await API.call('tree', null);
  setView('tree');
  G.pulses.push({ t: 0 }, { t: -0.35 });
  buildTree(true);
  G.cam = { x: 0, y: 0, z: G.camT.z * 0.5 };
  renderChrome();
}

async function navigate(path, fromNode) {
  if (S.nav || !path) return;
  S.nav = true;
  closeFocus(true); hideTip(); G.hover = null;
  if (fromNode) { G.camT = { x: fromNode.x, y: fromNode.y, z: G.cam.z * 2.4 }; await sleep(240); }
  const d = await API.call('tree', path);
  S.nav = false;
  if (!d) return toast('That folder is not part of this scan', false);
  S.tree = d;
  warp();
  buildTree(true);
  G.cam = { x: 0, y: 0, z: G.camT.z * 0.55 };
  renderChrome();
}
function goUp() {
  if (S.view === 'scanning') return;
  if (S.focus) return closeFocus();
  if (S.view === 'tree' && S.tree.parent) return navigate(S.tree.parent);
  if (S.view === 'tree') return showDrives();
}
function warp() { document.body.classList.add('warp'); setTimeout(() => document.body.classList.remove('warp'), 60); }
async function refreshTree() { S.tree = await API.call('tree', S.tree.path); buildTree(false, false); renderChrome(); }

/* =========================================================
   Focus view (folder details)
   ========================================================= */
const F = { ox: 0, oy: 0, cards: [], items: [], t0: 0, comets: [] };
const TABS = [
  { k: 'largest', icon: 'file', label: 'Largest Files' },
  { k: 'subfolders', icon: 'folder', label: 'Subfolders' },
  { k: 'types', icon: 'pie', label: 'File Types' },
  { k: 'stale', icon: 'clock', label: 'Untouched 1y+' },
];
async function openFocus(tab = 'largest') {
  if (S.view !== 'tree') return;
  if (!S.focus) G.savedCam = { ...G.camT };
  hideTip(); G.hover = null; closePops(); toggleInsights(false);
  S.focus = true; S.tab = tab;
  G.camT = { x: 0, y: 0, z: Math.max(G.cam.z * 3, 2.6) };
  const [d] = await Promise.all([API.call('details', S.tree.path), sleep(400)]);
  if (!S.focus) return;
  S.detail = d;
  document.body.classList.add('focused');
  renderFocus();
}
function closeFocus(instant) {
  if (!S.focus) return;
  document.body.classList.remove('focused');
  S.focus = false;
  if (G.savedCam && !instant) G.camT = G.savedCam;
  $('#fItems').innerHTML = '';
}
function tabList(d, k) {
  const maxOf = l => Math.max(1, ...l.map(x => x.size));
  if (k === 'largest') { const m = maxOf(d.largest); return d.largest.map(f => ({ t: f.name, tag: fmt(f.size), who: f.dir.replace(d.path, '').replace(/^[\\/]/, '') || '(this folder)', c: CAT[catOfName(f.name)].css, w: f.size / m, path: f.path, kind: 'file' })); }
  if (k === 'subfolders') { const m = maxOf(d.subfolders); return d.subfolders.map(s => ({ t: s.name, tag: fmt(s.size), who: `${nfmt(s.files)} files · ${pctTxt(s.size, d.size)}`, c: CAT[domCat(s.cats)].css, w: s.size / m, path: s.path, kind: 'dir' })); }
  if (k === 'types') { const m = maxOf(d.exts); return d.exts.map(e => ({ t: e.ext, tag: fmt(e.size), who: `${CAT[CAT_OF[e.ext] || 'other'].label} · ${pctTxt(e.size, d.size)}`, c: CAT[CAT_OF[e.ext] || 'other'].css, w: e.size / m })); }
  if (k === 'stale') { const m = maxOf(d.stale_files); return d.stale_files.map(f => ({ t: f.name, tag: fmt(f.size), who: `modified ${timeAgo(f.mtime)}`, c: CAT[catOfName(f.name)].css, w: f.size / m, path: f.path, kind: 'file' })); }
  return [];
}
const tabCount = (d, k) => ({ largest: d.largest.length, subfolders: d.subfolders.length, types: d.exts.length, stale: fmt(d.stale) }[k]);
function driveOf(path) { return S.drives.filter(d => path.toLowerCase().startsWith(d.path.toLowerCase())).sort((a, b) => b.path.length - a.path.length)[0]; }

function folderInsights(d) {
  const out = [], top = d.subfolders[0], dom = domCat(d.cats);
  if (top && top.size / d.size > 0.4) out.push({ lvl: 'warn', title: `${top.name} dominates`, text: `${pctTxt(top.size, d.size)} of this folder (${fmt(top.size)}) lives in one subfolder.` });
  out.push({ lvl: 'info', title: `Mostly ${CAT[dom].label.toLowerCase()}`, text: `${fmt(d.cats[dom])} (${pctTxt(d.cats[dom], d.size)}) is ${CAT[dom].label.toLowerCase()}.` });
  if (d.stale / d.size > 0.3) out.push({ lvl: 'warn', title: 'Lots of cold data', text: `${fmt(d.stale)} hasn't been touched in a year. Archive it to an external drive?` });
  const junk = d.subfolders.filter(s => /^(node_modules|\.venv|venv|__pycache__|temp|tmp|cache|\.cache)$/i.test(s.name));
  if (junk.length) out.push({ lvl: 'crit', title: 'Regenerable folders', text: `${junk.map(j => j.name).join(', ')} take ${fmt(junk.reduce((s, j) => s + j.size, 0))} and can be rebuilt or cleared.` });
  const huge = d.largest.filter(f => f.size > 1024 ** 3);
  if (huge.length) out.push({ lvl: 'info', title: `${huge.length} file(s) over 1 GB`, text: `Largest: ${huge[0].name} (${fmt(huge[0].size)}).` });
  return out;
}

function renderFocus() {
  const d = S.detail, dom = domCat(d.cats), pal = CAT[dom], drv = driveOf(d.path);
  $('#fHead').innerHTML = `<h1>${esc(trunc(d.name, 24))}</h1><p><b>${fmt(d.size)}</b></p>`;
  $('#fMeta').innerHTML = `<span class="skew"><span>${drv ? `${esc(drv.path.replace(/[\\/]$/, ''))} SHARE` : 'SHARE'}<b>${drv ? pctTxt(d.size, drv.total) : '—'}</b></span></span>
    <div class="meter">${icon('pie')}<i style="--w:${Math.max(4, drv ? pct(d.size, drv.total) : 50)}%;--c:${pal.css}"></i></div>`;
  $('#fCards').innerHTML = TABS.map(t => `<button class="f-card ${t.k === S.tab ? 'on' : ''}" data-tab="${t.k}">
    <div class="n">${icon(t.icon)}${esc(String(tabCount(d, t.k)))}</div><small>${t.label}</small></button>`).join('');
  $('#fCards').querySelectorAll('.f-card').forEach(b => b.addEventListener('click', () => { S.tab = b.dataset.tab; renderFocus(); }));
  $('#fCrumb').innerHTML = S.tree.crumbs.map((c, i, a) => i === a.length - 1 ? esc(trunc(c.name, 22)) : `<button data-p="${esc(c.path)}">${esc(trunc(c.name, 16))}</button><span>›</span>`).join('');
  $('#fCrumb').querySelectorAll('button').forEach(b => (b.onclick = () => navigate(b.dataset.p)));

  const stack = CAT_ORDER.filter(k => d.cats[k]).map(k => `<i style="width:${pct(d.cats[k], d.size)}%;background:${CAT[k].css};color:${CAT[k].css}"></i>`).join('');
  const legend = CAT_ORDER.filter(k => d.cats[k] && d.cats[k] / d.size > 0.01).map(k => `<span><i style="background:${CAT[k].css};color:${CAT[k].css}"></i>${CAT[k].label} ${pctTxt(d.cats[k], d.size)}</span>`).join('');
  const largest = d.largest[0];
  const cold = d.stale / d.size;
  $('#fPanel').innerHTML = `
    <div class="p-kicker">${icon('folder')}Folder
      <button class="ghost" style="margin-left:auto;height:28px" data-act="copy">${icon('copy')}Copy path</button></div>
    <h2 title="${esc(d.name)}">${esc(d.name)}</h2>
    <div class="p-path" title="${esc(d.path)}">${esc(d.path)}</div>
    <div class="p-status">
      <div><span class="pill" style="color:${pal.css}">${drv ? `${pctTxt(d.size, drv.total)} of ${esc(drv.path.replace(/[\\/]$/, ''))}` : fmt(d.size)}</span>
      <p>${d.subfolders[0] ? `Biggest: <b>${esc(trunc(d.subfolders[0].name, 18))}</b> (${pctTxt(d.subfolders[0].size, d.size)})` : `${nfmt(d.files)} files`}</p></div>
      <button class="ghost" data-act="open">Open in Explorer ${icon('chevR')}</button>
    </div>
    <div class="p-health ${cold > 0.4 ? 'mid' : dom === 'video' || dom === 'audio' ? '' : 'good'}">
      <div class="ph-top"><span>Folder Size</span><span class="pill">${pal.label}</span></div>
      <div class="ph-main"><div class="big">${fmtB(d.size)[0]}<span style="font-size:18px;color:#9fb2af;margin-left:4px">${fmtB(d.size)[1]}</span></div>
        <div class="delta"><b>${nfmt(d.files)}</b> files<br><b>${nfmt(d.dirs)}</b> folders</div><canvas id="donut"></canvas></div>
      <div class="stack">${stack}</div><div class="legend">${legend}</div>
    </div>
    <div class="p-grid">
      <div class="tile"><div class="n">${icon('file')}${nfmt(d.files)}</div><small>Files</small></div>
      <div class="tile"><div class="n">${icon('folder')}${nfmt(d.dirs)}</div><small>Folders</small></div>
      <div class="tile"><div class="n">${icon('clock')}${fmt(d.stale)}</div><small>Untouched 1y+ (${pctTxt(d.stale, d.size)})</small></div>
      <div class="tile"><div class="n">${icon('pie')}${largest ? fmt(largest.size) : '—'}</div><small>Largest file</small></div>
    </div>
    <div class="p-ins"><h4>${icon('sparkleWave')}Pulse Analysis</h4>
      ${folderInsights(d).map(i => `<div class="it ${i.lvl}"><b>${esc(i.title)}</b><p>${esc(i.text)}</p></div>`).join('')}</div>
    <div class="p-actions">
      <button data-act="open">${icon('reveal')}Explorer</button>
      <button data-act="up">${icon('up')}Up</button>
      <button data-act="rescan">${icon('scan')}Rescan</button>
      <button data-act="insights" class="primary">${icon('sparkleWave')}Cleanup</button>
    </div>`;
  $('#fPanel').querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => panelAction(b.dataset.act)));
  layoutFocus();
  drawDonut($('#donut'), d);
}
function panelAction(a) {
  const d = S.detail;
  if (a === 'open') API.call('open_folder', d.path);
  else if (a === 'copy') { navigator.clipboard?.writeText(d.path).then(() => toast('Path copied'), () => toast(d.path)); }
  else if (a === 'up') { closeFocus(); goUp(); }
  else if (a === 'rescan') startScan(d.path);
  else if (a === 'insights') { closeFocus(); setTimeout(() => toggleInsights(true), 300); }
}

function layoutFocus() {
  if (!S.detail) return;
  const d = S.detail, w = G.w, h = G.h;
  const panelW = Math.min(430, w * 0.31) + 24, aw = w - panelW - 24;
  F.ox = clamp(aw * 0.14, 120, 220); F.oy = h * 0.54; F.diskR = Math.min(240, aw * 0.2);
  const head = $('#fHead'), meta = $('#fMeta');
  head.style.left = F.ox + 'px'; head.style.top = F.oy - 92 + 'px';
  meta.style.left = F.ox + 'px'; meta.style.top = F.oy + 82 + 'px';
  const cx = Math.max(F.ox + 150, aw * 0.3), gap = Math.min(80, (h - 260) / TABS.length);
  F.cards = TABS.map((t, i) => ({ k: t.k, x: cx, y: F.oy + (i - (TABS.length - 1) / 2) * gap }));
  $('#fCards').querySelectorAll('.f-card').forEach((el, i) => { el.style.left = F.cards[i].x + 'px'; el.style.top = F.cards[i].y - 29 + 'px'; });

  const list = tabList(d, S.tab), M = Math.min(list.length, Math.floor((h - 220) / 36), 18);
  const H = Math.min(h - 230, Math.max(M - 1, 1) * 38), xm = Math.max(cx + 260, aw * 0.72), curve = (xm - cx - 190) * 0.55;
  F.items = list.slice(0, M).map((it, k) => { const tt = M === 1 ? 0 : (k / (M - 1)) * 2 - 1; return { ...it, x: xm - tt * tt * curve, y: F.oy + (tt * H) / 2, fade: 1 - Math.pow(Math.abs(tt), 4) * 0.6 }; });
  const sel = F.cards.find(c => c.k === S.tab) || F.cards[0];
  F.sel = { x: sel.x + 156, y: sel.y };
  F.t0 = G.t;
  F.comets = F.items.length ? Array.from({ length: 4 }, (_, i) => ({ i: Math.floor(Math.random() * F.items.length), p: -i * 0.35, c: ['255,255,255', '110,230,210', '255,230,120', '200,240,255'][i] })) : [];
  const box = $('#fItems');
  box.innerHTML = F.items.map((it, k) => `<div class="f-item pre ${it.kind === 'dir' ? 'clickable' : ''}" data-k="${k}" style="left:${it.x}px;top:${it.y}px;max-width:${Math.max(140, aw - it.x - 10)}px;transition-delay:${0.25 + k * 0.035}s">
      <div class="t">${esc(it.t)}</div>
      <div class="m"><span class="tag">${esc(it.tag)}</span>${it.who ? `<span class="who">${esc(trunc(it.who, 40))}</span>` : ''}<span class="bar" style="--c:${it.c};width:${Math.round(8 + 30 * (it.w ?? 1))}px"></span>
      ${it.path ? `<span class="acts"><button data-a="reveal" title="Show in Explorer">${icon('reveal')}</button><button data-a="del" class="del" title="Move to Recycle Bin">${icon('trash')}</button></span>` : ''}</div></div>`).join('');
  box.querySelectorAll('.f-item').forEach(el => {
    const it = F.items[el.dataset.k];
    el.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'reveal') return API.call(it.kind === 'dir' ? 'open_folder' : 'reveal', it.path);
      if (a === 'del') return askRecycle(it.path, it.t, it.tag);
      if (it.kind === 'dir') navigate(it.path);
    });
  });
  requestAnimationFrame(() => box.querySelectorAll('.f-item').forEach((el, k) => { el.classList.remove('pre'); el.style.opacity = F.items[k].fade; }));
  if (!F.items.length) box.innerHTML = `<div class="f-item" style="left:${xm - 60}px;top:${F.oy}px"><div class="t" style="color:#8ea4a1">Nothing here ✓</div></div>`;
}

const bez = (p0, p1, p2, p3, t) => { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3; };
const curvePts = it => { const sx = F.sel.x, sy = F.sel.y, ex = it.x - 2, ey = it.y; return [sx, sy, sx + (ex - sx) * 0.42, sy, sx + (ex - sx) * 0.5, ey, ex, ey]; };
function drawFocus(dt) {
  const c = G.fctx, { w, h, t } = G;
  c.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const A = G.focusT;
  if (A < 0.01 || !S.detail) return;
  c.globalAlpha = A;
  const { ox, oy } = F, d = S.detail, pal = CAT[domCat(d.cats)];
  let g = c.createRadialGradient(ox, oy, 0, ox, oy, F.diskR * 1.4);
  g.addColorStop(0, 'rgba(0,0,0,.6)'); g.addColorStop(0.65, 'rgba(0,0,0,.38)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.beginPath(); c.arc(ox, oy, F.diskR * 1.4, 0, TAU); c.fill();
  for (const cd of F.cards) {
    const on = cd.k === S.tab;
    c.strokeStyle = on ? 'rgba(255,225,180,.75)' : 'rgba(140,220,205,.28)'; c.lineWidth = on ? 1.4 : 1;
    c.beginPath(); c.moveTo(ox + 50, oy); c.bezierCurveTo(ox + 50 + (cd.x - ox) * 0.45, oy, cd.x - 60, cd.y, cd.x - 2, cd.y); c.stroke();
  }
  const p = ease(clamp((G.t - F.t0 - 0.1) / 1.1, 0, 1));
  c.globalCompositeOperation = 'lighter';
  F.items.forEach(it => {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = curvePts(it), L = Math.hypot(x3 - x0, y3 - y0) * 1.15;
    const gg = c.createLinearGradient(x0, y0, x3, y3);
    gg.addColorStop(0, `rgba(255,230,190,${0.75 * A})`); gg.addColorStop(1, `rgba(220,240,235,${0.35 * it.fade * A})`);
    c.strokeStyle = gg; c.lineWidth = 1.1; c.setLineDash([L * p, L]);
    c.beginPath(); c.moveTo(x0, y0); c.bezierCurveTo(x1, y1, x2, y2, x3, y3); c.stroke();
    c.setLineDash([]);
    if (p > 0.85) {
      const rgb = it.c.match(/[0-9a-f]{2}/gi).map(hx => parseInt(hx, 16)).join(',');
      c.globalAlpha = A * it.fade; orb(c, x3, y3, 3.4, { core: '#fff', deep: it.c, rgb }, { glow: 0.8 }); c.globalAlpha = A; c.globalCompositeOperation = 'lighter';
    }
  });
  g = c.createRadialGradient(F.sel.x, F.sel.y, 0, F.sel.x, F.sel.y, 40);
  g.addColorStop(0, `rgba(255,225,170,${0.55 * p})`); g.addColorStop(1, 'rgba(255,225,170,0)');
  c.fillStyle = g; c.beginPath(); c.arc(F.sel.x, F.sel.y, 40, 0, TAU); c.fill();
  if (p >= 1) for (const cm of F.comets) {
    cm.p += dt * 0.55;
    if (cm.p > 1) { cm.p = 0; cm.i = Math.floor(Math.random() * F.items.length); }
    if (cm.p < 0) continue;
    const pts = curvePts(F.items[cm.i]);
    for (let s = 0; s < 14; s++) {
      const q = cm.p - s * 0.012; if (q < 0) break;
      c.fillStyle = `rgba(${cm.c},${(1 - s / 14) * 0.9 * A})`;
      c.beginPath(); c.arc(bez(pts[0], pts[2], pts[4], pts[6], q), bez(pts[1], pts[3], pts[5], pts[7], q), 2.4 * (1 - s / 16), 0, TAU); c.fill();
    }
  }
  c.globalCompositeOperation = 'source-over';
  // orb with category ring
  const R = 34;
  let a = -Math.PI / 2;
  for (const k of CAT_ORDER) { if (!d.cats[k]) continue; const span = (d.cats[k] / d.size) * TAU * p; arcRing(c, ox, oy, R * 2.35, a + 0.01, a + span - 0.01, CAT[k].rgb, 0.9, 4); a += span; }
  waveRing(c, ox, oy, R * 1.95, R * 0.12, t * 0.9, pal.rgb, 0.5, 1.1, 1.3);
  spikes(c, ox, oy, R * 1.12, R * 0.42, 110, t * 1.4, '120,230,210', 0.6, 1.1);
  orb(c, ox, oy, R, pal, { glow: 1.4 });
  c.globalAlpha = 1;
}
function drawDonut(cv, d) {
  if (!cv) return;
  const dpr = G.dpr, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const c = cv.getContext('2d'); c.scale(dpr, dpr);
  const x = W - H / 2 - 2, y = H / 2, r = H / 2 - 5;
  let a = -Math.PI / 2;
  c.lineWidth = 6;
  for (const k of CAT_ORDER) {
    if (!d.cats[k]) continue;
    const span = (d.cats[k] / d.size) * TAU;
    c.strokeStyle = CAT[k].css; c.shadowColor = CAT[k].css; c.shadowBlur = 8;
    c.beginPath(); c.arc(x, y, r, a + 0.03, a + span - 0.03); c.stroke(); a += span;
  }
}

/* =========================================================
   Chrome: KPIs, crumbs, categories, insights, search
   ========================================================= */
function animateNum(el, to, dec = 0) {
  const from = parseFloat(el.textContent.replace(/,/g, '')) || 0, t0 = performance.now();
  const step = now => { const k = ease(Math.min(1, (now - t0) / 900)), v = lerp(from, to, k); el.textContent = dec ? v.toFixed(dec) : Math.round(v).toLocaleString(); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function kpi(i, labelTxt, value, unit = '', dec = 0) { $(`#k${i}l`).textContent = labelTxt; animateNum($(`#k${i}`), value, dec); $(`#k${i}u`).textContent = unit; }
function kpiBytes(i, labelTxt, b) { const [v, u] = fmtB(b); kpi(i, labelTxt, parseFloat(v), u, v.includes('.') ? v.split('.')[1].length : 0); }
function renderChrome() {
  $('#avatar').textContent = (S.user || 'U').slice(0, 2).toUpperCase();
  $('#demoFlag').hidden = !S.demo;
  if (S.view === 'tree' && S.tree) {
    const d = S.tree, drv = driveOf(d.root || d.path);
    kpiBytes(1, 'This Folder', d.size);
    kpi(2, 'Files', d.files);
    kpi(3, 'Folders', d.dirs);
    drv ? kpiBytes(4, `Free on ${drv.path.replace(/[\\/]$/, '')}`, drv.free) : kpi(4, 'Free Space', 0);
    $('#driveLabel').textContent = trunc(d.crumbs[0].name, 14);
    renderCrumbs(); renderCats();
    if (S.insights) loadInsights();
  } else {
    const D = S.drives;
    kpi(1, 'Drives', D.length);
    kpiBytes(2, 'Total Capacity', D.reduce((s, d) => s + d.total, 0));
    kpiBytes(3, 'Used', D.reduce((s, d) => s + d.used, 0));
    kpiBytes(4, 'Free Space', D.reduce((s, d) => s + d.free, 0));
    $('#driveLabel').textContent = 'Drives';
  }
}
function renderCrumbs() {
  const cr = S.tree.crumbs, show = cr.length > 6 ? [cr[0], null, ...cr.slice(-4)] : cr;
  $('#crumbs').innerHTML = show.map((c, i) => c ? `${i ? '<i>›</i>' : ''}<button class="${c === cr[cr.length - 1] ? 'cur' : ''}" data-p="${esc(c.path)}" title="${esc(c.path)}">${esc(c.name)}</button>` : '<i>›</i><span class="ell">…</span>').join('');
  $('#crumbs').querySelectorAll('button').forEach(b => (b.onclick = () => navigate(b.dataset.p)));
}
function renderCats() {
  const d = S.tree;
  $('#cats').innerHTML = '<h5>FILE TYPES</h5>' + CAT_ORDER.filter(k => d.cats[k]).map(k => `<button class="${S.hidden.has(k) ? 'off' : ''}" data-k="${k}" title="Toggle ${CAT[k].label}">
    <i style="background:${CAT[k].css};box-shadow:0 0 8px ${CAT[k].css}"></i>${CAT[k].label}<b>${fmt(d.cats[k])}</b></button>`).join('');
  $('#cats').querySelectorAll('button').forEach(b => (b.onclick = () => { const k = b.dataset.k; S.hidden.has(k) ? S.hidden.delete(k) : S.hidden.add(k); b.classList.toggle('off'); buildTree(false, false); }));
}

async function loadInsights() {
  if (S.view !== 'tree') { $('#insList').innerHTML = '<div class="card-i ok"><div class="h"><b>Scan a drive first</b></div><p>Pick a drive to get cleanup suggestions.</p></div>'; return placeInsights(); }
  const cards = await API.call('insights', S.tree.path);
  const list = cards.length ? cards : [{ lvl: 'ok', title: 'Looking tidy', size: 0, items: [], text: 'No obvious space hogs found in this folder.' }];
  $('#insList').innerHTML = list.map((c, i) => `<div class="card-i ${c.lvl}">
    <div class="h"><b>${esc(c.title)}</b>${c.size ? `<span class="tgt" style="color:#f0cf98;font-weight:500">${fmt(c.size)}</span>` : ''}</div>
    <p>${esc(c.text)}</p>
    ${c.items.length ? `<div class="repo-chips">${c.items.map((it, j) => `<button data-c="${i}:${j}" title="${esc(it.path)}">${it.kind === 'dir' ? '📁' : '📄'} ${esc(trunc(it.name, 26))} · ${fmtShort(it.size)}</button>`).join('')}</div>` : ''}</div>`).join('');
  $('#insList').querySelectorAll('[data-c]').forEach(b => { const [i, j] = b.dataset.c.split(':'); const it = list[i].items[j]; b.onclick = () => (it.kind === 'dir' ? navigate(it.path) : confirmRecycleOrReveal(it)); });
  placeInsights();
}
function placeInsights() { const d = $('#dock').getBoundingClientRect(); $('#insights').style.bottom = G.h - d.top + 12 + 'px'; }
addEventListener('resize', placeInsights);
function toggleInsights(on = !S.insights) {
  S.insights = on; $('#insights').classList.toggle('open', on); $('#pulseBtn').classList.toggle('on', on);
  if (on) loadInsights();
}

/* ---------- popovers ---------- */
function openPop(id, anchor, html, bind, above) {
  const pop = $(id), wasOpen = pop.classList.contains('open');
  closePops();
  if (wasOpen && !above) return;
  pop.innerHTML = html; bind?.(pop);
  const a = anchor.getBoundingClientRect();
  pop.classList.add('open');
  const r = pop.getBoundingClientRect(), below = !above && a.bottom + 10 + r.height < G.h;
  pop.style.left = clamp(a.left + a.width / 2 - r.width / 2, 12, G.w - r.width - 12) + 'px';
  pop.style.top = (below ? a.bottom + 10 : a.top - r.height - 10) + 'px';
}
function closePops() { document.querySelectorAll('.pop.open').forEach(p => p.classList.remove('open')); }
addEventListener('mousedown', e => { if (!e.target.closest('.pop, .chip, #askForm')) closePops(); });

function drivePop() {
  openPop('#drivePop', $('#driveChip'), `<h5>Scan a drive</h5>${S.drives.map((d, i) => `<button class="opt" data-i="${i}">${icon('disk')}<span>${esc(d.path)} ${esc(d.label)}</span>
    <span style="margin-left:auto;color:#5d716e;font-size:11px">${fmt(d.free)} free</span></button>`).join('')}
    ${S.home ? `<button class="opt" data-home="1">${icon('folder')}<span>Home folder</span></button>` : ''}
    <button class="btn-gold add" id="popPick">${icon('plus')}Choose folder…</button>`, pop => {
    pop.querySelectorAll('[data-i]').forEach(b => (b.onclick = () => { closePops(); startScan(S.drives[b.dataset.i].path); }));
    pop.querySelector('[data-home]')?.addEventListener('click', () => { closePops(); startScan(S.home); });
    $('#popPick', pop).onclick = () => { closePops(); pickAndScan(); };
  });
}
async function pickAndScan() { const p = await API.call('pick_folder'); if (p) startScan(p); }

async function runSearch(q) {
  q = q.trim();
  if (!q) return;
  if (/^(up|\.\.)$/i.test(q)) return goUp();
  if (/^(home|drives|pc)$/i.test(q)) return showDrives();
  if (/^(rescan|refresh)$/i.test(q)) return S.tree && startScan(S.tree.path);
  if (/^[a-z]:[\\/]|^\//i.test(q)) { const d = await API.call('tree', q); return d ? navigate(q) : startScan(q); }
  if (S.view !== 'tree') return toast('Scan a drive first', false);
  const res = await API.call('search', q, S.tree.path);
  openPop('#results', $('#askForm'), `<h5>${res.length ? `Top matches in ${esc(S.tree.name)}` : 'No matches'}</h5>${res.map((r, i) => `<button class="opt" data-i="${i}">
    ${icon(r.kind === 'dir' ? 'folder' : 'file')}<div><span>${esc(r.name)}</span><em>${esc(r.path)}</em></div><small>${fmt(r.size)}</small></button>`).join('')}`, pop =>
    pop.querySelectorAll('[data-i]').forEach(b => (b.onclick = () => { closePops(); const r = res[b.dataset.i]; r.kind === 'dir' ? navigate(r.path) : confirmRecycleOrReveal(r); })), true);
}

/* ---------- file actions ---------- */
let modalResolve = null;
function askRecycle(path, name, size) {
  $('#mTitle').textContent = `Move “${name}” to the Recycle Bin?`;
  $('#mText').textContent = `${path}${size ? ` · ${size}` : ''}. You can restore it from the Recycle Bin later.`;
  $('#modal').classList.add('open');
  return new Promise(res => (modalResolve = res)).then(async ok => {
    $('#modal').classList.remove('open');
    if (!ok) return;
    const r = await API.call('recycle', path);
    if (!r.ok) return toast(`Couldn't recycle: ${r.error}`, false);
    toast(`Moved ${name} to the Recycle Bin`);
    await refreshTree();
    if (S.focus) { S.detail = await API.call('details', S.tree.path); renderFocus(); }
  });
}
$('#mOk').onclick = () => modalResolve?.(true);
$('#mCancel').onclick = () => modalResolve?.(false);
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') modalResolve?.(false); });
function confirmRecycleOrReveal(f) {
  const el = document.createElement('div');
  el.className = 'toast glass';
  el.innerHTML = `<i></i><span>${esc(trunc(f.name, 34))} · ${fmt(f.size)}</span>
    <button class="ghost" style="height:26px;padding:0 10px" data-a="reveal">Show</button><button class="ghost" style="height:26px;padding:0 10px;color:#ff9aa2" data-a="del">Recycle</button>`;
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'reveal') API.call('reveal', f.path);
    if (a === 'del') askRecycle(f.path, f.name, fmt(f.size));
    if (a) el.remove();
  });
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 6000);
}
function toast(msg, ok = true) {
  const el = document.createElement('div');
  el.className = 'toast glass' + (ok ? '' : ' bad');
  el.innerHTML = `<i></i><span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 3200);
}

/* ---------- wiring ---------- */
function setMode(m) {
  S.mode = m;
  $('#modeOrbit').classList.toggle('on', m === 'orbit'); $('#modeRings').classList.toggle('on', m === 'rings');
  hideTip(); G.hover = G.hoverArc = null;
  if (S.view === 'tree') { warp(); buildTree(false); }
}
$('#modeOrbit').onclick = () => setMode('orbit');
$('#modeRings').onclick = () => setMode('rings');
$('#zoomIn').onclick = () => (G.camT.z = clamp(G.camT.z * 1.25, 0.2, 4));
$('#zoomOut').onclick = () => (G.camT.z = clamp(G.camT.z / 1.25, 0.2, 4));
$('#upBtn').onclick = goUp;
$('#upChip').onclick = goUp;
$('#detailsBtn').onclick = () => (S.view === 'tree' ? (S.focus ? closeFocus() : openFocus()) : toast('Scan a drive first'));
$('#rescanBtn').onclick = () => (S.view === 'tree' ? startScan(S.tree.crumbs[0].path) : null);
$('#homeBtn').onclick = showDrives;
$('#scanFolderBtn').onclick = pickAndScan;
$('#searchBtn').onclick = () => { closeFocus(); $('#ask').focus(); };
$('#driveChip').onclick = drivePop;
$('#pulseBtn').onclick = () => toggleInsights();
$('#insClose').onclick = () => toggleInsights(false);
$('#backBtn').onclick = () => closeFocus();
$('#stopBtn').onclick = () => API.call('stop_scan');
$('#ask').addEventListener('input', e => { S.query = /^(up|home|drives|rescan|[a-z]:[\\/]|\/)/i.test(e.target.value) ? '' : e.target.value.trim(); });
$('#askForm').addEventListener('submit', e => { e.preventDefault(); const v = $('#ask').value; S.query = ''; runSearch(v); });
addEventListener('keydown', e => {
  const typing = e.target.tagName === 'INPUT';
  if (e.key === 'Escape') {
    if ($('#modal').classList.contains('open')) return modalResolve?.(false);
    if (typing) { e.target.value = ''; S.query = ''; e.target.blur(); }
    closePops();
    if (S.focus) closeFocus(); else if (S.insights) toggleInsights(false);
  }
  if (typing) return;
  if (e.key === '/') { e.preventDefault(); closeFocus(); $('#ask').focus(); }
  if (e.key === 'Backspace') { e.preventDefault(); goUp(); }
  if (e.key === 'd' || e.key === 'D') $('#detailsBtn').click();
  if (e.key === 'f' || e.key === 'F') fitView();
  if (e.key === 'i' || e.key === 'I') toggleInsights();
  if (e.key === 'r' || e.key === 'R') $('#rescanBtn').click();
  if (e.key === '1') setMode('orbit');
  if (e.key === '2') setMode('rings');
});

/* ---------- boot ---------- */
(async function boot() {
  requestAnimationFrame(frame);
  await API.init();
  if (document.fonts) document.fonts.ready.then(() => { if (!document.fonts.check('12px "Roboto Condensed"')) COND = '"Bahnschrift SemiCondensed","Bahnschrift","Arial Narrow",sans-serif'; });
  const info = await API.call('info');
  S.user = info.user; S.home = info.home; S.drives = info.drives;
  showDrives();
  setTimeout(() => document.body.classList.remove('intro'), 120);
  setTimeout(() => document.body.classList.add('ready'), 2200);
})();
