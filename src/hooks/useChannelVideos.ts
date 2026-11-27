import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { VideoCard } from "../types";

export type ChannelSort = "latest" | "hot_window" | "random";
export const CHANNEL_SORTS: { key: ChannelSort; label: string; desc: string }[] = [
  { key: "latest", label: "最近更新", desc: "最新上架" },
  { key: "hot_window", label: "当前热播", desc: "近期热门" },
  { key: "random", label: "精选推荐", desc: "随机发现好剧" },
];

/** 每次排序/刷新创建独立请求代次，旧响应不能覆盖新列表。 */
export function useChannelVideos(cate: string, sort: ChannelSort) {
  const [items, setItems] = useState<VideoCard[]>([]);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async (next: number, replace: boolean, version: number) => {
    if (busy.current || !mounted.current) return;
    busy.current = true;
    setLoading(true);
    setError("");
    try {
      const res = await api.category(cate, next, 20, sort);
      if (!mounted.current || version !== generation.current) return;
      setItems((prev) => {
        const base = replace ? [] : prev;
        const seen = new Set(base.map((v) => v.id));
        const extra = (res?.items || []).filter((v) => {
          if (seen.has(v.id)) return false;
          seen.add(v.id); return true;
        });
        return [...base, ...extra];
      });
      setPage(res?.pagination?.page || next);
      setPages(res?.pagination?.pages || next);
      setTotal(res?.pagination?.total || 0);
    } catch (e) {
      if (mounted.current && version === generation.current) setError((e as Error).message || "加载失败");
    } finally {
      if (mounted.current && version === generation.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [cate, sort]);

  useEffect(() => {
    const version = ++generation.current;
    busy.current = false;
    setItems([]); setPage(0); setPages(1); setTotal(0);
    void load(1, true, version);
    return () => { generation.current += 1; };
  }, [load, revision]);

  const loadMore = useCallback(() => {
    if (!busy.current && page < pages) void load(page + 1, page === 0, generation.current);
  }, [load, page, pages]);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  return { items, page, pages, total, loading, error, loadMore, refresh, hasMore: page < pages };
}
