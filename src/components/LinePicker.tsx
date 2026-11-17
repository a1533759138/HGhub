import { useEffect, useState } from "react";
import { api, hostOf, isMobile, type LineItem, type LineProbe, type LineState } from "../api";
import { useStore } from "../store";
import { Modal, Sheet } from "./ui";
import { ICheck, IClose, IRefresh, ISettings, IBoltF } from "../icons";

type ProbeMap = Record<string, LineProbe>;

/* 单条线路：左侧点一下即切换，右侧单独检测 */
function Row({ item, current, probe, busy, disabled, onPick, onProbe }: {
  item: LineItem; current: boolean; probe?: LineProbe; busy: boolean; disabled: boolean;
  onPick: (url: string) => void; onProbe: (url: string) => void;
}) {
  return (
    <div className={`flex items-center gap-2 px-3.5 py-2.5 ${current ? "bg-s3/70" : ""}`}>
      <button onClick={() => onPick(item.url)} disabled={disabled} className="flex-1 min-w-0 text-left pressable disabled:opacity-60">
        <div className="flex items-center gap-1.5 text-[12.5px] text-on">
          <span className="truncate">{item.name || item.host || hostOf(item.url)}</span>
          {current && <ICheck size={13} className="text-mint shrink-0" />}
        </div>
        <div className="text-[10.5px] text-mut truncate mt-0.5">{item.url}</div>
      </button>
      <span
        title={probe ? (probe.error || (probe.status ? `HTTP ${probe.status}` : "")) : ""}
        className={`text-[10.5px] tabular-nums shrink-0 ${probe ? (probe.ok ? "text-mint" : "text-danger") : "text-dim"}`}>
        {busy ? "…" : probe ? (probe.ok ? `${probe.ms}ms` : probe.status ? `HTTP ${probe.status}` : "失败") : "—"}
      </span>
      <button onClick={() => onProbe(item.url)} disabled={busy || disabled}
        className="shrink-0 h-7 px-2.5 rounded-(--r-sm) bg-s4 text-[11px] text-on/80 pressable disabled:opacity-50">检测</button>
    </div>
  );
}

/* 线路选择：桌面居中弹窗，移动端底部抽屉 */
export default function LinePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useStore();
  const [state, setState] = useState<LineState | null>(null);
  const [relay, setRelay] = useState<LineItem[] | null>(null);
  const [relayErr, setRelayErr] = useState("");
  const [relayNote, setRelayNote] = useState("");
  const [loadingRelay, setLoadingRelay] = useState(false);
  const [mirrors, setMirrors] = useState<LineItem[] | null>(null);
  const [mirrorErr, setMirrorErr] = useState("");
  const [mirrorNote, setMirrorNote] = useState("");
  const [loadingMirrors, setLoadingMirrors] = useState(false);
  const [probes, setProbes] = useState<ProbeMap>({});
  const [probing, setProbing] = useState("");
  const [switching, setSwitching] = useState("");
  const [autoPicking, setAutoPicking] = useState(false);

  const readState = () => {
    api.lineState().then(setState).catch((e) => toast((e as Error).message || "读取线路失败", "info"));
  };

  const readRelay = async () => {
    setLoadingRelay(true);
    setRelayErr("");
    try {
      const res = await api.lineRelay();
      setRelay(res?.items || []);
      setRelayNote(res?.note || "");
    } catch (e) {
      setRelay([]);
      setRelayNote("");
      setRelayErr((e as Error).message || "直连线路获取失败");
    } finally {
      setLoadingRelay(false);
    }
  };

  const readMirrors = async () => {
    setLoadingMirrors(true);
    setMirrorErr("");
    try {
      const res = await api.lineMirrors();
      setMirrors(res?.items || []);
      setMirrorNote(res?.note || "");
    } catch (e) {
      setMirrors([]);
      setMirrorNote("");
      setMirrorErr((e as Error).message || "镜像线路获取失败");
    } finally {
      setLoadingMirrors(false);
    }
  };

  /* 镜像线路只在用户点开「线路」后才去拉，拉过一次就留在内存里，可手动刷新 */
  useEffect(() => {
    if (!open) return;
    readState();
    if (relay === null) void readRelay();
    if (mirrors === null) void readMirrors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const probe = async (list: LineItem[], key: string) => {
    if (!list.length) return;
    setProbing(key);
    try {
      const res = await api.lineProbe(list.map((x) => x.url));
      setProbes((p) => {
        const next = { ...p };
        for (const r of res) next[r.url] = r;
        return next;
      });
    } catch (e) {
      toast((e as Error).message || "检测失败", "info");
    } finally {
      setProbing("");
    }
  };

  const pick = async (url: string) => {
    if (switching || state?.base === url) return;
    setSwitching(url);
    try {
      const next = await api.lineSet(url);
      setState((s) => (s ? { ...s, base: next } : s));
      toast(`线路已切换到 ${hostOf(next)}`, "ok");
    } catch (e) {
      toast((e as Error).message || "切换失败", "info");
    } finally {
      setSwitching("");
    }
  };

  /* 自动测速并切到最快线路 */
  const autoFastest = async () => {
    if (autoPicking) return;
    setAutoPicking(true);
    try {
      const res = await api.lineAutoFastest();
      if (res.picked) {
        setState((s) => (s ? { ...s, base: res.picked } : s));
        toast(`已切换到最快线路 ${hostOf(res.picked)}（${res.picked_ms}ms）`, "ok");
      } else {
        toast("没有找到可用线路", "info");
      }
      // 刷新探测结果，让界面显示最新延迟
      readState();
    } catch (e) {
      toast((e as Error).message || "自动测速失败", "info");
    } finally {
      setAutoPicking(false);
    }
  };

  const fixed = state?.fixed || [];
  const busyAll = !!probing || !!switching || autoPicking;

  const body = (
    <div className="flex flex-col min-h-0" style={{ maxHeight: isMobile ? "74vh" : "min(72vh, 620px)" }}>
      <div className="shrink-0 flex items-center gap-2 px-4 pt-3 pb-2">
        <span className="w-8 h-8 rounded-full bg-s3 flex items-center justify-center text-primary"><ISettings size={16} /></span>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-bold text-on leading-tight">线路</div>
          <div className="text-[10.5px] text-mut mt-0.5 truncate">当前：{state ? hostOf(state.base) : "读取中…"}</div>
        </div>
        <button onClick={onClose} aria-label="关闭" className="w-8 h-8 rounded-full bg-s3/80 flex items-center justify-center text-mut pressable"><IClose size={16} /></button>
      </div>

      <div className="shrink-0 px-3 pb-1">
        <button onClick={autoFastest} disabled={busyAll}
          className="w-full flex items-center justify-center gap-2 h-9 rounded-(--r-ctl) bg-primary text-[12.5px] font-semibold text-on-primary pressable disabled:opacity-50">
          <IBoltF size={14} />{autoPicking ? "测速中…" : "自动测速并切换最快线路"}
        </button>
      </div>

      <div className="flex-1 scroll-y px-3 pb-4">
        <div className="flex items-center gap-2 px-1 mt-2 mb-1.5">
          <span className="text-[10.5px] font-semibold text-dim tracking-wide">国内直连线路</span>
          <span className="text-[10px] text-dim">中转页实时 · 无需代理</span>
          <button onClick={() => { void readRelay(); }} disabled={loadingRelay}
            className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-primary pressable disabled:opacity-50">
            <IRefresh size={12} />{loadingRelay ? "获取中…" : "刷新"}
          </button>
        </div>
        {!!relayNote && !loadingRelay && (
          <div className="px-1 mb-1.5 text-[10px] text-amber-400/80 leading-relaxed break-all">{relayNote}</div>
        )}
        <div className="rounded-(--r-md) bg-s2 divide-y divide-s3 overflow-hidden">
          {loadingRelay && <div className="flex justify-center py-6"><div className="w-6 h-6 spinner" /></div>}
          {!loadingRelay && relayErr && (
            <div className="px-3.5 py-3">
              <div className="text-[11.5px] text-danger">直连线路获取失败</div>
              <div className="text-[10.5px] text-mut mt-1 break-all">{relayErr}</div>
            </div>
          )}
          {!loadingRelay && !relayErr && relay?.length === 0 && (
            <div className="px-3.5 py-3 text-[11px] text-mut">中转页里没有可用的直连地址</div>
          )}
          {!loadingRelay && (relay || []).map((it) => (
            <Row key={it.url} item={it} current={state?.base === it.url} probe={probes[it.url]}
              busy={probing === it.url} disabled={busyAll} onPick={pick} onProbe={(u) => probe([{ url: u }], u)} />
          ))}
        </div>
        {!loadingRelay && !!relay?.length && (
          <div className="flex justify-end px-1 mt-2">
            <button onClick={() => probe(relay, "relay")} disabled={busyAll}
              className="text-[10.5px] text-primary pressable disabled:opacity-50">
              {probing === "relay" ? "检测中…" : `全部检测（${relay.length}）`}
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 px-1 mt-4 mb-1.5">
          <span className="text-[10.5px] font-semibold text-dim tracking-wide">固定线路</span>
          <span className="text-[10px] text-dim">需代理 / 非大陆网络</span>
          <button onClick={() => probe(fixed, "fixed")} disabled={busyAll || !fixed.length}
            className="ml-auto text-[10.5px] text-primary pressable disabled:opacity-50">
            {probing === "fixed" ? "检测中…" : "全部检测"}
          </button>
        </div>
        <div className="rounded-(--r-md) bg-s2 divide-y divide-s3 overflow-hidden">
          {fixed.map((it) => (
            <Row key={it.url} item={it} current={state?.base === it.url} probe={probes[it.url]}
              busy={probing === it.url} disabled={busyAll} onPick={pick} onProbe={(u) => probe([{ url: u }], u)} />
          ))}
          {!fixed.length && <div className="px-3.5 py-3 text-[11px] text-mut">读取中…</div>}
        </div>

        <div className="flex items-center gap-2 px-1 mt-4 mb-1.5">
          <span className="text-[10.5px] font-semibold text-dim tracking-wide">镜像线路（旧发布页）</span>
          <span className="text-[10px] text-dim">随机子域 · 兜底</span>
          <button onClick={() => { void readMirrors(); }} disabled={loadingMirrors}
            className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-primary pressable disabled:opacity-50">
            <IRefresh size={12} />{loadingMirrors ? "获取中…" : "刷新"}
          </button>
        </div>
        {!!mirrorNote && !loadingMirrors && (
          <div className="px-1 mb-1.5 text-[10px] text-amber-400/80 leading-relaxed break-all">{mirrorNote}</div>
        )}
        <div className="rounded-(--r-md) bg-s2 divide-y divide-s3 overflow-hidden">
          {loadingMirrors && <div className="flex justify-center py-6"><div className="w-6 h-6 spinner" /></div>}
          {!loadingMirrors && mirrorErr && (
            <div className="px-3.5 py-3">
              <div className="text-[11.5px] text-danger">镜像线路获取失败</div>
              <div className="text-[10.5px] text-mut mt-1 break-all">{mirrorErr}</div>
            </div>
          )}
          {!loadingMirrors && !mirrorErr && mirrors?.length === 0 && (
            <div className="px-3.5 py-3 text-[11px] text-mut">地址发布页里没有可用的镜像地址</div>
          )}
          {!loadingMirrors && (mirrors || []).map((it) => (
            <Row key={it.url} item={it} current={state?.base === it.url} probe={probes[it.url]}
              busy={probing === it.url} disabled={busyAll} onPick={pick} onProbe={(u) => probe([{ url: u }], u)} />
          ))}
        </div>
        {!loadingMirrors && !!mirrors?.length && (
          <div className="flex justify-end px-1 mt-2">
            <button onClick={() => probe(mirrors, "mirrors")} disabled={busyAll}
              className="text-[10.5px] text-primary pressable disabled:opacity-50">
              {probing === "mirrors" ? "检测中…" : `全部检测（${mirrors.length}）`}
            </button>
          </div>
        )}

        <div className="text-[10px] text-dim leading-relaxed px-1 mt-4">
          切换后立即生效，请求链路与数据模型不变。线路连不上时会自动换一条能用的并记住，
          也可以在这里手动指定。「自动测速」会从中转页实时拉取国内直连线路并切到延迟最低的一条。
        </div>
      </div>
    </div>
  );

  return isMobile
    ? <Sheet open={open} onClose={onClose}>{body}</Sheet>
    : <Modal open={open} onClose={onClose} width={460}>{body}</Modal>;
}
