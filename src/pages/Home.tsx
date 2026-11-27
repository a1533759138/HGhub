import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { RankItem } from "../types";
import { useStore } from "../store";
import { Masonry, RankRow } from "../components/cards";
import { Empty } from "../components/ui";
import { useChannelVideos } from "../hooks/useChannelVideos";
import { IBookmark, IRefresh, ISearch, ITrophy } from "../icons";

/** 热门题材标签（与官网分类页标签栏一致） */
const HOT_TAGS = ["都市", "逆袭", "古风", "系统", "后宫", "校园", "仙侠", "职场", "大男主", "御姐", "脑洞", "奇幻"];

const CATE = "ai-duanju";

const HOME_TABS = [
  { key: "hot", label: "热播榜" },
  { key: "recommend", label: "推荐榜" },
  { key: "potential", label: "飙升榜" },
  { key: "random", label: "精选推荐" },
] as const;
type HomeTab = (typeof HOME_TABS)[number]["key"];
type RankKind = Exclude<HomeTab, "random">;

function RandomContent({ active, bottomInset }: { active: boolean; bottomInset: number }) {
  const { push } = useStore();
  const [tag, setTag] = useState<string | null>(null);
  const { items, page, pages, total, loading, error, loadMore, refresh, hasMore } = useChannelVideos(CATE, "random");
  const sentinel = useRef<HTMLDivElement>(null);
  const filtered = tag ? items.filter((v) => (v.tags || []).includes(tag)) : items;
  const ids = filtered.map((v) => v.id);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !active || loading || error || !filtered.length || !hasMore) return;
    let watching = true;
    const io = new IntersectionObserver((es) => { if (watching && es[0].isIntersecting) loadMore(); }, { rootMargin: "300px" });
    io.observe(el);
    return () => { watching = false; io.disconnect(); };
  }, [active, loading, error, filtered.length, hasMore, loadMore]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 px-4 pt-2 pb-2 flex items-center justify-between">
        <span className="text-[11px] text-mut">随机发现好剧 · 已加载 {items.length}{total ? ` / ${total}` : ""} 部</span>
        <button onClick={refresh} disabled={loading || !active} className="flex items-center gap-1 text-[11px] text-primary disabled:opacity-40 pressable"><IRefresh size={12} />换一批</button>
      </div>

      {/* 热门题材标签筛选栏 */}
      <div className="shrink-0 px-4 pb-2">
        <div className="flex gap-2 overflow-x-auto scroll-x" style={{ scrollbarWidth: "none" }}>
          <button onClick={() => setTag(null)}
            className={`shrink-0 px-3.5 h-8 rounded-(--r-ctl) text-[12px] font-semibold pressable ${tag === null ? "bg-primary text-on-primary elev-1" : "bg-s3 text-mut"}`}>全部</button>
          {HOT_TAGS.map((t) => (
            <button key={t} onClick={() => setTag(tag === t ? null : t)}
              className={`shrink-0 px-3.5 h-8 rounded-(--r-ctl) text-[12px] font-semibold pressable ${tag === t ? "bg-primary text-on-primary elev-1" : "bg-s3 text-mut"}`}>{t}</button>
          ))}
        </div>
      </div>

      {/* 瀑布流 */}
      <div className="flex-1 scroll-y px-4 pt-2" style={{ paddingBottom: `calc(${bottomInset}px + 24px)` }}>
        {filtered.length ? (
          <Masonry videos={filtered} wide={false}
            onOpen={(v) => push({ kind: "feed", videoIds: ids, index: ids.findIndex((x) => x === v.id), title: `AI成人短剧 · ${tag ? tag + " · " : ""}精选推荐` })} />
        ) : loading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 spinner" /></div>
        ) : (
          <Empty icon={<ISearch size={26} />} title={error || (tag ? "当前已加载内容暂无匹配" : "暂无内容")}
            sub={error ? "检查线路后重试" : tag && hasMore ? "可以继续加载，或切换题材" : "换个题材或刷新看看"}
            action={error ? "重试" : hasMore ? "继续加载" : "刷新"} onAction={error ? (page ? loadMore : refresh) : hasMore ? loadMore : refresh} />
        )}
        <div ref={sentinel} className="h-8" />
        {loading && filtered.length > 0 && <div className="flex justify-center py-3"><div className="w-6 h-6 spinner" /></div>}
        {!loading && filtered.length > 0 && (hasMore || error) && (
          <div className="text-center py-3"><button onClick={loadMore} disabled={!active} className="px-5 h-9 rounded-(--r-ctl) bg-s3 text-[12px] text-on pressable disabled:opacity-40">{error ? "加载失败，点击重试" : "加载更多"}</button></div>
        )}
        {!loading && page >= pages && filtered.length > 0 && (
          <div className="text-center text-[10.5px] text-dim py-3">— 已经到底啦 —</div>
        )}
      </div>
    </div>
  );
}

/** 首次可见才启动随机请求；之后离开首页保留列表，并停止滚动预取。 */
function RandomSection({ active, bottomInset }: { active: boolean; bottomInset: number }) {
  const [started, setStarted] = useState(active);
  useEffect(() => { if (active) setStarted(true); }, [active]);
  return started ? <RandomContent active={active} bottomInset={bottomInset} /> : null;
}

export default function Home({ active, bottomInset }: { active: boolean; bottomInset: number }) {
  const { push, setTab } = useStore();
  const [tab, setTabKey] = useState<HomeTab>("hot");
  const [revision, setRevision] = useState(0);
  const [ranking, setRanking] = useState<{
    kind: RankKind; revision: number; items: RankItem[]; loading: boolean; error: string;
  }>({ kind: "hot", revision: 0, items: [], loading: true, error: "" });
  const completed = useRef<{ kind: RankKind; revision: number } | null>(null);

  useEffect(() => {
    if (!active || tab === "random") return;
    if (completed.current?.kind === tab && completed.current.revision === revision) return;
    let alive = true;
    setRanking({ kind: tab, revision, items: [], loading: true, error: "" });
    api.rank(tab)
      .then((res) => {
        if (!alive) return;
        completed.current = { kind: tab, revision };
        setRanking({ kind: tab, revision, items: res?.items || [], loading: false, error: "" });
      })
      .catch((e) => {
        if (alive) setRanking({ kind: tab, revision, items: [], loading: false, error: (e as Error).message || "榜单加载失败" });
      });
    return () => { alive = false; };
  }, [active, tab, revision]);

  const rank = ranking.kind === tab && ranking.revision === revision
    ? ranking : { items: [], loading: true, error: "" };
  const ids = rank.items.map((item) => item.video_id);
  const metricMax = Math.max(1, ...rank.items.map((item) => Number(item.metric_value) || 0));
  const label = HOME_TABS.find((item) => item.key === tab)!.label;
  const refreshRanking = () => setRevision((n) => n + 1);

  return (
    <div className="absolute inset-0 bg-bg flex flex-col">
      <div className="shrink-0 px-4 pb-1" style={{ paddingTop: "calc(var(--sat, 0px) + 12px)" }}>
        <div className="flex items-center gap-2.5">
          <span className="text-[24px] font-bold text-on leading-none">AI成人短剧</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => push({ kind: "topics" })} aria-label="专题"
              className="w-10 h-10 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable"><IBookmark size={18} /></button>
            <button onClick={() => setTab("search")} aria-label="搜索"
              className="w-10 h-10 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable"><ISearch size={18} /></button>
          </div>
        </div>
      </div>

      <div className="shrink-0 px-4 pt-2 pb-1">
        <div role="tablist" aria-label="首页内容" className="flex gap-1 overflow-x-auto bg-s3 rounded-(--r-ctl) p-1 scroll-x">
          {HOME_TABS.map((item) => (
            <button key={item.key} role="tab" aria-selected={tab === item.key}
              onClick={() => { if (tab !== item.key) { setTabKey(item.key); setRevision((n) => n + 1); } }}
              className={`flex-1 shrink-0 whitespace-nowrap px-2 h-9 rounded-(--r-ctl) text-[13px] font-semibold transition-all ${tab === item.key ? "tonal text-on-sec elev-1" : "text-mut"}`}
              style={tab === item.key ? { background: "var(--p-sec)", color: "var(--p-primary)" } : undefined}>{item.label}</button>
          ))}
        </div>
      </div>

      {tab === "random" ? <RandomSection active={active} bottomInset={bottomInset} /> : (
        <>
          <div className="shrink-0 px-4 pt-2 pb-2 flex items-center justify-between">
            <span className="text-[11px] text-mut">{label}{rank.items.length ? ` · ${rank.items.length} 部` : ""}</span>
            <button onClick={refreshRanking} disabled={rank.loading || !active} className="flex items-center gap-1 text-[11px] text-primary pressable disabled:opacity-40"><IRefresh size={12} />刷新</button>
          </div>
          <div className="flex-1 scroll-y px-4 pt-2" style={{ paddingBottom: `calc(${bottomInset}px + 24px)` }}>
            {rank.loading ? <div className="flex justify-center py-12"><div className="w-8 h-8 spinner" /></div>
              : rank.items.length ? rank.items.map((item, index) => (
                <RankRow key={`${item.video_id}-${item.rank}`} item={item} metricMax={metricMax}
                  onOpen={() => push({ kind: "feed", videoIds: ids, index, title: `排行榜 · ${label}` })} />
              )) : (
                <Empty icon={<ITrophy size={26} />} title={rank.error ? "榜单加载失败" : "榜单暂时为空"}
                  sub={rank.error || "换个榜单看看，或稍后刷新"} action="重试" onAction={refreshRanking} />
              )}
          </div>
        </>
      )}
    </div>
  );
}
