import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { RankItem, VideoCard } from "../types";
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

/* ================= 排行榜（沿用上游榜单顺序与指标） ================= */
const RANK_TABS = [
  { k: "hot", label: "热播榜", desc: "热门剧集" },
  { k: "recommend", label: "推荐榜", desc: "精选推荐" },
  { k: "potential", label: "飙升榜", desc: "人气上升" },
] as const;

type RankKind = (typeof RANK_TABS)[number]["k"];

export function RankPage({ onBack, wide }: { onBack: () => void; wide: boolean }) {
  const { push } = useStore();
  const [tab, setTab] = useState<RankKind>("hot");
  const [items, setItems] = useState<RankItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setItems([]);
    setErr("");
    api.rank(tab)
      .then((res) => { if (alive) setItems(res?.items || []); })
      .catch((e) => { if (alive) setErr((e as Error).message || "榜单加载失败"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tab, attempt]);

  const maxMetric = Math.max(1, ...items.map((x) => Number(x.metric_value) || 0));
  const meta = RANK_TABS.find((t) => t.k === tab)!;
  const ids = items.map((x) => x.video_id);

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
              <div className="text-[11px] text-mut mt-1">{meta.desc}</div>
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
        ) : items.length ? (
          items.map((item, i) => (
            <RankRow key={`${item.video_id}-${item.rank}`} item={item} metricMax={maxMetric}
              onOpen={() => push({ kind: "feed", videoIds: ids, index: i, title: `排行榜 · ${meta.label}` })} />
          ))
        ) : (
          <Empty icon={<ITrophy size={26} />} title={err ? "榜单加载失败" : "榜单暂时为空"}
            sub={err || "稍后再来看看，或者换个榜单"} action="重试" onAction={() => setAttempt((n) => n + 1)} />
        )}
        {wide && <div className="h-2" />}
      </div>
    </div>
  );
}
