import { useEffect, useImperativeHandle, useRef, forwardRef, useState } from "react";
import Hls from "hls.js";
import { isLocalMedia, playlist } from "../api";

export type VideoHandle = {
  el: () => HTMLVideoElement | null;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  rate: (r: number) => void;
  mute: (m: boolean) => void;
  volume: (v: number) => void;
};

type Props = {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  fit?: "contain" | "cover";
  /** 换源后重新套用，避免切集时音量/倍速被浏览器重置 */
  volume?: number;
  rate?: number;
  onTime?: (t: number) => void;
  onDuration?: (d: number) => void;
  onSize?: (w: number, h: number) => void;
  onPlaying?: () => void;
  onPause?: () => void;
  onWaiting?: () => void;
  /** 当前播放点所在缓冲区间的末尾（秒），用来画缓冲条 */
  onBuffered?: (end: number) => void;
  /** 跳转开始 / 完成（拖进度到没缓冲的地方要等分片下载，暂停态也要给转圈） */
  onSeeking?: (seeking: boolean) => void;
  onEnded?: () => void;
  onError?: (msg: string) => void;
  onClick?: () => void;
  className?: string;
};

/** 当前播放点所在缓冲区间的末尾，没有则 0。
 *  拖过去的地方前后可能有好几段不连续的缓冲；新下的分片常从关键帧开始，比拖到的位置晚一点，所以往后放宽 1.5 秒 */
function bufferedEnd(v: HTMLVideoElement) {
  const b = v.buffered;
  const t = v.currentTime;
  for (let i = 0; i < b.length; i++) {
    if (b.start(i) <= t + 1.5 && b.end(i) > t) return b.end(i);
  }
  return 0;
}

function bufferedAhead(v: HTMLVideoElement) {
  const end = bufferedEnd(v);
  return end ? end - v.currentTime : 0;
}

/** 只负责「播」：hls.js + video 元素，控制条由外层渲染。 */
const VideoSurface = forwardRef<VideoHandle, Props>(function VideoSurface(
  { src, poster, autoPlay = true, muted = false, loop = false, fit = "contain", volume = 1, rate = 1,
    onTime, onDuration, onSize, onPlaying, onPause, onWaiting, onBuffered, onSeeking, onEnded, onError, onClick, className = "" },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [ready, setReady] = useState(false);

  useImperativeHandle(ref, () => ({
    el: () => videoRef.current,
    play: () => { videoRef.current?.play().catch(() => {}); },
    pause: () => videoRef.current?.pause(),
    toggle: () => {
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) v.play().catch(() => {}); else v.pause();
    },
    seek: (t: number) => { const v = videoRef.current; if (v && Number.isFinite(t)) v.currentTime = t; },
    rate: (r: number) => { const v = videoRef.current; if (v) v.playbackRate = r; },
    mute: (m: boolean) => { const v = videoRef.current; if (v) v.muted = m; },
    volume: (vol: number) => { const v = videoRef.current; if (v) v.volume = vol; },
  }), []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    setReady(false);
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    const proxied = isLocalMedia(src);
    const url = proxied ? src : playlist(src);
    const useHls = !url.includes("/seg?u=");

    /* 换源时先把音量/倍速套回去：hls 重新 attach 后浏览器会把它们重置成默认值 */
    const applySettings = () => {
      const v = videoRef.current;
      if (!v) return;
      v.volume = volume;
      v.muted = muted;
      v.playbackRate = rate;
    };
    applySettings();

    let cleanup = () => {};
    if (useHls && Hls.isSupported()) {
      /* 分片约 5 秒 / 2MB。缓冲别开太大：iOS 的 ManagedMediaSource 内存一紧就回收，
         常常只回收视频轨，表现为「有声音、画面不动」。网络上的提速交给 Rust 侧的分片预取 */
      const hls = new Hls({
        enableWorker: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        backBufferLength: 30,
        manifestLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 4,
      });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoPlay) video.play().catch(() => {});
      });
      /* MSE 下 progress 事件不一定触发，分片写进缓冲时主动报一次 */
      let lastLoad = Date.now();
      hls.on(Hls.Events.BUFFER_APPENDED, () => { lastLoad = Date.now(); reportBuffered(video); });
      hls.on(Hls.Events.FRAG_LOADING, () => { lastLoad = Date.now(); });

      /* iOS（ManagedMediaSource）：系统发 endstreaming 后 hls.js 会暂停下分片，等系统发 startstreaming 才继续。
         可拖到没缓冲的地方后系统常常不发，于是一直不下、画面卡住，只有拖回已缓冲处播一会儿才恢复。
         所以只要当前位置往后缓冲不足，就主动恢复下载；连续 8 秒什么都没下，从当前位置重新起一次加载。 */
      const kick = () => {
        const ahead = bufferedAhead(video);
        if (ahead >= 8) return;
        if (!hls.bufferingEnabled) hls.resumeBuffering();
        if (ahead < 0.5 && video.readyState < 3 && Date.now() - lastLoad > 8000) {
          lastLoad = Date.now();
          hls.startLoad(video.currentTime);
        }
      };
      const onSeek = () => { lastLoad = Date.now(); kick(); };
      video.addEventListener("seeking", onSeek);
      video.addEventListener("waiting", kick);
      video.addEventListener("stalled", kick);
      const watchdog = window.setInterval(kick, 1000);
      cleanup = () => {
        window.clearInterval(watchdog);
        video.removeEventListener("seeking", onSeek);
        video.removeEventListener("waiting", kick);
        video.removeEventListener("stalled", kick);
      };
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        onError?.(`${data.type}/${data.details}`);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else { hls.destroy(); hlsRef.current = null; }
      });
    } else {
      video.src = url;
      if (autoPlay) video.play().catch(() => {});
    }

    return () => {
      cleanup();
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => { if (videoRef.current) videoRef.current.muted = muted; }, [muted]);
  useEffect(() => { if (videoRef.current) videoRef.current.volume = volume; }, [volume]);
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = rate; }, [rate]);

  const reapply = (v: HTMLVideoElement) => {
    v.volume = volume;
    v.muted = muted;
    v.playbackRate = rate;
  };

  const reportBuffered = (v: HTMLVideoElement) => {
    onBuffered?.(bufferedEnd(v));
  };

  return (
    <video
      ref={videoRef}
      poster={poster}
      playsInline
      loop={loop}
      onClick={onClick}
      className={`w-full h-full bg-black ${fit === "cover" ? "object-cover" : "object-contain"} ${className}`}
      style={{ opacity: ready ? 1 : 0, transition: "opacity .35s" }}
      onLoadedData={(e) => { setReady(true); reapply(e.target as HTMLVideoElement); }}
      onTimeUpdate={(e) => { const v = e.target as HTMLVideoElement; onTime?.(v.currentTime); reportBuffered(v); }}
      onProgress={(e) => reportBuffered(e.target as HTMLVideoElement)}
      onSeeking={(e) => { onSeeking?.(true); reportBuffered(e.target as HTMLVideoElement); }}
      onSeeked={(e) => { onSeeking?.(false); reportBuffered(e.target as HTMLVideoElement); }}
      onLoadedMetadata={(e) => {
        const v = e.target as HTMLVideoElement;
        reapply(v);
        onDuration?.(v.duration || 0);
        onSize?.(v.videoWidth || 0, v.videoHeight || 0);
      }}
      onPlay={() => onPlaying?.()}
      onPause={() => onPause?.()}
      onWaiting={() => onWaiting?.()}
      onPlaying={() => onPlaying?.()}
      onEnded={() => onEnded?.()}
    />
  );
});

export default VideoSurface;