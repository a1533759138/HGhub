//! 网络层：与上游站点对话。
//!
//! 站点把全部 `/api/**` 调用收敛成 `POST /api/edge/request` 的信封，
//! 我们只实现这一个入口，其余接口都是「填 path」。
//!
//! # 代理（用户反馈「浏览器能开、HGhub 打不开」的根因就在这里）
//!
//! 客户端的流量**全部**走本文件的 reqwest，跟 WebView2 无关，所以它既不共享
//! 浏览器的代理设置，也不共享浏览器的证书库：
//!
//! * reqwest 只有开了 `system-proxy` feature 才会读 Windows 系统代理
//!   （`HKCU\...\Internet Settings` 的 `ProxyEnable`/`ProxyServer`/`ProxyOverride`）。
//!   本 crate 用 `default-features = false`，早先漏了这个 feature ⇒ 永远直连，
//!   只有 TUN/虚拟网卡这种网络层接管才「看起来能用」。
//! * 即使开了 `system-proxy`，PAC（`AutoConfigURL`）也不被支持，只认固定代理。
//! * Android 没有注册表可读，系统「Wi-Fi 代理」同样不被 reqwest 采用；
//!   安卓上只有 VPN/TUN 模式（VpnService 抓全流量）才有效。
//!
//! 排查手段：环境变量 `HGHUB_PROXY=http://127.0.0.1:7897` 可强制指定代理，
//! `net_diag` 命令会输出 DNS/HTTP/环境变量快照。

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

/// 默认上游（固定线路 1）。
pub const DEFAULT_BASE: &str = "https://huangguoai.com";

/// 当前上游基址（不带结尾斜杠）。可在设置里切到固定线路 2 或镜像线路，运行时立即生效。
static BASE: Lazy<RwLock<String>> = Lazy::new(|| RwLock::new(DEFAULT_BASE.to_string()));
/// 线路配置落盘位置（应用数据目录/line.json），由 [`bind_base`] 在启动时绑定。
static BASE_FILE: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

/// 当前上游基址。
pub fn base() -> String {
    BASE.read()
        .map(|b| b.clone())
        .unwrap_or_else(|_| DEFAULT_BASE.to_string())
}

/// 规整线路地址：必须是 http(s) 且带 host，去掉结尾斜杠。
pub fn normalize_base(url: &str) -> Option<String> {
    let trimmed = url.trim();
    let parsed = url::Url::parse(trimmed).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }
    parsed.host_str()?;
    Some(trimmed.trim_end_matches('/').to_string())
}

/// 启动时读回上次选择的线路（文件不存在 / 内容坏了就保持默认）。
pub fn bind_base(dir: &std::path::Path) {
    let path = dir.join("line.json");
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            if let Some(next) = v.get("base").and_then(|x| x.as_str()).and_then(normalize_base) {
                if let Ok(mut cur) = BASE.write() {
                    *cur = next;
                }
            }
        }
    }
    if let Ok(mut f) = BASE_FILE.write() {
        *f = Some(path);
    }
}

/// 切换线路并落盘，返回规整后的地址。
pub fn set_base(url: &str) -> Result<String, String> {
    let next = normalize_base(url).ok_or_else(|| "线路地址无效（需要 http(s)://域名）".to_string())?;
    if let Ok(mut cur) = BASE.write() {
        *cur = next.clone();
    }
    if let Some(path) = BASE_FILE.read().ok().and_then(|p| p.clone()) {
        let _ = std::fs::write(path, json!({ "base": next }).to_string());
    }
    Ok(next)
}

pub const UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/// 手动指定代理（排查 / 公司内网用）：`HGHUB_PROXY=http://127.0.0.1:7897`。
/// 不设时交给 reqwest 的 `system-proxy` 探测（注册表 + 环境变量）。
fn proxy_override() -> Option<String> {
    std::env::var("HGHUB_PROXY")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// 按**当前**系统代理设置新建一个客户端。
///
/// 注意：reqwest 的 `system-proxy` 只在构建时读一次注册表 / 环境变量。代理软件被关掉后，
/// 旧客户端仍会往 `127.0.0.1:7897` 建隧道，症状是满屏 `tunnel error: failed to create
/// underlying connection`（浏览器却是通的，因为它每次都重读系统代理）。所以这里允许重建。
fn build_client() -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(6))
        .gzip(true)
        .brotli(true)
        .pool_idle_timeout(Duration::from_secs(60));
    if let Some(p) = proxy_override() {
        match reqwest::Proxy::all(&p) {
            Ok(proxy) => builder = builder.proxy(proxy),
            Err(e) => eprintln!("[net] 忽略无效的 HGHUB_PROXY={p}: {e}"),
        }
    }
    builder.build().expect("build http client")
}

static CLIENT: Lazy<RwLock<Arc<reqwest::Client>>> = Lazy::new(|| RwLock::new(Arc::new(build_client())));

/// 当前 HTTP 客户端（克隆只是 Arc 计数）。
pub fn client() -> Arc<reqwest::Client> {
    CLIENT
        .read()
        .map(|c| c.clone())
        .unwrap_or_else(|_| Arc::new(build_client()))
}

/// 重新读取系统代理。代理软件开关过之后调用；在途请求仍用旧客户端跑完，不影响。
pub fn refresh_client() {
    let fresh = Arc::new(build_client());
    if let Ok(mut cur) = CLIENT.write() {
        *cur = fresh;
    }
}

/// 看起来像代理 / 隧道问题（而不是目标站点本身不可达）。
pub fn is_proxy_error(e: &str) -> bool {
    let e = e.to_ascii_lowercase();
    e.contains("tunnel") || e.contains("proxy")
}

/// 连接层失败：超时 / 拒绝 / DNS 解析不出来。
pub fn is_connect_error(e: &str) -> bool {
    let e = e.to_ascii_lowercase();
    e.contains("connect")
        || e.contains("timed out")
        || e.contains("timeout")
        || e.contains("refused")
        || e.contains("dns")
        || e.contains("unreachable")
        || e.contains("reset")
}

/// 这条线路「不可用」：连不上，或者根本没在提供接口。
///
/// 后一种很常见：镜像域名过期后变成跳转页 / 空壳站，根路径 200 但
/// `/api/edge/request` 是 404、405 或 502。这种也算换线的理由。
pub fn is_line_error(e: &str) -> bool {
    if is_connect_error(e) {
        return true;
    }
    ["HTTP 404", "HTTP 405", "HTTP 502", "HTTP 503", "HTTP 504"]
        .iter()
        .any(|p| e.starts_with(p))
}

/// 自动换线只跑一次：并发请求共享同一轮探测，失败后 60 秒内不再重试。
static FAILOVER_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));
static FAILOVER_AT: Lazy<std::sync::Mutex<Option<Instant>>> =
    Lazy::new(|| std::sync::Mutex::new(None));

/// 当前线路挂了，尝试自动切到一条能用的。返回新基址（`None` 表示没找到）。
async fn failover_once(current: &str) -> Option<String> {
    let _guard = FAILOVER_LOCK.lock().await;
    // 别的并发请求可能已经把线路换好了，直接用
    let now = base();
    if now != current {
        return Some(now);
    }
    {
        let mut last = FAILOVER_AT.lock().ok()?;
        if let Some(t) = *last {
            if t.elapsed() < Duration::from_secs(60) {
                return None;
            }
        }
        *last = Some(Instant::now());
    }
    crate::lines::auto_failover(current).await
}

static LAST_HEAL: Lazy<std::sync::Mutex<Option<Instant>>> = Lazy::new(|| std::sync::Mutex::new(None));

/// 请求失败后按需重建客户端：代理隧道错误、连接被拒 / 超时都算「网络环境可能变了」。
/// 3 秒内只重建一次，批量探测不会反复重建。
pub fn heal_client(reason: &str) {
    if !is_proxy_error(reason) && !is_connect_error(reason) {
        return;
    }
    let mut last = match LAST_HEAL.lock() {
        Ok(l) => l,
        Err(_) => return,
    };
    if let Some(t) = *last {
        if t.elapsed() < Duration::from_secs(3) {
            return;
        }
    }
    *last = Some(Instant::now());
    drop(last);
    refresh_client();
}

/// reqwest 的 `Display` 只有「error sending request for url (...)」，
/// 真正的原因（dns error / connection refused / invalid peer certificate）
/// 藏在 `source()` 链里。展开成一行，界面和 debug.log 才有排查价值。
pub fn err_text(e: &reqwest::Error) -> String {
    let mut out = e.to_string();
    let mut src = std::error::Error::source(e);
    while let Some(s) = src {
        let t = s.to_string();
        if !t.is_empty() && !out.contains(&t) {
            out.push_str(" ← ");
            out.push_str(&t);
        }
        src = s.source();
    }
    out
}

/// 网络自检：DNS / HTTP / 代理相关环境变量，用于远程定位「打不开」。
pub async fn diagnose() -> Value {
    let cur = base();
    let host = url::Url::parse(&cur)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
        .unwrap_or_default();

    // fake-ip（198.18.0.0/15）说明 DNS 被 TUN 接管：关掉 TUN 后这个地址根本不可路由。
    let dns = {
        let host = host.clone();
        tokio::task::spawn_blocking(move || {
            use std::net::ToSocketAddrs;
            match (host.as_str(), 443u16).to_socket_addrs() {
                Ok(iter) => json!(iter.map(|a| a.ip().to_string()).collect::<Vec<_>>()),
                Err(e) => json!(format!("解析失败: {e}")),
            }
        })
        .await
        .unwrap_or(Value::Null)
    };

    let started = Instant::now();
    let http = match client().get(format!("{cur}/")).send().await {
        Ok(r) => json!({
            "status": r.status().as_u16(),
            "ms": started.elapsed().as_millis() as u64,
        }),
        Err(e) => json!({
            "error": err_text(&e),
            "ms": started.elapsed().as_millis() as u64,
        }),
    };

    json!({
        "base": cur,
        "host": host,
        "dns": dns,
        "http": http,
        "env": {
            "HTTP_PROXY": std::env::var("HTTP_PROXY").ok(),
            "HTTPS_PROXY": std::env::var("HTTPS_PROXY").ok(),
            "ALL_PROXY": std::env::var("ALL_PROXY").ok(),
            "NO_PROXY": std::env::var("NO_PROXY").ok(),
            "HGHUB_PROXY": proxy_override(),
        },
    })
}

/// 站点偶发 TLS 抖动（实测），统一重试；碰上代理隧道错误就先重建客户端再试
/// （代理软件开关后旧客户端会一直卡在 tunnel error 上）。
async fn with_retry<F, Fut, T>(mut f: F) -> Result<T, String>
where
    F: FnMut(reqwest::Client) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let mut last = String::from("network error");
    for attempt in 0..3 {
        match f(client().as_ref().clone()).await {
            Ok(v) => return Ok(v),
            Err(e) => {
                last = e;
                heal_client(&last);
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_millis(350 * (attempt as u64 + 1))).await;
                }
            }
        }
    }
    Err(last)
}

/// 真正发一次信封请求（不重试）。
async fn send_envelope(
    client: &reqwest::Client,
    url: &str,
    referer: &str,
    envelope: &Value,
    token: Option<&str>,
) -> Result<Value, String> {
    let mut req = client
        .post(url)
        .header("Accept", "application/json")
        .header("Referer", referer)
        .json(envelope);
    if let Some(t) = token {
        if !t.is_empty() {
            req = req.header("Authorization", format!("Bearer {t}"));
        }
    }
    let resp = req.send().await.map_err(|e| err_text(&e))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| err_text(&e))?;
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err("401".to_string());
    }
    if !status.is_success() {
        return Err(format!("HTTP {status}: {}", &text[..text.len().min(160)]));
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str::<Value>(&text).map_err(|e| format!("{e}: {}", &text[..text.len().min(160)]))
}

/// 单发一次（不重试）：用来**快速**判断这条线路是不是根本不通。
async fn post_envelope_once(
    cur: &str,
    envelope: &Value,
    token: Option<&str>,
) -> Result<Value, String> {
    let client = client();
    let url = format!("{cur}/api/edge/request");
    let referer = format!("{cur}/");
    send_envelope(client.as_ref(), &url, &referer, envelope, token).await
}

/// 往指定基址发信封请求（含 3 次重试与客户端自愈）。
async fn post_envelope(cur: &str, envelope: &Value, token: Option<&str>) -> Result<Value, String> {
    let url = format!("{cur}/api/edge/request");
    let referer = format!("{cur}/");
    let envelope = envelope.clone();
    let token = token.map(|s| s.to_string());

    with_retry(move |client: reqwest::Client| {
        let envelope = envelope.clone();
        let token = token.clone();
        let url = url.clone();
        let referer = referer.clone();
        async move {
            send_envelope(&client, &url, &referer, &envelope, token.as_deref()).await
        }
    })
    .await
}

/// 业务请求：走边缘信封。
///
/// 线路不通时**自动换线再试一次**（固定线路 → 发布页镜像）。换好的地址会落盘，
/// 所以这是一次性代价：iPhone 上 `huangguoai.com` 被 DNS 污染导致「没有网络」时，
/// 首次请求会自动落到可用镜像上，而不是永远报错。
///
/// 先用**单发**探一次：线路真挂了要立刻换，而不是在死域名上耗完 3 次重试（30 秒）。
pub async fn edge(
    method: &str,
    path: &str,
    body: Option<Value>,
    token: Option<&str>,
) -> Result<Value, String> {
    let (encoded, ctype) = match &body {
        Some(v) => (
            B64.encode(serde_json::to_vec(v).map_err(|e| e.to_string())?),
            "application/json",
        ),
        None => (String::new(), ""),
    };
    let envelope = json!({
        "method": method,
        "path": path,
        "body": encoded,
        "content_type": ctype,
    });

    let cur = base();
    let value = match post_envelope_once(&cur, &envelope, token).await {
        Ok(v) => v,
        Err(e) if is_line_error(&e) => match failover_once(&cur).await {
            Some(next) => {
                eprintln!("[net] 线路 {cur} 不可用（{e}），已自动切到 {next}");
                post_envelope(&next, &envelope, token).await?
            }
            // 没有别的线路可换：可能是瞬时抖动，回到本线路走完整重试
            None => post_envelope(&cur, &envelope, token).await?,
        },
        // 非线路问题（比如 5xx 抖动）：本线路重试即可
        Err(_) => post_envelope(&cur, &envelope, token).await?,
    };

    if value.is_null() {
        return Ok(Value::Null);
    }

    if value.get("status").and_then(|v| v.as_i64()) == Some(1) {
        Ok(value.get("data").cloned().unwrap_or(Value::Null))
    } else {
        Err(value
            .get("msg")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("接口返回失败")
            .to_string())
    }
}

/// 拉原始字节（图片 / m3u8 / 分片）。
pub async fn fetch_bytes(url: &str) -> Result<(Option<String>, Vec<u8>), String> {
    let url = url.to_string();
    let referer = format!("{}/", base());
    with_retry(|client: reqwest::Client| {
        let url = url.clone();
        let referer = referer.clone();
        async move {
            let resp = client
                .get(&url)
                .header("Referer", &referer)
                .send()
                .await
                .map_err(|e| err_text(&e))?;
            if !resp.status().is_success() {
                return Err(format!("HTTP {}", resp.status()));
            }
            let ctype = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
            let bytes = resp.bytes().await.map_err(|e| err_text(&e))?.to_vec();
            Ok((ctype, bytes))
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 手动跑：`cargo test --lib net::tests::diag -- --nocapture`
    /// 关掉 TUN、只留系统代理时跑一遍，能直接看出客户端有没有走代理。
    #[tokio::test]
    async fn diag() {
        println!(
            "{}",
            serde_json::to_string_pretty(&diagnose().await).expect("json")
        );
    }

    /// 手动跑（要联网，故 ignore）：
    /// `cargo test --lib net::tests::edge_auto_failover_live -- --ignored --nocapture`
    ///
    /// 从**被 DNS 污染的默认线路**起步，验证一次业务请求能否自动换线拿到数据。
    /// 这就是 iPhone 上「显示没有网络」的复现场景。
    #[tokio::test]
    #[ignore]
    async fn edge_auto_failover_live() {
        let _ = set_base(DEFAULT_BASE);
        let started = Instant::now();
        let v = edge("GET", "/api/videos?page=1&size=1", None, None).await;
        println!("耗时 {}ms", started.elapsed().as_millis());
        println!("当前线路: {}", base());
        match v {
            Ok(v) => {
                let n = v
                    .get("items")
                    .and_then(|i| i.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                println!("拿到 {n} 条视频");
                assert!(n > 0, "换线后应该能拿到数据");
            }
            Err(e) => panic!("请求失败: {e}"),
        }
    }
}
