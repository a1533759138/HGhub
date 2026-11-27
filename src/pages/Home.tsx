import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { VideoCard } from "../types";
import { useStore } from "../store";
import { Masonry } from "../components/cards";
import { Empty } from "../components/ui";
import { IBookmark, ISearch, ITrophy } from "../icons";

/** 首页三个标签：与上游 AI成人短剧分类页的排序方式一致 */
const HOME_TABS = [
  { k: "最近更新", desc: "最新上架" },
  { k: "当前热播", desc: "热度最高" },
  { k: "精选推荐", desc: "高分口碑" },
] as const;

type SortKey = (typeof HOME_TABS)[number]["k"];

/** 热门题材标签（与官网分类页标签栏一致） */
const HOT_TAGS = ["都市", "逆袭", "古风", "系统", "后宫", "校园", "仙侠", "职场", "大男主", "御姐", "脑洞", "奇幻"];

const CATE = "ai-duanju";

/** 客户端排序：最近更新按时间、热播按 hot、推荐按 score */
function sortItems(items: VideoCard[], key: SortKey): VideoCard[] {
  const arr = [...items];
  if (key === "当前热播") return arr.sort((a, b) => (b.hot || 0) - (a.hot || 0));
  if (key === "精选推荐") return arr.sort((a, b) => (b.score || 0) - (a.score || 0));
  const at = (x: VideoCard) => {
    const ep = x.last_ep_at || 0;
    if (ep > 0) return ep;
    const nw = x.new_at || 0;
    if (nw > 0) return nw;
    return x.created_at ? new Date(x.created_at.replace(" ", "T")).getTime() : 0;
  };
  return arr.sort((a, b) => at(b) - at(a));
}

export default function Home({ active, bottomInset }: { active: boolean; bottomInset: number }) {
  const { push, setTab, toast } = useStore();
  const [tab, setTabKey] = useState<SortKey>("最近更新");
  const [tag, setTag] = useState<string | null>(null);
  const [items, setItems] = useState<VideoCard[]>([]);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const busy = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const load = useCallback(async (p: number) => {
    if (busy.current || p > pages) return;
    busy.current = true;
    setLoading(true);
    setErr("");
    try {
      const res = await api.category(CATE, p, 20);
      const list = res?.items || [];
      setItems((prev) => {
        const base = p === 1 ? [] : prev;
        const seen = new Set(base.map((x) => x.id));
        return [...base, ...list.filter((x) => !seen.has(x.id))];
      });
      setPage(p);
      setPages(res?.pagination?.pages || p);
    } catch (e) {
      const msg = (e as Error).message || "加载失败";
      if (!items.length) setErr(msg);
      else toast(msg, "info");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [items.length, pages, toast]);

  // 首次进入加载第一页
  useEffect(() => {
    setItems([]);
    setPage(0);
    setPages(1);
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 无限滚动
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      if (es[0].isIntersecting && !busy.current && page < pages) load(page + 1);
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pages]);

  const sorted = sortItems(items, tab);
  // 标签筛选：本地按 tags 字段过滤（数据已含标签，无需再调接口）
  const filtered = tag ? sorted.filter((v) => (v.tags || []).some((t) => t === tag)) : sorted;
  const ids = filtered.map((v) => v.id);

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
          {HOME_TABS.map((t) => (
            <button key={t.k} onClick={() => setTabKey(t.k)}
              className={`flex-1 h-9 rounded-(--r-ctl) text-[13px] font-semibold transition-all ${tab === t.k ? "tonal text-on-sec elev-1" : "text-mut"}`}
              style={tab === t.k ? { background: "var(--p-sec)", color: "var(--p-primary)" } : undefined}>
              {t.k}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-[11px] text-mut">{HOME_TABS.find((t) => t.k === tab)?.desc} · 共 {filtered.length} 部</span>
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
            onOpen={(v) => push({ kind: "feed", videoIds: ids, index: ids.findIndex((x) => x === v.id), title: `AI成人短剧 · ${tag ? tag + " · " : ""}${tab}` })} />
        ) : err ? (
          <Empty icon={<ISearch size={26} />} title="连不上线路" sub={err}
            action="重试" onAction={() => load(1)} />
        ) : (
          <div className="flex justify-center py-12"><div className="w-8 h-8 spinner" /></div>
        )}
        <div ref={sentinel} className="h-8" />
        {loading && filtered.length > 0 && <div className="flex justify-center py-3"><div className="w-6 h-6 spinner" /></div>}
        {!loading && page >= pages && filtered.length > 0 && (
          <div className="text-center text-[10.5px] text-dim py-3">— 已经到底啦 —</div>
        )}
      </div>
    </div>
  );
}
