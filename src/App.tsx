import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore, type Page, type Tab } from "./store";
import { selfTest } from "./api";
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { runBack } from "./back";
import Home from "./pages/Home";
import Search, { RankPage } from "./pages/Search";
import Category, { ChannelPage } from "./pages/Category";
import Profile from "./pages/Profile";
import SettingsPage from "./pages/Settings";
import Feed from "./components/Feed";
import { PostsPage, PostDetail } from "./pages/Posts";
import LoginModal from "./components/LoginModal";
import { ToastHost } from "./components/ui";
import { DesktopRail, DesktopTitleBar } from "./components/DesktopChrome";
import ResizeHandles from "./components/ResizeHandles";
import { IGrid, IGridF, IHome, IHomeF, ISearch, IUser, IUserF, Logo } from "./icons";

/* ============ 底部标签栏（Android）—— 细瘦纯文字、低侵入 ============ */
const TABS: { k: Tab; label: string }[] = [
  { k: "home", label: "首页" },
  { k: "search", label: "搜索" },
  { k: "category", label: "分类" },
  { k: "profile", label: "我的" },
];

/** 底栏占高（不含安全区）。Feed 的进度条、侧边按钮按它 + --sab 往上让，改底栏高度要同步改这里。 */
const TAB_H = { android: 48, ios: 62 } as const;

function TabBar() {
  const { tab, setTab, theme, platform } = useStore();
  /* iOS 用悬浮胶囊底栏（CSS 仿液态玻璃），其它平台走下面的细瘦纯文字分栏 */
  if (platform === "ios") return <GlassTabBar />;
  const items: { k: Tab; label: string }[] = [
    { k: "home", label: "首页" },
    { k: "search", label: "搜索" },
    { k: "category", label: "分类" },
    { k: "profile", label: "我的" },
  ];
  /* 细瘦纯文字分栏：只有选中项高亮，没有指示点。
     首页是沉浸视频 → 底栏压深色；搜索/分类/我的 是浅色内容页 →
     浅色主题下底栏跟着换成浅色，深色主题保持深色。 */
  const overVideo = tab === "home";
  const lightBar = !overVideo && theme === "light";
  return (
    <nav className="hg-tabbar absolute bottom-0 inset-x-0 z-30"
      style={{
        paddingBottom: "var(--sab, 0px)",
        background: lightBar ? "rgba(250, 250, 250, .97)" : overVideo ? "#000000" : "#141414",
        borderTop: lightBar ? "1px solid rgba(0,0,0,.08)" : overVideo ? "none" : "1px solid rgba(255,255,255,.07)",
        boxShadow: lightBar ? "0 -2px 14px rgba(0,0,0,.05)" : "none",
      }}>
      <div className="h-[40px] flex items-center px-1">
        {items.map(({ k, label }) => {
          const on = tab === k;
          return (
            <button key={k} onClick={() => setTab(k)} className="flex-1 h-full flex items-center justify-center pressable">
              <span className="text-[12.5px] leading-none transition-colors duration-200"
                style={{
                  fontWeight: on ? 700 : 400,
                  color: lightBar
                    ? (on ? "var(--p-primary)" : "rgba(0,0,0,.45)")
                    : (on ? "#ffffff" : "rgba(255,255,255,.6)"),
                }}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* ============ 底部标签栏（iOS）—— 悬浮胶囊，CSS 仿液态玻璃 ============ */
const TAB_ICONS: Record<Tab, [typeof IHome, typeof IHome]> = {
  home: [IHome, IHomeF],
  search: [ISearch, ISearch],
  category: [IGrid, IGridF],
  profile: [IUser, IUserF],
};

function GlassTabBar() {
  const { tab, setTab } = useStore();
  /* 首页是全屏视频，底栏固定用深色玻璃；其他页随主题 */
  const onVideo = tab === "home";
  return (
    <nav className="absolute bottom-0 inset-x-0 z-30 px-5 pointer-events-none" style={{ paddingBottom: "var(--sab, 0px)" }}>
      <div className={`glass-bar ${onVideo ? "is-dark" : ""} pointer-events-auto h-[54px] p-1 flex items-center rounded-full`}>
        {TABS.map(({ k, label }) => {
          const on = tab === k;
          const [Icon, IconOn] = TAB_ICONS[k];
          const I = on ? IconOn : Icon;
          return (
            <button key={k} onClick={() => setTab(k)} aria-current={on ? "page" : undefined}
              className={`flex-1 h-full rounded-full flex flex-col items-center justify-center gap-[3px] transition-colors duration-200 pressable ${on ? "glass-pill-on" : ""}`}>
              <I size={20} className={on ? "text-primary" : onVideo ? "text-white/75" : "text-on/70"} />
              <span className={`text-[10.5px] leading-none ${on ? "font-semibold text-primary" : onVideo ? "text-white/75" : "text-on/70"}`}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* ============ 堆栈页面 ============ */
function StackPage({ page, onBack, wide, top, bottomInset }: {
  page: Page; onBack: () => void; wide: boolean; top: boolean; bottomInset: number;
}) {
  if (page.kind === "feed") {
    return (
      <Feed videoIds={page.videoIds} startIndex={page.index} title={page.title} kind={page.feedKind || "video"}
        startEp={page.startEp} startTime={page.startTime}
        mode="context" active={top} bottomInset={bottomInset} onBack={onBack} />
    );
  }
  if (page.kind === "channel") return <ChannelPage cate={page.cate} name={page.name} onBack={onBack} wide={wide} />;
  if (page.kind === "ranks") return <RankPage onBack={onBack} wide={wide} />;
  if (page.kind === "settings") return <SettingsPage onBack={onBack} wide={wide} />;
  if (page.kind === "posts") return <PostsPage onBack={onBack} wide={wide} />;
  if (page.kind === "post") return <PostDetail id={page.id} onBack={onBack} />;
  return null;
}

/* ============ 应用主体 ============ */
function AppBody() {
  const { platform, tab, setTab, stack, pop, loginOpen, setLoginOpen, fs } = useStore();
  const mainRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(platform !== "android");
  const [collapsed, setCollapsed] = useState(false);

  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWide(el.clientWidth > 640));
    ro.observe(el);
    setWide(el.clientWidth > 640);
    return () => ro.disconnect();
  }, []);

  /* 全局键盘 */
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) {
        if (e.key === "Escape") t.blur();
        return;
      }
      if (loginOpen) { if (e.key === "Escape") setLoginOpen(false); return; }
      if (e.key === "Escape") { if (stack.length) pop(); return; }
      if (e.key === "/") { e.preventDefault(); setTab("search"); return; }
      if (["1", "2", "3", "4"].includes(e.key) && !e.repeat) {
        setTab((["home", "search", "category", "profile"] as Tab[])[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [stack.length, pop, setTab, loginOpen, setLoginOpen]);

  const vis = (k: Tab) => (tab === k ? "absolute inset-0" : "absolute inset-0 invisible pointer-events-none");
  const pageActive = stack.length === 0 && !loginOpen;
  const mobile = platform !== "windows";
  const bottomInset = mobile ? (fs ? 0 : TAB_H[platform === "ios" ? "ios" : "android"]) : 14;
  /* 栈页（从搜索/分类/我的进入的播放页、图文页）不显示底栏：
     底栏会盖住评论抽屉的输入框，且这些页面本身是沉浸的 */
  const stackInset = mobile ? (fs ? 0 : 20) : 14;

  return (
    <div className={`absolute inset-0 flex bg-canvas plat-${platform}`}>
      {platform !== "android" && <DesktopRail collapsed={collapsed} />}
      <div ref={mainRef} className="relative flex-1 min-w-0 overflow-hidden win-main">
        <div className={vis("home")}><Home active={pageActive && tab === "home"} bottomInset={bottomInset} /></div>
        <div className={vis("search")}><Search active={pageActive && tab === "search"} wide={wide} /></div>
        <div className={vis("category")}><Category wide={wide} /></div>
        <div className={vis("profile")}><Profile wide={wide} /></div>

        {stack.map((p, i) => (
          <div key={p.key} className="absolute inset-0 z-30 bg-bg a-page-in" style={{ boxShadow: "-18px 0 40px rgba(0,0,0,.5)" }}>
            <StackPage page={p} onBack={pop} wide={wide} top={i === stack.length - 1} bottomInset={stackInset} />
          </div>
        ))}

        {mobile && !fs && stack.length === 0 && <TabBar />}
      </div>
    </div>
  );
}

/* ============ 桌面窗口壳（Windows / macOS）============ */
function DesktopShell() {
  const [collapsed, setCollapsed] = useState(false);
  const { theater, platform } = useStore();
  return (
    <div className={`absolute inset-0 flex flex-col bg-canvas win-root plat-${platform}`}>
      <DesktopTitleBar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div className="relative flex-1 min-h-0">
        <ShellInner collapsed={collapsed || theater} theater={theater} />
      </div>
      {/* 边缘缩放热区只对无边框窗口（Windows）有效，macOS 走原生窗口边框 */}
      {platform === "windows" && <ResizeHandles />}
    </div>
  );
}

function ShellInner({ collapsed, theater }: { collapsed: boolean; theater: boolean }) {
  const { stack, pop, loginOpen, setLoginOpen, tab, setTab, platform } = useStore();
  const mainRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);

  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWide(el.clientWidth > 640));
    ro.observe(el);
    setWide(el.clientWidth > 640);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) {
        if (e.key === "Escape") t.blur();
        return;
      }
      if (loginOpen) { if (e.key === "Escape") setLoginOpen(false); return; }
      if (e.key === "Escape") { if (stack.length) pop(); return; }
      if (e.key === "/") { e.preventDefault(); setTab("search"); return; }
      if (["1", "2", "3", "4"].includes(e.key) && !e.repeat) {
        setTab((["home", "search", "category", "profile"] as Tab[])[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [stack.length, pop, setTab, loginOpen, setLoginOpen]);

  const vis = (k: Tab) => (tab === k ? "absolute inset-0" : "absolute inset-0 invisible pointer-events-none");
  const pageActive = stack.length === 0 && !loginOpen;

  return (
    <div className={`absolute inset-0 flex bg-canvas plat-${platform}`}>
      {!theater && <DesktopRail collapsed={collapsed} />}
      <div ref={mainRef} className={`relative flex-1 min-w-0 overflow-hidden win-main ${theater ? "is-theater-main" : ""}`}>
        <div className={vis("home")}><Home active={pageActive && tab === "home"} bottomInset={14} /></div>
        <div className={vis("search")}><Search active={pageActive && tab === "search"} wide={wide} /></div>
        <div className={vis("category")}><Category wide={wide} /></div>
        <div className={vis("profile")}><Profile wide={wide} /></div>
        {stack.map((p, i) => (
          <div key={p.key} className="absolute inset-0 z-30 bg-bg win-page-in" style={{ boxShadow: "-18px 0 40px rgba(0,0,0,.5)" }}>
            <StackPage page={p} onBack={pop} wide={wide} top={i === stack.length - 1} bottomInset={14} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============ 移动端（无壳） ============ */
function MobileShell() {
  return (
    <div className="absolute inset-0 flex flex-col bg-canvas plat-android"
      style={{ "--sat": "max(env(safe-area-inset-top), 8px)", "--sab": "max(env(safe-area-inset-bottom), 6px)" } as React.CSSProperties}>
      <div className="relative flex-1 min-h-0">
        <AppBody />
      </div>
    </div>
  );
}

/* ============ 入口 ============ */
export default function App() {
  const { platform, loginOpen, setLoginOpen, tab, setTab, stack, pop, fs, setFs } = useStore();

  /* —— 安卓硬件返回键 ——
     层级：全屏 → 面板/弹层 → 登录框 → 页面栈 → 回首页 → 退出应用。
     不注册这个监听，Tauri 会直接 webView.goBack() 或退出，表现就是「任意页面返回都回桌面」。 */
  const backRef = useRef<() => void>(() => {});
  backRef.current = () => {
    if (fs) { setFs(false); return; }                        // 沉浸全屏
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    if (runBack()) return;                                  // 播放器的选集/评论/图文面板
    if (loginOpen) { setLoginOpen(false); return; }
    if (stack.length) { pop(); return; }
    if (tab !== "home") { setTab("home"); return; }
    invoke("plugin:app|exit", { code: 0 }).catch(() => {});
  };

  useEffect(() => {
    if (platform !== "android") return undefined;
    let disposed = false;
    let handle: { unregister: () => Promise<void> } | null = null;
    addPluginListener("app", "back-button", () => backRef.current())
      .then((l) => { if (disposed) l.unregister().catch(() => {}); else handle = l; })
      .catch(() => { /* 非安卓宿主忽略 */ });
    return () => {
      disposed = true;
      handle?.unregister().catch(() => {});
    };
  }, [platform]);

  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", prevent);
    return () => document.removeEventListener("contextmenu", prevent);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const t = window.setTimeout(() => {
      selfTest().then((r) => { invoke("debug_log", { msg: r }).catch(() => {}); }).catch(() => {});
    }, 2500);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <>
      {platform === "android" ? <MobileShell /> : <DesktopShell />}
      <LoginModal />
      <ToastHost />
      {/* 登录遮罩键盘处理占位 */}
      {loginOpen && <div className="hidden" onClick={() => setLoginOpen(false)} />}
    </>
  );
}