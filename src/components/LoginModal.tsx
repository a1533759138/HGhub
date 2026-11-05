import { useState } from "react";
import { api, isMobile } from "../api";
import type { User } from "../types";
import { useStore } from "../store";
import { Modal, Sheet } from "./ui";
import { IClose, ILogin } from "../icons";

export default function LoginModal() {
  const { loginOpen, setLoginOpen, setUser, toast } = useStore();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!username.trim() || !password) { setErr("请输入账号与密码"); return; }
    setBusy(true);
    setErr("");
    try {
      const res = mode === "login"
        ? await api.login(username.trim(), password)
        : await api.register(username.trim(), password, email.trim());
      setUser(res.user as User);
      setPassword("");
      setLoginOpen(false);
      toast(mode === "login" ? `欢迎回来，${(res.user as User)?.nickname || username}` : "注册成功", "ok");
    } catch (e) {
      setErr((e as Error).message || "操作失败");
    } finally {
      setBusy(false);
    }
  };

  /* 移动端用底部抽屉，桌面端用居中弹窗 */
  const body = (
    <div className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-8 h-8 rounded-(--r-sm) bg-pc text-on-pc flex items-center justify-center"><ILogin size={16} /></span>
        <span className="text-[15px] font-bold text-on">{mode === "login" ? "登录 HGhub" : "注册 HGhub"}</span>
        <button onClick={() => setLoginOpen(false)} className="ml-auto w-7 h-7 rounded-full bg-s4 flex items-center justify-center text-mut pressable">
          <IClose size={13} />
        </button>
      </div>

      <div className="flex bg-s4 rounded-(--r-ctl) p-1 mb-3">
        {([["login", "登录"], ["register", "注册"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => { setMode(k); setErr(""); }}
            className={`flex-1 h-8 rounded-(--r-ctl) text-[12px] font-semibold pressable ${mode === k ? "bg-primary text-on-primary" : "text-mut"}`}>{l}</button>
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="账号"
          className="h-10 px-3.5 rounded-(--r-sm) bg-s4 text-[13px] text-on placeholder-mut outline-none focus:ring-2 focus:ring-[var(--p-primary)]" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="密码"
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          className="h-10 px-3.5 rounded-(--r-sm) bg-s4 text-[13px] text-on placeholder-mut outline-none focus:ring-2 focus:ring-[var(--p-primary)]" />
        {mode === "register" && (
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱（可选）"
            className="h-10 px-3.5 rounded-(--r-sm) bg-s4 text-[13px] text-on placeholder-mut outline-none focus:ring-2 focus:ring-[var(--p-primary)]" />
        )}
        {err && <div className="text-[11.5px] text-danger">{err}</div>}
        <button onClick={submit} disabled={busy}
          className="h-10 rounded-(--r-ctl) bg-primary text-on-primary text-[13px] font-bold pressable disabled:opacity-60">
          {busy ? "处理中…" : mode === "login" ? "登录" : "注册并登录"}
        </button>
      </div>
      <p className="text-[10.5px] text-dim mt-3 leading-relaxed">
        使用黄果短剧官网账号登录，登录态仅保存在本机。
      </p>
    </div>
  );

  return isMobile
    ? <Sheet open={loginOpen} onClose={() => setLoginOpen(false)}>{body}</Sheet>
    : <Modal open={loginOpen} onClose={() => setLoginOpen(false)} width={360}>{body}</Modal>;
}