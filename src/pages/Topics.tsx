import { useEffect, useRef, useState } from "react";
import { api, cover } from "../api";
import type { Topic, VideoCard } from "../types";
import { useStore } from "../store";
import { Masonry } from "../components/cards";
import { Empty, Img } from "../components/ui";
import { IBack, IBookmark } from "../icons";

/* ================= 专题列表 ================= */
export function TopicsPage({ onBack, wide }: { onBack: () => void; wide: boolean }) {
  const { push } = useStore();
  const [items, setItems] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.topics(1, 50)
      .then((res) => { if (alive) setItems(res?.items || []); })
      .catch((e) => { if (alive) setErr((e as Error).message || "专题加载失败"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="absolute inset-0 bg-bg flex flex-col">
      <div className="shrink-0 bg-s1" style={{ paddingTop: "var(--sat, 0px)" }}>
        <div className="px-3 pt-2 pb-3 flex items-center gap-2.5">
          <button onClick={onBack} className="w-10 h-10 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable"><IBack size={20} /></button>
          <span className="w-[40px] h-[40px] rounded-(--r-sm) bg-pc text-on-pc flex items-center justify-center"><IBookmark size={20} /></span>
          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-bold text-on leading-tight">专题</div>
            <div className="text-[10.5px] text-mut">精选合集 · 一次看个够</div>
          </div>
        </div>
      </div>

      <div className="flex-1 scroll-y px-4 pt-3 pb-8">
        {loading ? (
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
          <Empty icon={<IBookmark size={26} />} title={err || "暂无专题"} sub="稍后再来看看" />
        )}
      </div>
    </div>
  );
}

/* ================= 专题详情 ================= */
export function TopicPage({ slug, name, onBack, wide }: { slug: string; name: string; onBack: () => void; wide: boolean }) {
  const { push } = useStore();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [videos, setVideos] = useState<VideoCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.topic(slug)
      .then((res) => {
        if (!alive) return;
        setTopic(res?.topic || null);
        setVideos(res?.videos?.items || []);
      })
      .catch((e) => { if (alive) setErr((e as Error).message || "专题加载失败"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  const ids = videos.map((v) => v.id);

  return (
    <div className="absolute inset-0 bg-bg flex flex-col">
      <div className="shrink-0 bg-s1" style={{ paddingTop: "var(--sat, 0px)" }}>
        <div className="px-3 pt-2 pb-3 flex items-center gap-2.5">
          <button onClick={onBack} className="w-10 h-10 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable"><IBack size={20} /></button>
          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-bold text-on leading-tight">{topic?.title || name}</div>
            <div className="text-[10.5px] text-mut">{videos.length ? `${videos.length} 部` : topic?.video_count ? `${topic.video_count} 部` : "专题合集"}</div>
          </div>
        </div>
        {topic?.intro && (
          <div className="px-4 pb-3">
            <p className="text-[11.5px] text-mut leading-relaxed clamp-2">{topic.intro}</p>
          </div>
        )}
      </div>

      <div className="flex-1 scroll-y px-4 pt-3 pb-8">
        {loading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 spinner" /></div>
        ) : videos.length ? (
          <Masonry videos={videos} wide={wide} onOpen={(v) => push({ kind: "feed", videoIds: ids, index: ids.findIndex((x) => x === v.id), title: topic?.title || name })} />
        ) : (
          <Empty icon={<IBookmark size={26} />} title={err || "专题为空"} sub="换个专题看看" />
        )}
      </div>
    </div>
  );
}
