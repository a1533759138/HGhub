import { useEffect, useRef, useState } from "react";
import { api, fmt } from "../api";
import type { VideoCard } from "../types";
import { useStore } from "../store";
import { Masonry, RankRow } from "../components/cards";
import { Empty } from "../components/ui";
import { IBack, IClose, IFireF, IRefresh, ISearch, ITrophy } from "../icons";

const HOT_TAGS = ["都市", "逆袭", "古风", "系统", "后宫", "校园", "仙侠", "职场", "大男主", "御姐", "脑洞", "奇幻"];

export default function Search({ active, wide }: { active: boolean; wide: boolean }) {
  const { push, searchHist, addSearch, clearSearchHist, toast } = useStore();
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [items, setItems] = useState<VideoCard[]>([]);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (active && !/Android/i.test(navigator.userAgent)) inputRef.current?.focus();
  }, [active]);

  const run = async (keyword: string, p: number) => {
    if (busy.current) return;
    if (p > pages && p > 1) return;
    busy.current = true;
    setLoading(true);
    try {
      const res = await api.search(keyword, p, 20);
      setItems((prev) => {
        const base = p === 1 ? [] : prev;
        const seen = new Set(base.map((x) => x.id));
        return [...base, ...(res?.items || []).filter((x) => !seen.has(x.id))];
      });
      setPage(p);
      setPages(res?.pagination?.pages || 1);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message || "搜索失败");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  const submit = (keyword: string) => {
    const k = keyword.trim();
    if (!k) return;
    setSubmitted(k);
    addSearch(k);
    setItems([]);
    setPages(1);
    run(k, 1);
  };

  const querying = submitted.length > 0;

  return (
    <div className="absolute inset-0 bg-bg flex flex-col">
      {/* 搜索栏 */}
      <div className="shrink-0 px-4 pb-3 flex items-center gap-2.5" style={{ paddingTop: "calc(var(--sat, 0px) + 12px)" }}>
        <form className="flex-1 flex items-center gap-2 h-11 rounded-(--r-ctl) bg-s3 px-3.5 focus-within:bg-s4 transition-colors"
          onSubmit={(e) => { e.preventDefault(); submit(q); }}>
          <ISearch size={17} className="text-mut shrink-0" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索短剧、作者、题材…"
            className="flex-1 min-w-0 bg-transparent text-[13.5px] text-on placeholder-dim outline-none" />
          {q && <button type="button" onClick={() => { setQ(""); setSubmitted(""); setItems([]); }} className="w-5 h-5 rounded-full bg-s4 flex items-center justify-center text-mut pressable"><IClose size={11} /></button>}
        </form>
        <button onClick={() => push({ kind: "ranks" })} aria-label="排行榜"
          className="w-11 h-11 rounded-(--r-sm) flex items-center justify-center bg-primary text-on-primary pressable elev-2">
          <ITrophy size={19} />
        </button>
      </div>

      <div className="flex-1 scroll-y px-4 pb-24">
        {!querying ? (
          <>
            {searchHist.length > 0 && (
              <div className="mt-1 a-rise">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-on">搜索历史</span>
                  <button onClick={clearSearchHist} className="text-[11px] text-dim pressable">清空</button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {searchHist.map((h) => (
                    <button key={h} onClick={() => { setQ(h); submit(h); }} className="px-3.5 h-8 rounded-(--r-ctl) bg-s3 text-[12px] text-on/80 pressable">{h}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 rounded-(--r-md) bg-s2 p-3.5 a-rise">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-on/90"><IFireF size={15} className="text-primary" />热门题材</span>
                <button onClick={() => push({ kind: "ranks" })} className="text-[11px] text-primary font-semibold pressable">完整榜单 ›</button>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {HOT_TAGS.map((t) => (
                  <button key={t} onClick={() => { setQ(t); submit(t); }}
                    className="px-3 h-7 rounded-(--r-ctl) bg-s3 text-[12px] text-on/85 pressable">{t}</button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between mt-6 mb-2.5">
              <span className="text-[13px] font-bold text-on">为你推荐</span>
              <button onClick={() => submit(HOT_TAGS[Math.floor(Math.random() * HOT_TAGS.length)])}
                className="flex items-center gap-1 text-[11.5px] text-mut pressable"><IRefresh size={13} />换一批</button>
            </div>
            <p className="text-[11.5px] text-dim leading-relaxed">
              输入关键词后按回车搜索，也可以点上面的题材直接看片单。
            </p>
          </>
        ) : (
          <>
            <div className="text-[11.5px] text-mut mt-1 mb-2.5">「{submitted}」共 <span className="text-primary font-bold">{items.length}</span> 条结果</div>
            {items.length ? (
              <>
                <Masonry videos={items} wide={wide} onOpen={(v) => push({ kind: "feed", videoIds: items.map((x) => x.id), index: items.findIndex((x) => x.id === v.id), title: `搜索 · ${submitted}` })} />
                <div className="flex justify-center py-4">
                  {loading ? <div className="w-6 h-6 spinner" />
                    : page < pages ? (
                      <button onClick={() => run(submitted, page + 1)} className="px-5 h-9 rounded-(--r-ctl) bg-s3 text-[12px] text-on/85 pressable">加载更多</button>
                    ) : <span className="text-[10.5px] text-dim">— 已经到底啦 —</span>}
                </div>
              </>
            ) : loading ? (
              <div className="flex justify-center py-12"><div className="w-8 h-8 spinner" /></div>
            ) : (
              <Empty icon={<ISearch size={26} />} title={err || "没有找到相关内容"} sub="换个关键词试试，比如「都市」「逆袭」"
                action="看看热榜" onAction={() => push({ kind: "ranks" })} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ================= 排行榜（客户端自算，保证高分/最热/最新都准确） ================= */
const RANK_TABS = [
  { k: "hot", label: "最热榜", desc: "按播放热度排序" },
  { k: "score", label: "高分榜", desc: "按评分高低排序" },
  { k: "new", label: "最新榜", desc: "按更新时间排序" },
] as const;

type RankKind = (typeof RANK_TABS)[number]["k"];

export function RankPage({ onBack, wide }: { onBack: () => void; wide: boolean }) {
  const { push, toast } = useStore();
  const [tab, setTab] = useState<RankKind>("hot");
  const [all, setAll] = useState<VideoCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const busy = useRef(false);
  const loadedPages = useRef(0);
  const totalPages = useRef(1);

  /* 拉取 AI成人短剧分类的全量数据，本地自算排序（不依赖上游不准的榜单接口） */
  const loadAll = async (reset = false) => {
    if (busy.current) return;
    busy.current = true;
    if (reset) { setLoading(true); setAll([]); loadedPages.current = 0; totalPages.current = 1; }
    else setLoadingMore(true);
    try {
      let page = reset ? 1 : loadedPages.current + 1;
      const first = await api.category("ai-duanju", page, 50);
      let items = [...(first?.items || [])];
      totalPages.current = first?.pagination?.pages || 1;
      // 继续拉取剩余页，凑齐全量（保证「最新」等排序覆盖所有内容）
      while (page < totalPages.current && page < 8) {
        page += 1;
        const r = await api.category("ai-duanju", page, 50);
        items = items.concat(r?.items || []);
      }
      loadedPages.current = page;
      setAll((prev) => {
        const base = reset ? [] : prev;
        const seen = new Set(base.map((x) => x.id));
        return [...base, ...items.filter((x) => !seen.has(x.id))];
      });
    } catch (e) {
      toast((e as Error).message || "榜单加载失败", "info");
    } finally {
      busy.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => { loadAll(true); /* eslint-disable-next-line */ }, []);

  const at = (x: VideoCard) => {
    const ep = x.last_ep_at || 0;
    if (ep > 0) return ep;
    const nw = x.new_at || 0;
    if (nw > 0) return nw;
    return x.created_at ? new Date(x.created_at.replace(" ", "T")).getTime() : 0;
  };

  const sorted = [...all].sort((a, b) => {
    if (tab === "score") return (b.score || 0) - (a.score || 0);
    if (tab === "new") return at(b) - at(a);
    return (b.hot || 0) - (a.hot || 0);
  });

  const metric = (x: VideoCard) =>
    tab === "score" ? x.score : tab === "new" ? at(x) : (x.hot || 0);
  const maxMetric = Math.max(1, ...sorted.map(metric));
  const meta = RANK_TABS.find((t) => t.k === tab)!;
  const ids = sorted.map((x) => x.id);

  return (
    <div className="absolute inset-0 bg-bg flex flex-col">
      <div className="shrink-0 relative overflow-hidden bg-s1" style={{ paddingTop: "var(--sat, 0px)" }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(90% 120% at 100% 0%, var(--p-pc) 0%, transparent 60%)", opacity: 0.32 }} />
        <div className="relative px-3 pt-2 pb-4">
          <button onClick={onBack} className="w-10 h-10 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable"><IBack size={20} /></button>
          <div className="px-2 mt-1 flex items-end justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-(--r-sm) bg-pc text-on-pc flex items-center justify-center"><ITrophy size={20} /></span>
                <span className="text-[24px] font-bold tracking-wide text-on">排行榜</span>
              </div>
              <div className="text-[11px] text-mut mt-1">{meta.desc} · 实时计算</div>
            </div>
          </div>
          <div className="flex bg-s3 rounded-(--r-ctl) p-1 mt-3">
            {RANK_TABS.map((t) => (
              <button key={t.k} onClick={() => setTab(t.k)}
                className={`flex-1 h-8 rounded-(--r-ctl) text-[12px] font-semibold transition-all ${tab === t.k ? "tonal elev-1" : "text-mut"}`}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 scroll-y px-3.5 pt-3 pb-8">
        {loading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 spinner" /></div>
        ) : sorted.length ? (
          <>
            {sorted.map((v, i) => {
              const val = metric(v);
              const label = tab === "score" ? "评分" : tab === "new" ? "更新" : "热度";
              return (
                <RankRow key={v.id}
                  item={{ rank: i + 1, video_id: v.id, title: v.title, cover: v.cover, tags: v.tags, score: v.score, metric_value: val, metric_label: label }}
                  metricMax={maxMetric}
                  onOpen={() => push({ kind: "feed", videoIds: ids, index: i, title: `排行榜 · ${meta.label}` })} />
              );
            })}
            {loadingMore && <div className="flex justify-center py-3"><div className="w-6 h-6 spinner" /></div>}
          </>
        ) : (
          <Empty icon={<ITrophy size={26} />} title="榜单暂时为空" sub="稍后再来看看，或者去首页刷刷推荐" />
        )}
        {wide && <div className="h-2" />}
      </div>
    </div>
  );
}