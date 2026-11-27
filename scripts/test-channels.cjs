// Run: node scripts/test-channels.cjs
// Execute the real TypeScript hook and API wrapper with mocked React/Tauri boundaries.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function compile(relativePath) {
  const filename = path.join(root, relativePath);
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  });
  const errors = (result.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  return { code: result.outputText, filename };
}
const apiSource = compile("src/api.ts");
const hookSource = compile("src/hooks/useChannelVideos.ts");

function load(source, imports, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(source.code, {
    module, exports: module.exports,
    require(id) {
      assert(Object.hasOwn(imports, id), `Unexpected import: ${id}`);
      return imports[id];
    },
    console, Promise, Set, Map, Date, ...globals,
  }, { filename: source.filename, timeout: 1000 });
  return module.exports;
}
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const plain = (value) => JSON.parse(JSON.stringify(value));
const ids = (state) => Array.from(state.items, (item) => item.id);
const page = (itemIds, current = 1, pages = 3, total = 60) => ({
  items: itemIds.map((id) => ({ id, title: `video-${id}` })),
  pagination: { page: current, pages, total, size: 20 },
});

function createChannel(cate = "ai-duanju", sort = "latest") {
  const slots = [], updates = [], effects = [], requests = [];
  let cursor = 0, output, unmounted = false, updatesAfterUnmount = 0;
  let props = { cate, sort };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        const slot = { value: typeof initial === "function" ? initial() : initial };
        slot.set = (update) => {
          if (unmounted) { updatesAfterUnmount += 1; return; }
          updates.push(() => {
            const next = typeof update === "function" ? update(slot.value) : update;
            const changed = !Object.is(next, slot.value);
            slot.value = next;
            return changed;
          });
        };
        slots[index] = slot;
      }
      return [slots[index].value, slots[index].set];
    },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useCallback(fn, deps) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { deps, fn };
      return slots[index].fn;
    },
    useEffect(create, deps) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) {
        const previous = slots[index];
        const slot = { deps, effect: true };
        slots[index] = slot;
        effects.push({ previous, slot, create });
      }
    },
  };
  const invoke = (command, args) => {
    if (command === "debug_log") return Promise.resolve();
    assert.equal(command, "api_category");
    return new Promise((resolve, reject) => requests.push({ args: plain(args), resolve, reject }));
  };
  const api = load(apiSource, { "@tauri-apps/api/core": { invoke } }, {
    __APP_VERSION__: "test",
    navigator: { userAgent: "iPhone", maxTouchPoints: 5 },
  });
  const { useChannelVideos } = load(hookSource, { react, "../api": api });

  function render() {
    assert(!unmounted, "Unexpected render after unmount");
    cursor = 0;
    output = useChannelVideos(props.cate, props.sort);
    const pendingEffects = effects.splice(0);
    for (const effect of pendingEffects) effect.previous?.cleanup?.();
    for (const effect of pendingEffects) effect.slot.cleanup = effect.create();
  }
  function flush() {
    let renders = 0;
    while (updates.length) {
      assert(++renders < 50, "Unexpected render loop");
      let changed = false;
      for (const update of updates.splice(0)) changed = update() || changed;
      if (changed) render();
    }
  }
  async function settle() {
    // Flush invoke -> call -> hook continuations, including batched state updates.
    for (let round = 0; round < 12; round += 1) { await Promise.resolve(); flush(); }
  }
  function unmount() {
    if (unmounted) return;
    flush();
    unmounted = true;
    for (const slot of slots) if (slot.effect) slot.cleanup?.();
  }
  render();
  flush();
  return {
    requests, flush, settle, unmount,
    get state() { return output; },
    get updatesAfterUnmount() { return updatesAfterUnmount; },
    update(next) { props = { ...props, ...next }; render(); flush(); },
    loadMore() { output.loadMore(); flush(); },
    refresh() { output.refresh(); flush(); },
    async resolve(index, response) { requests[index].resolve(response); await settle(); },
    async reject(index, error) { requests[index].reject(error); await settle(); },
  };
}

const cases = [];
function test(name, run) { cases.push({ name, run }); }

test("latest/hot_window/random reach the real API invoke boundary", async () => {
  for (const sort of ["latest", "hot_window", "random"]) {
    const channel = createChannel("ai-duanju", sort);
    try {
      assert.equal(channel.requests.length, 1);
      assert.deepEqual(channel.requests[0].args, { cate: "ai-duanju", page: 1, size: 20, sort });
      await channel.resolve(0, page([3, 1, 2], 1, 4, 73));
      assert.deepEqual(ids(channel.state), [3, 1, 2], "Preserve server order");
      assert.equal(channel.state.total, 73);
      assert.equal(channel.state.loading, false);
    } finally { channel.unmount(); }
  }
});

test("sort switches ignore stale successes and errors while keeping the new request busy", async () => {
  const channel = createChannel();
  try {
    channel.update({ sort: "hot_window" });
    channel.update({ sort: "random" });
    assert.equal(channel.requests.length, 3);
    await channel.resolve(0, page([11], 8, 8, 111));
    await channel.reject(1, "old request failed");
    assert.deepEqual(ids(channel.state), []);
    assert.equal(channel.state.page, 0);
    assert.equal(channel.state.pages, 1);
    assert.equal(channel.state.total, 0);
    assert.equal(channel.state.error, "");
    assert.equal(channel.state.loading, true);
    channel.loadMore();
    assert.equal(channel.requests.length, 3, "Stale finally must not unlock the active request");
    await channel.resolve(2, page([90], 1, 4, 70));
    assert.deepEqual(ids(channel.state), [90]);
    assert.equal(channel.state.page, 1);
    assert.equal(channel.state.pages, 4);
    assert.equal(channel.state.total, 70);
    assert.equal(channel.state.loading, false);
  } finally { channel.unmount(); }
});

test("pagination deduplicates within/across pages and suppresses duplicate/terminal loads", async () => {
  const channel = createChannel();
  try {
    await channel.resolve(0, page([2, 2, 1], 1, 2, 4));
    assert.deepEqual(ids(channel.state), [2, 1]);
    channel.state.loadMore();
    channel.state.loadMore();
    channel.flush();
    assert.equal(channel.requests.length, 2);
    assert.equal(channel.requests[1].args.page, 2);
    await channel.resolve(1, page([1, 3, 3, 4], 2, 2, 4));
    assert.deepEqual(ids(channel.state), [2, 1, 3, 4]);
    assert.equal(channel.state.hasMore, false);
    channel.loadMore();
    assert.equal(channel.requests.length, 2);
  } finally { channel.unmount(); }
});

test("a failed later page retries the same page and preserves the loaded list", async () => {
  const channel = createChannel("ai-duanju", "hot_window");
  try {
    await channel.resolve(0, page([1]));
    channel.loadMore();
    await channel.reject(1, "temporary failure");
    assert.deepEqual(ids(channel.state), [1]);
    assert.equal(channel.state.page, 1);
    assert.equal(channel.state.error, "temporary failure");
    assert.equal(channel.state.loading, false);
    channel.loadMore();
    assert.deepEqual(channel.requests[2].args, channel.requests[1].args);
    assert.equal(channel.requests[2].args.page, 2);
    assert.equal(channel.state.error, "");
    await channel.resolve(2, page([2], 2));
    assert.deepEqual(ids(channel.state), [1, 2]);
    assert.equal(channel.state.page, 2);
    channel.loadMore();
    assert.equal(channel.requests[3].args.page, 3);
  } finally { channel.unmount(); }
});

test("an initial failure can retry page one", async () => {
  const channel = createChannel();
  try {
    await channel.reject(0, "initial failure");
    assert.equal(channel.state.page, 0);
    assert.equal(channel.state.hasMore, true);
    channel.loadMore();
    assert.equal(channel.requests[1].args.page, 1);
    await channel.resolve(1, page([9], 1, 1, 1));
    assert.deepEqual(ids(channel.state), [9]);
    assert.equal(channel.state.error, "");
    assert.equal(channel.state.hasMore, false);
  } finally { channel.unmount(); }
});

test("refresh/change-batch requests page one and ignores an in-flight older page", async () => {
  for (const sort of ["latest", "hot_window", "random"]) {
    const channel = createChannel("ai-duanju", sort);
    try {
      await channel.resolve(0, page([1], 1, 4));
      channel.loadMore();
      await channel.resolve(1, page([2], 2, 4));
      channel.loadMore();
      assert.equal(channel.requests[2].args.page, 3);
      channel.refresh();
      assert.deepEqual(channel.requests[3].args, { cate: "ai-duanju", page: 1, size: 20, sort });
      assert.deepEqual(ids(channel.state), []);
      await channel.resolve(2, page([3], 3, 4));
      assert.deepEqual(ids(channel.state), []);
      assert.equal(channel.state.loading, true);
      await channel.resolve(3, page([100], 1, 2));
      assert.deepEqual(ids(channel.state), [100]);
      assert.equal(channel.state.page, 1);
      assert.equal(channel.state.pages, 2);
    } finally { channel.unmount(); }
  }
});

test("changing the category ignores its predecessor's response", async () => {
  const channel = createChannel("old-channel", "random");
  try {
    channel.update({ cate: "new-channel" });
    assert.deepEqual(channel.requests[1].args, { cate: "new-channel", page: 1, size: 20, sort: "random" });
    await channel.resolve(1, page([12]));
    await channel.resolve(0, page([99]));
    assert.deepEqual(ids(channel.state), [12]);
    assert.equal(channel.state.loading, false);
  } finally { channel.unmount(); }
});

test("unmount ignores both successful and failed responses without state updates", async () => {
  for (const fails of [false, true]) {
    const channel = createChannel();
    const before = plain(channel.state);
    channel.unmount();
    if (fails) await channel.reject(0, "late failure");
    else await channel.resolve(0, page([99]));
    assert.equal(channel.updatesAfterUnmount, 0);
    assert.deepEqual(plain(channel.state), before);
    channel.loadMore();
    assert.equal(channel.requests.length, 1);
  }
});

(async () => {
  let failures = 0;
  for (const { name, run } of cases) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures += 1; console.error(`FAIL ${name}\n`, error); }
  }
  console.log(`\n${cases.length - failures}/${cases.length} channel regression tests passed`);
  if (failures) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
