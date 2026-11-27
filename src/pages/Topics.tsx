import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Topic, VideoCard } from "../types";
import { useStore } from "../store";
import { Masonry } from "../components/cards";
import { Empty, Img } from "../components/ui";
import { IBack, IBookmark } from "../icons";

type PageData<T> = {
  items: T[];
  pagination?: { pages: number; total: number };
  topic?: Topic;
  related?: Topic[];
};

type PageState<T> = {
  resource: string;
  items: T[];
  topic: Topic | null;
  related: Topic[];
  page: number;
  pages: number;
  total: number;
  loading: boolean;
  error: string;
};

const emptyState = <T,>(resource: string): PageState<T> => ({
  resource, items: [], topic: null, related: [], page: 0, pages: 1, total: 0, loading: true, error: "",
});

/** 按需加载下一页；资源变化或卸载后，旧请求不能写回。 */
function useTopicPages<T extends { id: number }>(resource: string, fetchPage: (page: number) => Promise<PageData<T>>) {
  const [state, setState] = useState<PageState<T>>(() => emptyState(resource));
  const loader = useRef(fetchPage);
  loader.current = fetchPage;
  const generation = useRef(0);
  const busy = useRef(false);
  const lastRequest = useRef({ page: 1, replace: true });

  const requestPage = useCallback(async (page: number, replace = false) => {
    if (busy.current) return;
    const version = generation.current;
    busy.current = true;
    lastRequest.current = { page, replace };
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const res = await loader.current(page);
      if (version !== generation.current) return;
      setState((prev) => {
        const items = replace ? [] : [...prev.items];
        const seen = new Set(items.map((item) => item.id));
        for (const item of res.items || []) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          items.push(item);
        }
        return {
          ...prev, items, topic: res.topic || prev.topic, related: res.related ?? prev.related, page,
          pages: Math.max(page, res.pagination?.pages || page),
          total: Math.max(items.length, res.pagination?.total || 0), loading: false, error: "",
        };
      });
    } catch (e) {
      if (version === generation.current) {
        setState((prev) => ({ ...prev, loading: false, error: (e as Error).message || "专题加载失败" }));
      }
    } finally {
      if (version === generation.current) busy.current = false;
    }
  }, []);

  useEffect(() => {
    generation.current += 1;
    busy.current = false;
    setState(emptyState(resource));
    void requestPage(1, true);
    return () => { generation.current += 1; busy.current = false; };
  }, [resource, requestPage]);

  // effect 重置之前也不显示上一专题的标题和片单。
  const current = state.resource === resource ? state : emptyState<T>(resource);
  return {
    ...current,
    hasMore: current.page < current.pages,
    loadMore: () => { if (current.page < current.pages) void requestPage(current.page + 1); },
    retry: () => { void requestPage(lastRequest.current.page, lastRequest.current.replace); },
    reload: () => { void requestPage(1, true); },
  };
}

function PageFooter({ loading, hasMore, error, onMore, onRetry }: {
  loading: boolean; hasMore: boolean; error: string; onMore: () => void; onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-5">
      {loading ? <div className="w-6 h-6 spinner" /> : error ? (
        <>
          <p role="alert" className="text-[11px] text-mut text-center break-all">{error}</p>
          <button onClick={onRetry} className="px-5 h-9 rounded-(--r-ctl) bg-s3 text-[12px] text-on pressable">重试加载</button>
        </>
      ) : hasMore ? (
        <button onClick={onMore} className="px-5 h-9 rounded-(--r-ctl) bg-s3 text-[12px] text-on pressable">加载更多</button>
      ) : <span className="text-[10.5px] text-dim">— 已经到底啦 —</span>}
    </div>
  );
}

/* ================= 专题列表 ================= */
export function TopicsPage({ onBack, wide }: { onBack: () => void; wide: boolean }) {
  const { push } = useStore();
  const data = useTopicPages<Topic>("topics", (page) => api.topics(page, 30));
  const { items, loading, error } = data;

  return (
    <div className="absolute inset-0 bg-bg flex flex-col">
      <div className="shrink-0 bg-s1" style={{ paddingTop: "var(--sat, 0px)" }}>
        <div className="px-3 pt-2 pb-3 flex items-center gap-2.5">
          <button onClick={onBack} className="w-10 h-10 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable"><IBack size={20} /></button>
          <span className="w-[40px] h-[40px] rounded-(--r-sm) bg-pc text-on-pc flex items-center justify-center"><IBookmark size={20} /></span>
          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-bold text-on leading-tight">专题</div>
            <div className="text-[10.5px] text-mut">{data.total ? `共 ${data.total} 个专题 · 已加载 ${items.length} 个` : "精选合集 · 一次看个够"}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 scroll-y px-4 pt-3 pb-8">
        {loading && !items.length ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 spinner" /></div>
        ) : items.length ? (
          <div className={wide ? "grid grid-cols-2 xl:grid-cols-3 gap-3" : "grid grid-cols-2 gap-2.5"}>
            {items.map((t, i) => (
              <button key={t.id} onClick={() => push({ kind: "topic", slug: t.slug, name: t.title })}
                className="text-left pressable group a-rise" style={{ animationDelay: `${Math.min(i * 40, 300)}ms` }}>
                <div className="relative w-full rounded-(--r-md) overflow-hidden bg-s1 elev-1" style={{ paddingTop: "56%" }}>
                  <Img src={t.cover || ""} />
                  <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-2.5">
                    <div className="text-[13px] font-semibold text-white clamp-2 leading-snug">{t.title}</div>
                    <div className="text-[10px] text-white/70 mt-1">{t.video_count ? `${t.video_count} 部` : ""}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Empty icon={<IBookmark size={26} />} title={error ? "专题加载失败" : "暂无专题"}
            sub={error || "稍后再来看看"} action={error ? "重试" : "刷新"} onAction={error ? data.retry : data.reload} />
        )}
        {!!items.length && <PageFooter loading={loading} hasMore={data.hasMore} error={error} onMore={data.loadMore} onRetry={data.retry} />}
      </div>
    </div>
  );
}

/* ================= 专题详情 ================= */
export function TopicPage({ slug, name, onBack, wide }: { slug: string; name: string; onBack: () => void; wide: boolean }) {
  const { push } = useStore();
  const data = useTopicPages<VideoCard>(`topic:${slug}`, async (page) => {
    const res = await api.topic(slug, page, 20);
    return { items: res?.videos?.items || [], pagination: res?.videos?.pagination, topic: res?.topic, related: res?.related };
  });
  const { topic, items: videos, loading, error } = data;

  const ids = videos.map((v) => v.id);

  return (
    <div className="absolute inset-0 bg-bg flex flex-col">
      <div className="shrink-0 bg-s1" style={{ paddingTop: "var(--sat, 0px)" }}>
        <div className="px-3 pt-2 pb-3 flex items-center gap-2.5">
          <button onClick={onBack} className="w-10 h-10 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable"><IBack size={20} /></button>
          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-bold text-on leading-tight">{topic?.title || name}</div>
            <div className="text-[10.5px] text-mut">{data.total || topic?.video_count ? `共 ${data.total || topic?.video_count} 部 · 已加载 ${videos.length} 部` : "专题合集"}</div>
          </div>
        </div>
        {topic?.intro && (
          <div className="px-4 pb-3">
            <p className="text-[11.5px] text-mut leading-relaxed clamp-2">{topic.intro}</p>
          </div>
        )}
      </div>

      <div className="flex-1 scroll-y px-4 pt-3 pb-8">
        {loading && !videos.length ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 spinner" /></div>
        ) : videos.length ? (
          <Masonry videos={videos} wide={wide} onOpen={(v) => push({ kind: "feed", videoIds: ids, index: ids.findIndex((x) => x === v.id), title: topic?.title || name })} />
        ) : (
          <Empty icon={<IBookmark size={26} />} title={error ? "专题加载失败" : "专题为空"}
            sub={error || "换个专题看看"} action={error ? "重试" : "刷新"} onAction={error ? data.retry : data.reload} />
        )}
        {!!videos.length && <PageFooter loading={loading} hasMore={data.hasMore} error={error} onMore={data.loadMore} onRetry={data.retry} />}
        {!!data.related.length && (
          <section className="mt-4 pt-4 border-t border-s3">
            <h2 className="text-[14px] font-semibold text-on mb-3">相关专题</h2>
            <div className={wide ? "grid grid-cols-3 gap-3" : "grid grid-cols-2 gap-2.5"}>
              {data.related.map((t) => (
                <button key={t.id} onClick={() => push({ kind: "topic", slug: t.slug, name: t.title })}
                  className="text-left pressable rounded-(--r-sm) overflow-hidden bg-s2">
                  <div className="relative w-full bg-s1" style={{ aspectRatio: "16 / 9" }}><Img src={t.cover || ""} /></div>
                  <div className="p-2.5">
                    <div className="text-[12px] font-semibold text-on clamp-2">{t.title}</div>
                    <div className="text-[10px] text-mut mt-1">{t.video_count ? `${t.video_count} 部` : "专题合集"}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
