import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Masonry } from "../components/cards";
import { Empty } from "../components/ui";
import { CHANNEL_SORTS, useChannelVideos, type ChannelSort } from "../hooks/useChannelVideos";
import { IBookmark, IRefresh, ISearch, ITrophy } from "../icons";

/** 热门题材标签（与官网分类页标签栏一致） */
const HOT_TAGS = ["都市", "逆袭", "古风", "系统", "后宫", "校园", "仙侠", "职场", "大男主", "御姐", "脑洞", "奇幻"];

const CATE = "ai-duanju";

export default function Home({ active, bottomInset }: { active: boolean; bottomInset: number }) {
  const { push, setTab } = useStore();
  const [tab, setTabKey] = useState<ChannelSort>("random");
  const [tag, setTag] = useState<string | null>(null);
  const { items, page, pages, total, loading, error, loadMore, refresh, hasMore } = useChannelVideos(CATE, tab);
  const sentinel = useRef<HTMLDivElement>(null);
  const filtered = tag ? items.filter((v) => (v.tags || []).includes(tag)) : items;
  const ids = filtered.map((v) => v.id);
  const tabLabel = CHANNEL_SORTS.find((t) => t.key === tab)!.label;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !active || loading || error || !filtered.length || !hasMore) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) loadMore(); }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [active, loading, error, filtered.length, hasMore, loadMore]);

  return (
    <div className="absolute inset-0 bg-bg flex flex-col">
      {/* 顶栏：标题 + 搜索/排行/专题入口 */}
      <div className="shrink-0 px-4 pb-1" style={{ paddingTop: "calc(var(--sat, 0px) + 12px)" }}>
        <div className="flex items-center gap-2.5">
          <span className="text-[24px] font-bold text-on leading-none">AI成人短剧</span>
          <span className="text-[11px] text-mut">精选热播 · 每周上新</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => push({ kind: "topics" })} aria-label="专题"
              className="w-10 h-10 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable">
              <IBookmark size={18} />
            </button>
            <button onClick={() => push({ kind: "ranks" })} aria-label="排行榜"
              className="w-10 h-10 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable">
              <ITrophy size={19} />
            </button>
            <button onClick={() => setTab("search")} aria-label="搜索"
              className="w-10 h-10 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable">
              <ISearch size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* 三标签栏 */}
      <div className="shrink-0 px-4 pt-2 pb-1">
        <div className="flex bg-s3 rounded-(--r-ctl) p-1">
          {CHANNEL_SORTS.map((t) => (
            <button key={t.key} onClick={() => setTabKey(t.key)}
              className={`flex-1 h-9 rounded-(--r-ctl) text-[13px] font-semibold transition-all ${tab === t.key ? "tonal text-on-sec elev-1" : "text-mut"}`}
              style={tab === t.key ? { background: "var(--p-sec)", color: "var(--p-primary)" } : undefined}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-[11px] text-mut">{CHANNEL_SORTS.find((t) => t.key === tab)?.desc} · 已加载 {items.length}{total ? ` / ${total}` : ""} 部</span>
          <button onClick={refresh} disabled={loading} className="flex items-center gap-1 text-[11px] text-primary disabled:opacity-40 pressable"><IRefresh size={12} />{tab === "random" ? "换一批" : "刷新"}</button>
        </div>
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
            onOpen={(v) => push({ kind: "feed", videoIds: ids, index: ids.findIndex((x) => x === v.id), title: `AI成人短剧 · ${tag ? tag + " · " : ""}${tabLabel}` })} />
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
          <div className="text-center py-3"><button onClick={loadMore} className="px-5 h-9 rounded-(--r-ctl) bg-s3 text-[12px] text-on pressable">{error ? "加载失败，点击重试" : "加载更多"}</button></div>
        )}
        {!loading && page >= pages && filtered.length > 0 && (
          <div className="text-center text-[10.5px] text-dim py-3">— 已经到底啦 —</div>
        )}
      </div>
    </div>
  );
}
