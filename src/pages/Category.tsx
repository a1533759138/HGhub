import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { VideoCard } from "../types";
import { useStore } from "../store";
import { Masonry, RowCard } from "../components/cards";
import { Empty } from "../components/ui";
import { IBack, IBookmark, IChevR, IGrid, ITrophy } from "../icons";

export const CHANNELS = [
  { cate: "ai-duanju", name: "AI成人短剧", desc: "高能反转 · 一口气看完" },
] as const;

/** 热门题材标签（与官网分类页标签栏一致） */
const HOT_TAGS = ["都市", "逆袭", "古风", "系统", "后宫", "校园", "仙侠", "职场", "大男主", "御姐", "脑洞", "奇幻"];

/* ================= 分类总览（只保留 AI成人短剧） ================= */
export default function Category({ wide }: { wide: boolean }) {
  const { push } = useStore();
  const [rows, setRows] = useState<Record<string, VideoCard[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const entries = await Promise.all(
        CHANNELS.map(async (c) => {
          try {
            const res = await api.category(c.cate, 1, 8);
            return [c.cate, res?.items || []] as const;
          } catch {
            return [c.cate, [] as VideoCard[]] as const;
          }
        }),
      );
      if (!alive) return;
      setRows(Object.fromEntries(entries));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="absolute inset-0 bg-bg flex flex-col">
      <div className="shrink-0 px-4 pb-1" style={{ paddingTop: "calc(var(--sat, 0px) + 14px)" }}>
        <div className="flex items-end gap-2.5">
          <span className="text-[24px] font-bold text-on leading-none">分类</span>
          <span className="text-[11px] text-mut pb-0.5">精选 AI 成人短剧 · 每周持续上新</span>
        </div>
      </div>

      <div className="flex-1 scroll-y pb-24 pt-2">
        {/* 排行榜 + 专题入口 */}
        <div className="mx-4 mb-4 flex gap-2.5">
          <button onClick={() => push({ kind: "ranks" })}
            className="flex-1 flex items-center gap-3 rounded-(--r-md) bg-s2 p-3.5 text-left pressable elev-1">
            <span className="w-10 h-10 rounded-(--r-sm) bg-pc text-on-pc flex items-center justify-center shrink-0"><ITrophy size={20} /></span>
            <span className="flex-1">
              <span className="block text-[14.5px] font-semibold text-on">排行榜</span>
              <span className="block text-[10.5px] text-mut mt-0.5">最热 · 高分 · 最新</span>
            </span>
            <IChevR size={16} className="text-mut" />
          </button>
          <button onClick={() => push({ kind: "topics" })}
            className="flex-1 flex items-center gap-3 rounded-(--r-md) bg-s2 p-3.5 text-left pressable elev-1">
            <span className="w-10 h-10 rounded-(--r-sm) bg-pc text-on-pc flex items-center justify-center shrink-0"><IBookmark size={20} /></span>
            <span className="flex-1">
              <span className="block text-[14.5px] font-semibold text-on">专题</span>
              <span className="block text-[10.5px] text-mut mt-0.5">精选合集</span>
            </span>
            <IChevR size={16} className="text-mut" />
          </button>
        </div>

        {CHANNELS.map((c, ci) => {
          const list = rows[c.cate] || [];
          return (
            <section key={c.cate} className="mb-5 a-rise" style={{ animationDelay: `${Math.min(ci * 50, 300)}ms` }}>
              <button onClick={() => push({ kind: "channel", cate: c.cate, name: c.name })}
                className="w-full flex items-center gap-2.5 px-4 mb-2.5 text-left pressable group">
                <span className="w-[36px] h-[36px] rounded-(--r-sm) tonal flex items-center justify-center shrink-0 text-primary">
                  <IGrid size={19} strokeWidth={1.9} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15.5px] font-semibold text-on leading-tight">{c.name}</span>
                  <span className="block text-[10.5px] text-mut mt-0.5 truncate">{c.desc}</span>
                </span>
                <span className="flex items-center gap-0.5 text-[11.5px] text-mut group-hover:text-primary transition-colors">
                  全部<IChevR size={14} />
                </span>
              </button>
              <div className="scroll-x flex gap-2.5 px-4 snap-x">
                {list.map((v) => (
                  <RowCard key={v.id} v={v} onOpen={() => push({ kind: "feed", videoIds: list.map((x) => x.id), index: list.findIndex((x) => x.id === v.id), title: c.name })} />
                ))}
                {!list.length && <div className="h-[150px] flex items-center text-[11.5px] text-dim px-1">{loading ? "加载中…" : "暂无内容"}</div>}
              </div>
            </section>
          );
        })}

        <div className="px-4 text-center text-[10.5px] text-dim pt-1">— 已展示全部频道 —</div>
      </div>
      {wide && <div />}
    </div>
  );
}

/* ================= 频道详情页 ================= */
export function ChannelPage({ cate, name, onBack, wide }: { cate: string; name: string; onBack: () => void; wide: boolean }) {
  const { push } = useStore();
  const [sort, setSort] = useState<"最近更新" | "当前热播" | "精选推荐">("最近更新");
  const [tag, setTag] = useState<string | null>(null);
  const [items, setItems] = useState<VideoCard[]>([]);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const busy = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const loadMore = async () => {
    if (busy.current || page >= pages) return;
    busy.current = true;
    setLoading(true);
    try {
      const next = page + 1;
      const res = await api.category(cate, next, 20);
      setItems((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...(res?.items || []).filter((x) => !seen.has(x.id))];
      });
      setPage(next);
      setPages(res?.pagination?.pages || next);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message || "加载失败");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  useEffect(() => { loadMore(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) loadMore(); }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pages]);

  const sorted = [...items].sort((a, b) => {
    if (sort === "当前热播") return (b.hot || 0) - (a.hot || 0);
    if (sort === "精选推荐") return (b.score || 0) - (a.score || 0);
    // 最近更新：优先 last_ep_at / new_at，两者都为 0 时退回 created_at
    const at = (x: VideoCard) => {
      const ep = x.last_ep_at || 0;
      if (ep > 0) return ep;
      const nw = x.new_at || 0;
      if (nw > 0) return nw;
      return x.created_at ? new Date(x.created_at.replace(" ", "T")).getTime() : 0;
    };
    return at(b) - at(a);
  });

  // 标签筛选：本地按 tags 字段过滤
  const filtered = tag ? sorted.filter((v) => (v.tags || []).some((t) => t === tag)) : sorted;

  return (
    <div className="absolute inset-0 bg-bg flex flex-col">
      <div className="shrink-0 bg-s1" style={{ paddingTop: "var(--sat, 0px)" }}>
        <div className="px-3 pt-2 pb-3 flex items-center gap-2.5">
          <button onClick={onBack} className="w-10 h-10 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable"><IBack size={20} /></button>
          <span className="w-[40px] h-[40px] rounded-(--r-sm) bg-pc text-on-pc flex items-center justify-center"><IGrid size={21} strokeWidth={1.9} /></span>
          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-bold text-on leading-tight">{name}</div>
            <div className="text-[10.5px] text-mut">共 {filtered.length} 部 · 已加载 {page}/{Math.max(pages, 1)} 页</div>
          </div>
        </div>
        <div className="px-4 pb-3 flex gap-2">
          {(["最近更新", "当前热播", "精选推荐"] as const).map((s) => (
            <button key={s} onClick={() => setSort(s)}
              className={`px-4 h-8 rounded-(--r-ctl) text-[12px] font-semibold pressable ${sort === s ? "tonal text-on-sec" : "bg-s3 text-mut"}`}
              style={sort === s ? { background: "var(--p-sec)", color: "var(--p-primary)" } : undefined}>{s}</button>
          ))}
        </div>
        {/* 热门题材标签筛选 */}
        <div className="px-4 pb-3">
          <div className="flex gap-2 overflow-x-auto scroll-x" style={{ scrollbarWidth: "none" }}>
            <button onClick={() => setTag(null)}
              className={`shrink-0 px-3.5 h-7 rounded-(--r-ctl) text-[11.5px] font-semibold pressable ${tag === null ? "bg-primary text-on-primary elev-1" : "bg-s3 text-mut"}`}>全部</button>
            {HOT_TAGS.map((t) => (
              <button key={t} onClick={() => setTag(tag === t ? null : t)}
                className={`shrink-0 px-3.5 h-7 rounded-(--r-ctl) text-[11.5px] font-semibold pressable ${tag === t ? "bg-primary text-on-primary elev-1" : "bg-s3 text-mut"}`}>{t}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1 scroll-y px-4 pt-3 pb-8">
        {filtered.length ? (
          <Masonry videos={filtered} wide={wide} onOpen={(v) => push({ kind: "feed", videoIds: filtered.map((x) => x.id), index: filtered.findIndex((x) => x.id === v.id), title: name })} />
        ) : err ? (
          <Empty icon={<IGrid size={26} />} title="加载失败" sub={err} action="重试" onAction={loadMore} />
        ) : (
          <div className="flex justify-center py-10"><div className="w-8 h-8 spinner" /></div>
        )}
        <div ref={sentinel} className="h-10" />
        {loading && <div className="flex justify-center py-3"><div className="w-6 h-6 spinner" /></div>}
        {!loading && page >= pages && filtered.length > 0 && (
          <div className="text-center text-[10.5px] text-dim py-3">— 已经到底啦 —</div>
        )}
      </div>
    </div>
  );
}