import { useCallback, useEffect, useRef, useState } from "react";
import { api, type HomeData, type HomeVideo } from "../api";
import type { RankItem, Topic, VideoCard } from "../types";
import { useStore } from "../store";
import { RankRow, RowCard } from "../components/cards";
import { Empty, Img } from "../components/ui";
import { IBookmark, IRefresh, ISearch, ITrophy } from "../icons";

const CATE = "ai-duanju";
const HOME_TAGS = ["现代", "都市", "乱伦", "大男主", "熟女", "后宫", "绿帽", "母子", "系统", "校园", "古风", "职场", "逆袭", "奇幻", "甜宠", "脑洞", "单女主", "ntr", "穿越", "年下"];
const RANK_TABS = [
  { key: "hot", label: "热播榜" },
  { key: "recommend", label: "推荐榜" },
  { key: "potential", label: "飙升榜" },
] as const;
type RankKind = (typeof RANK_TABS)[number]["key"];

let homeDataRequest: Promise<HomeData> | null = null;
function getHomeData() {
  if (!homeDataRequest) {
    homeDataRequest = api.home().catch((error) => { homeDataRequest = null; throw error; });
  }
  return homeDataRequest;
}

function asVideoCards(items: HomeVideo[] = []): VideoCard[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    cover: item.cover,
    description: item.description,
    tags: item.tags || [],
    score: Number(item.score) || 0,
    episode_count: Number(item.episode_count) || 0,
    total_episodes: Number(item.total_episodes) || (item.is_finished ? Number(item.episode_count) || 0 : 0),
    duration: item.duration,
    hot: Number(item.hot) || 0,
    like_count: Number(item.like_count) || 0,
    collect_count: Number(item.collect_count) || 0,
    comment_count: Number(item.comment_count) || 0,
    is_finished: !!item.is_finished,
    is_original: Number(item.is_original) || (item.badge === "黄果原创" ? 1 : 0),
    created_at: item.created_at || item.play_at,
    last_ep_at: item.last_ep_at,
    new_at: item.new_at,
    author: item.author,
  }));
}

type LazyListState<T> = { items: T[] | null; loading: boolean; error: string };

/** 分区进入首页滚动视口附近时再取数；离开首页会停掉观察器。 */
function useLazyList<T>(active: boolean, root: HTMLDivElement | null, fetcher: () => Promise<T[]>) {
  const target = useRef<HTMLElement>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const busy = useRef(false);
  const [state, setState] = useState<LazyListState<T>>({ items: null, loading: false, error: "" });

  const load = useCallback(async (retry = false) => {
    if (busy.current || (!retry && state.items !== null)) return;
    busy.current = true;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const items = await fetcherRef.current();
      setState({ items: Array.isArray(items) ? items : [], loading: false, error: "" });
    } catch (e) {
      setState((prev) => ({ ...prev, items: [], loading: false, error: (e as Error).message || "加载失败" }));
    } finally {
      busy.current = false;
    }
  }, [state.items]);

  useEffect(() => {
    const el = target.current;
    if (!active || !root || !el || state.items !== null) return;
    if (typeof IntersectionObserver === "undefined") {
      void load();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        void load();
      }
    }, { root, rootMargin: "240px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, root, state.items, load]);

  return { target, ...state, retry: () => { void load(true); } };
}

function HomeVideoSection({ title, subtitle, active, root, fetcher, onMore }: {
  title: string;
  subtitle?: string;
  active: boolean;
  root: HTMLDivElement | null;
  fetcher: () => Promise<VideoCard[]>;
  onMore?: () => void;
}) {
  const { push } = useStore();
  const list = useLazyList(active, root, fetcher);
  const items = list.items || [];
  const ids = items.map((v) => v.id);

  return (
    <section ref={list.target} className="mb-6">
      <div className="px-4 mb-2.5 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-bold text-on leading-tight">{title}</h2>
          {subtitle && <p className="text-[10.5px] text-mut mt-0.5">{subtitle}</p>}
        </div>
        {onMore && <button onClick={onMore} className="shrink-0 text-[11px] text-mut pressable">全部 ›</button>}
      </div>
      {items.length ? (
        <div className="scroll-x flex gap-2.5 px-4 snap-x">
          {items.map((v) => <RowCard key={v.id} v={v} onOpen={() => push({ kind: "feed", videoIds: ids, index: ids.indexOf(v.id), title })} />)}
        </div>
      ) : list.loading || list.items === null ? (
        <div className="mx-4 h-[148px] rounded-(--r-md) bg-s2 flex items-center justify-center text-[11px] text-dim">
          {list.loading ? <span className="spinner w-6 h-6" /> : "向下浏览时自动加载"}
        </div>
      ) : (
        <div className="mx-4 h-[110px] rounded-(--r-md) bg-s2 flex flex-col items-center justify-center gap-2 text-[11px] text-mut">
          <span>{list.error || "暂无内容"}</span>
          {list.error && <button onClick={list.retry} className="text-primary pressable">点击重试</button>}
        </div>
      )}
    </section>
  );
}

function TopicsSection({ active, root, onMore }: { active: boolean; root: HTMLDivElement | null; onMore: () => void }) {
  const { push } = useStore();
  const fetchTopics = useCallback(async () => (await getHomeData()).topic_rec || [], []);
  const list = useLazyList(active, root, fetchTopics);
  const topics = list.items || [];
  return (
    <section ref={list.target} className="mb-6">
      <div className="px-4 mb-2.5 flex items-center gap-2">
        <h2 className="flex-1 text-[15px] font-bold text-on">专题推荐</h2>
        <button onClick={onMore} className="text-[11px] text-mut pressable">全部 ›</button>
      </div>
      {topics.length ? (
        <div className="scroll-x flex gap-2.5 px-4 snap-x">
          {topics.map((topic) => (
            <button key={topic.id} onClick={() => push({ kind: "topic", slug: topic.slug, name: topic.title })}
              className="w-[184px] shrink-0 text-left snap-start pressable">
              <div className="relative h-[104px] overflow-hidden rounded-(--r-sm) bg-s2">
                <Img src={topic.cover || ""} />
                <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 to-transparent" />
                <span className="absolute inset-x-2 bottom-2 text-[12px] text-white font-semibold clamp-2">{topic.title}</span>
              </div>
              <div className="mt-1 text-[10px] text-mut">{topic.video_count ? `${topic.video_count} 部` : "精选合集"}</div>
            </button>
          ))}
        </div>
      ) : list.loading || list.items === null ? (
        <div className="mx-4 h-[120px] rounded-(--r-md) bg-s2 flex items-center justify-center text-[11px] text-dim">
          {list.loading ? <span className="spinner w-6 h-6" /> : "向下浏览时自动加载"}
        </div>
      ) : (
        <div className="mx-4 h-[92px] rounded-(--r-md) bg-s2 flex items-center justify-center gap-2 text-[11px] text-mut">
          <span>{list.error || "暂无专题"}</span>
          {list.error && <button onClick={list.retry} className="text-primary pressable">重试</button>}
        </div>
      )}
    </section>
  );
}

function RankingsSection({ active, root, onMore }: { active: boolean; root: HTMLDivElement | null; onMore: () => void }) {
  const { push } = useStore();
  const [visible, setVisible] = useState(false);
  const [tab, setTab] = useState<RankKind>("hot");
  const [itemsByKind, setItemsByKind] = useState<Partial<Record<RankKind, RankItem[]>>>({});
  const [loadingByKind, setLoadingByKind] = useState<Partial<Record<RankKind, boolean>>>({});
  const [errorByKind, setErrorByKind] = useState<Partial<Record<RankKind, string>>>({});
  const inFlight = useRef(new Set<RankKind>());
  const cache = useRef(new Set<RankKind>());
  const section = useRef<HTMLElement>(null);

  const loadRank = useCallback((kind: RankKind, retry = false) => {
    if (inFlight.current.has(kind) || (!retry && cache.current.has(kind))) return;
    inFlight.current.add(kind);
    setLoadingByKind((prev) => ({ ...prev, [kind]: true }));
    setErrorByKind((prev) => ({ ...prev, [kind]: "" }));
    api.rank(kind).then((res) => {
      const items = Array.isArray(res?.items) ? res.items : [];
      cache.current.add(kind);
      setItemsByKind((prev) => ({ ...prev, [kind]: items }));
    }).catch((e) => {
      setErrorByKind((prev) => ({ ...prev, [kind]: (e as Error).message || "榜单加载失败" }));
    }).finally(() => {
      inFlight.current.delete(kind);
      setLoadingByKind((prev) => ({ ...prev, [kind]: false }));
    });
  }, []);

  useEffect(() => {
    const el = section.current;
    if (!active || !root || !el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { root, rootMargin: "240px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, root]);

  useEffect(() => { if (active && visible) loadRank(tab); }, [active, visible, tab, loadRank]);

  const items = itemsByKind[tab] || [];
  const ids = items.map((item) => item.video_id);
  const metricMax = Math.max(1, ...items.map((item) => Number(item.metric_value) || 0));
  const loading = !!loadingByKind[tab];
  const error = errorByKind[tab] || "";

  return (
    <section ref={section} className="mb-7 px-4">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex-1 text-[15px] font-bold text-on">排行榜</span>
        <button onClick={onMore} className="text-[11px] text-mut pressable">全部 ›</button>
      </div>
      <div role="tablist" aria-label="首页排行榜" className="mb-2.5 flex gap-1 rounded-(--r-ctl) bg-s3 p-1">
        {RANK_TABS.map((item) => (
          <button key={item.key} role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)}
            className={`flex-1 h-8 rounded-(--r-ctl) text-[12px] font-semibold pressable ${tab === item.key ? "tonal text-on-sec elev-1" : "text-mut"}`}
            style={tab === item.key ? { background: "var(--p-sec)", color: "var(--p-primary)" } : undefined}>{item.label}</button>
        ))}
      </div>
      {loading ? <div className="flex justify-center py-8"><div className="w-7 h-7 spinner" /></div>
        : items.length ? items.slice(0, 5).map((item, index) => (
          <RankRow key={`${item.video_id}-${item.rank}`} item={item} metricMax={metricMax}
            onOpen={() => push({ kind: "feed", videoIds: ids, index, title: `排行榜 · ${RANK_TABS.find((entry) => entry.key === tab)!.label}` })} />
        )) : (
          <Empty icon={<ITrophy size={25} />} title={error ? "榜单加载失败" : "榜单暂时为空"}
            sub={error || "稍后再试"} action="重试" onAction={() => loadRank(tab, true)} />
        )}
    </section>
  );
}

export default function Home({ active, bottomInset }: { active: boolean; bottomInset: number }) {
  const { push, setTab } = useStore();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);

  const fetchOriginal = useCallback(async () => {
    const res = await api.category(CATE, 1, 50, "latest", true);
    return (res?.items || []).filter((item) => item.is_original === 1).slice(0, 12);
  }, []);
  const fetchFeatured = useCallback(async () => (await api.homeFeatured())?.items || [], []);
  const fetchLatest = useCallback(async () => asVideoCards((await getHomeData()).latest || []), []);
  const fetchHot = useCallback(async () => asVideoCards((await getHomeData()).featured || []), []);

  return (
    <div className="absolute inset-0 bg-bg flex flex-col">
      <div className="shrink-0 px-4 pb-1" style={{ paddingTop: "calc(var(--sat, 0px) + 12px)" }}>
        <div className="flex items-center gap-2.5">
          <span className="text-[24px] font-bold text-on leading-none">黄果短剧</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => push({ kind: "topics" })} aria-label="专题"
              className="w-10 h-10 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable"><IBookmark size={18} /></button>
            <button onClick={() => setTab("search")} aria-label="搜索"
              className="w-10 h-10 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable"><ISearch size={18} /></button>
          </div>
        </div>
      </div>

      <div ref={setRoot} className="flex-1 min-h-0 scroll-y pt-2" style={{ paddingBottom: `calc(${bottomInset}px + 20px)` }}>
        <section className="mb-5">
          <div className="px-4 mb-2.5 flex items-center gap-2">
            <h2 className="flex-1 text-[15px] font-bold text-on">热门标签</h2>
            <span className="text-[10px] text-mut">按题材筛选</span>
          </div>
          <div className="px-4 flex flex-wrap gap-2">
            {HOME_TAGS.map((tag) => (
              <button key={tag} onClick={() => push({ kind: "channel", cate: CATE, name: tag, tag })}
                className="px-3 h-8 rounded-full bg-s2 text-[11.5px] text-on pressable">{tag}</button>
            ))}
          </div>
        </section>

        <HomeVideoSection title="黄果原创" subtitle="本站自制原创短剧与漫剧" active={active} root={root} fetcher={fetchOriginal}
          onMore={() => push({ kind: "channel", cate: CATE, name: "黄果原创", originalOnly: true })} />
        <HomeVideoSection title="精选推荐" subtitle="官网首页精选内容" active={active} root={root} fetcher={fetchFeatured} />
        <HomeVideoSection title="最近上新" subtitle="最新上架与更新" active={active} root={root} fetcher={fetchLatest}
          onMore={() => push({ kind: "channel", cate: CATE, name: "最近上新", sort: "latest" })} />
        <HomeVideoSection title="热播短剧" subtitle="全站近期热播作品" active={active} root={root} fetcher={fetchHot}
          onMore={() => push({ kind: "channel", cate: CATE, name: "热播短剧", sort: "hot" })} />
        <TopicsSection active={active} root={root} onMore={() => push({ kind: "topics" })} />
        <RankingsSection active={active} root={root} onMore={() => push({ kind: "ranks" })} />
      </div>
    </div>
  );
}
