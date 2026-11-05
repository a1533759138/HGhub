import { useCallback, useEffect, useRef, useState } from "react";
import Feed from "../components/Feed";
import { api, platform } from "../api";
import type { VideoCard } from "../types";
import { useStore } from "../store";
import { ISearch, IVol, IVolMute } from "../icons";

export default function Home({ active, bottomInset }: { active: boolean; bottomInset: number }) {
  const { muted, setMuted, setTab, toast, fs, push } = useStore();
  const [items, setItems] = useState<VideoCard[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [slow, setSlow] = useState(false);
  const loadingRef = useRef(false);

  const load = useCallback(async (p: number) => {
    if (loadingRef.current || done) return;
    loadingRef.current = true;
    setLoading(true);
    setErr("");
    try {
      const res = await api.feed(p, 10);
      const list = res?.items || [];
      setItems((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...list.filter((x) => !seen.has(x.id))];
      });
      setPage(p);
      if (!list.length || (res?.pagination && p >= res.pagination.pages)) setDone(true);
    } catch (e) {
      const msg = (e as Error).message || "加载失败";
      // 首屏没内容就把错误留在页面上，别只弹个 toast 然后无限转圈
      if (!items.length) setErr(msg);
      else toast(msg, "info");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [done, items.length, toast]);

  useEffect(() => { if (!items.length) load(1); /* eslint-disable-next-line */ }, []);

  // 首次请求可能要先自动换线（被污染的域名会等连接超时），超过 3 秒给个说明
  useEffect(() => {
    if (items.length || err) { setSlow(false); return; }
    const t = window.setTimeout(() => setSlow(true), 3000);
    return () => window.clearTimeout(t);
  }, [items.length, err, loading]);

  const ids = items.map((v) => v.id);

  return (
    <div className="absolute inset-0 bg-black">
      {items.length ? (
        <Feed videoIds={ids} mode="home" active={active} bottomInset={bottomInset}
          onNearEnd={() => { if (!loading && !done) load(page + 1); }} />
      ) : err ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-10 text-center">
          <div className="text-[14px] text-white/80">连不上线路</div>
          <div className="text-[12px] text-white/45 leading-relaxed break-all max-w-[320px]">{err}</div>
          <div className="mt-1 flex items-center gap-2">
            <button onClick={() => { setDone(false); load(1); }}
              className="hg-chip px-4 h-9 rounded-full text-[13px] pressable elev-1">重试</button>
            <button onClick={() => push({ kind: "settings" })}
              className="hg-chip px-4 h-9 rounded-full text-[13px] pressable elev-1">换线路</button>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div className="w-9 h-9 spinner" />
          {slow && (
            <div className="text-[12px] text-white/45">正在连接线路…首次可能要自动换线，稍等一下</div>
          )}
        </div>
      )}

      {/* 移动端：静音 + 搜索（压在视频上，固定白字 + 半透明黑底） */}
      {platform === "android" && !fs && (
        <div className="absolute inset-x-0 z-20 flex items-center px-3 pointer-events-none hg-player-ui" style={{ top: "calc(var(--sat, 0px) + 6px)" }}>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setMuted((m) => !m)} aria-label={muted ? "取消静音" : "静音"}
              className="hg-chip pointer-events-auto w-9 h-9 rounded-full flex items-center justify-center pressable elev-1">
              {muted ? <IVolMute size={17} /> : <IVol size={17} />}
            </button>
            <button onClick={() => setTab("search")} aria-label="搜索"
              className="hg-chip pointer-events-auto w-9 h-9 rounded-full flex items-center justify-center pressable elev-1">
              <ISearch size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}