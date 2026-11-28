// Synthetic offline regression for the section-based homepage.
process.chdir(require("node:path").resolve(__dirname, ".."));
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const ts = require(require.resolve("typescript", { paths: [process.cwd()] }));

function createHome() {
  const instances = new Map(), queue = [], effects = [], categories = [], featured = [], ranks = [], homeRequests = [], navigation = [], tabs = [], observers = [];
  const scrollElement = { clientWidth: 390, clientHeight: 720 };
  let current = null, cursor = 0, tree, props = { active: false, bottomInset: 74 };
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(init) {
      const inst = current, i = cursor++;
      if (!inst.hooks[i]) {
        const h = { v: typeof init === "function" ? init() : init };
        h.set = (u) => {
          const next = typeof u === "function" ? u(h.v) : u;
          if (Object.is(next, h.v)) return;
          queue.push(() => { if (inst.mounted) h.v = next; });
        };
        inst.hooks[i] = h;
      }
      return [inst.hooks[i].v, inst.hooks[i].set];
    },
    useRef(init) { return current.hooks[cursor++] ||= { current: init }; },
    useCallback(fn, deps) {
      const inst = current, i = cursor++;
      if (!inst.hooks[i] || !same(inst.hooks[i].deps, deps)) inst.hooks[i] = { deps, fn };
      return inst.hooks[i].fn;
    },
    useEffect(fn, deps) {
      const inst = current, i = cursor++;
      if (!inst.hooks[i] || !same(inst.hooks[i].deps, deps)) {
        const old = inst.hooks[i]; inst.hooks[i] = { deps };
        effects.push(() => { old?.cleanup?.(); if (inst.mounted) inst.hooks[i].cleanup = fn(); });
      }
    },
  };
  react.default = react;
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const api = {
    category: (cate, page, size, sort, original = false) => new Promise((resolve, reject) => categories.push({ args: [cate, page, size, sort, original], resolve, reject })),
    home: () => new Promise((resolve, reject) => homeRequests.push({ resolve, reject })),
    homeFeatured: () => new Promise((resolve, reject) => featured.push({ resolve, reject })),
    rank: (kind) => new Promise((resolve, reject) => ranks.push({ kind, resolve, reject })),
  };
  const store = { push: (page) => navigation.push(page), setTab: (tab) => tabs.push(tab) };
  class IO {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    enter() { if (!this.disconnected) this.callback([{ isIntersecting: true, target: this.target }]); }
  }
  const cache = new Map();
  const StubRowCard = ({ v, onOpen }) => jsx("button", { onClick: onOpen, children: v.title });
  const StubRankRow = ({ item, onOpen }) => jsx("button", { onClick: onOpen, children: item.title });
  const StubEmpty = ({ title, sub, action, onAction }) => jsx("div", { role: "status", title, onAction, children: `${title} ${sub || ""} ${action || ""}` });
  const icons = new Proxy({}, { get: (_target, name) => () => jsx("span", { children: String(name) }) });

  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const imports = (id) => {
      if (id === "react") return react;
      if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), id));
      if (target === "src/api") return { api };
      if (target === "src/store") return { useStore: () => store };
      if (target === "src/components/cards") return { RowCard: StubRowCard, RankRow: StubRankRow };
      if (target === "src/components/ui") return { Empty: StubEmpty, Img: () => null };
      if (target === "src/icons") return icons;
      for (const ext of [".tsx", ".ts"]) if (fs.existsSync(target + ext)) return load(target + ext);
      throw Error(`Unexpected import ${id} from ${file}`);
    };
    const source = fs.readFileSync(file, "utf8");
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2021 } }).outputText,
      { module: mod, exports: mod.exports, require: imports, IntersectionObserver: IO, console, Set, Map, Promise, Math });
    return mod.exports;
  }
  const Home = load("src/pages/Home.tsx").default;
  function dispose(inst) { inst.mounted = false; for (const h of inst.hooks) h?.cleanup?.(); }
  function render() {
    const visited = new Set();
    function expand(value, p) {
      if (Array.isArray(value)) return value.map((x, i) => expand(x, `${p}/${x?.key ?? i}`));
      if (!value || typeof value !== "object") return value;
      if (typeof value.type === "function") {
        const id = `${p}:${value.type.name}`;
        let inst = instances.get(id);
        if (!inst || inst.type !== value.type) { if (inst) dispose(inst); inst = { type: value.type, hooks: [], mounted: true }; instances.set(id, inst); }
        visited.add(id); const prev = current, oldCursor = cursor; current = inst; cursor = 0;
        const result = value.type(value.props); current = prev; cursor = oldCursor;
        return { ...value, rendered: expand(result, id) };
      }
      if (typeof value.props?.ref === "function") value.props.ref(scrollElement);
      else if (value.props?.ref && typeof value.props.ref === "object") value.props.ref.current ||= scrollElement;
      return { ...value, props: { ...value.props, children: expand(value.props?.children, `${p}/children`) } };
    }
    tree = expand(jsx(Home, props), "root");
    for (const [id, inst] of instances) if (!visited.has(id)) { dispose(inst); instances.delete(id); }
    while (effects.length) effects.shift()();
    return tree;
  }
  function flush() { let n = 0; while (queue.length) { assert(++n < 80, "render loop"); while (queue.length) queue.shift()(); render(); } return tree; }
  return {
    categories, featured, ranks, homeRequests, navigation, tabs, observers,
    get tree() { return tree; },
    mount() { render(); flush(); },
    update(next) { props = { ...props, ...next }; render(); flush(); },
    flush,
    async settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); flush(); } },
  };
}

function nodes(root) {
  const out = [];
  function visit(x) {
    if (Array.isArray(x)) x.forEach(visit);
    else if (x && typeof x === "object") { out.push(x); if (x.rendered) visit(x.rendered); else visit(x.props?.children); }
  }
  visit(root); return out;
}
function text(root) {
  if (Array.isArray(root)) return root.map(text).join("");
  if (root && typeof root === "object") return text(root.rendered ?? root.props?.children);
  return root == null || typeof root === "boolean" ? "" : String(root);
}
function button(r, label) {
  const found = nodes(r.tree).find((n) => n.type === "button" && text(n) === label);
  assert(found, `button ${label}`); return found;
}
const card = (id, is_original = 0) => ({ id, title: `Video ${id}`, cover: "", tags: ["都市"], is_original, episode_count: 4 });
const rank = (id, n = 1) => ({ rank: n, video_id: id, title: `Rank ${id}`, cover: "", tags: ["都市"], score: 8, metric_value: 100 + id, metric_label: "指数", metrics: {} });

(async () => {
  const r = createHome(); r.mount();
  const labels = ["热门标签", "黄果原创", "精选推荐", "最近上新", "热播短剧", "专题推荐", "排行榜"];
  const first = text(r.tree);
  assert(labels.every((label) => first.includes(label)), "all homepage sections are present");
  assert.equal(r.categories.length + r.featured.length + r.homeRequests.length + r.ranks.length, 0, "hidden homepage does not start network calls");

  r.update({ active: true });
  assert(r.observers.length >= 6, "homepage sections are attached to lazy observers");
  for (const observer of [...r.observers]) observer.enter();
  assert.equal(r.categories.length, 1, "original section requests original-filtered videos");
  assert.deepEqual(r.categories[0].args, ["ai-duanju", 1, 50, "latest", true]);
  assert.equal(r.featured.length, 1, "curated homepage cards use their dedicated SSR source");
  assert.equal(r.homeRequests.length, 1, "latest, hot and topic sections share the homepage API request");
  await r.settle();
  assert.deepEqual(r.ranks.map((request) => request.kind), ["hot"]);

  r.categories[0].resolve({ items: [card(12, 1)] });
  r.featured[0].resolve({ items: [card(20)] });
  r.homeRequests[0].resolve({
    featured: [card(40)], latest: [card(30)],
    topic_rec: [{ id: 5, title: "精选专题", slug: "picked", cover: "", video_count: 9 }],
  });
  r.ranks[0].resolve({ items: [rank(117), rank(12, 2)] });
  await r.settle();

  button(r, "推荐榜").props.onClick(); r.flush(); await r.settle();
  button(r, "飙升榜").props.onClick(); r.flush(); await r.settle();
  assert.deepEqual(r.ranks.map((request) => request.kind), ["hot", "recommend", "potential"]);
  r.ranks[1].resolve({ items: [rank(500)] });
  r.ranks[2].resolve({ items: [rank(600)] });
  await r.settle();
  button(r, "热播榜").props.onClick(); r.flush();
  assert(nodes(r.tree).some((n) => n.type === "button" && text(n) === "Video 12"), "original section renders returned cards");
  assert(nodes(r.tree).some((n) => n.type === "button" && text(n).includes("精选专题")), "topic cards render on home");

  button(r, "都市").props.onClick();
  assert.equal(r.navigation.at(-1).kind, "channel");
  assert.equal(r.navigation.at(-1).cate, "ai-duanju");
  assert.equal(r.navigation.at(-1).tag, "都市");
  const rankButton = nodes(r.tree).find((n) => n.type === "button" && text(n) === "Rank 117");
  rankButton.props.onClick();
  assert.equal(r.navigation.at(-1).kind, "feed");
  assert.equal(r.navigation.at(-1).videoIds.join(","), "117,12");
  console.log("PASS homepage sections, lazy loading and original/curated/home REST data mapping");
  console.log("PASS three ranking APIs are available on home and keep feed navigation");
  console.log("PASS popular tags navigate to their filtered channel; topic cards render in the homepage");
})().catch((e) => { console.error(e); process.exitCode = 1; });
