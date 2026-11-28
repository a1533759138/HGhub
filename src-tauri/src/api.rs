//! 业务命令：登录 / 列表 / 详情 / 播放 / 互动。

use crate::net::{base, edge};
use crate::session::SessionStore;
use serde_json::{json, Value};
use tauri::State;

const PATH_SEGMENT: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
    .remove(b'-').remove(b'_').remove(b'.').remove(b'~');

pub struct Api {
    pub session: SessionStore,
}

impl Api {
    pub fn new() -> Self {
        Self {
            session: SessionStore::new(),
        }
    }

    fn token(&self) -> Option<String> {
        self.session.token()
    }

    async fn get(&self, path: &str) -> Result<Value, String> {
        let token = self.token();
        edge("GET", path, None, token.as_deref()).await
    }

    async fn authed(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
        let token = self
            .token()
            .ok_or_else(|| "请先登录".to_string())?;
        edge(method, path, body, Some(&token)).await
    }
}

/// 诊断用：把前端自检结果写到应用数据目录 debug.log
#[tauri::command]
pub async fn debug_log(app: tauri::AppHandle, msg: String) -> Result<(), String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("debug.log");
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{}", msg);
    }
    Ok(())
}

/// 网络自检：系统代理 / DNS / 连通性快照，用于远程定位「打不开」。
#[tauri::command]
pub async fn net_diag() -> Result<Value, String> {
    Ok(crate::net::diagnose().await)
}

/* ───────────────────────── 线路（数据源） ───────────────────────── */

/// 当前线路 + 固定线路清单（镜像线路另外按需拉取）。
#[tauri::command]
pub async fn line_state() -> Result<Value, String> {
    Ok(json!({
        "base": base(),
        "default": crate::net::DEFAULT_BASE,
        "fixed": crate::lines::fixed(),
    }))
}

/// 手动切换线路：立即生效并落盘（下次启动沿用）。
#[tauri::command]
pub async fn line_set(url: String) -> Result<String, String> {
    crate::net::set_base(&url)
}

/// 从地址发布页抓镜像线路（只在用户点开「线路」时调用）。
#[tauri::command]
pub async fn line_mirrors() -> Result<Value, String> {
    // 用户手动点「刷新 / 打开线路」时重新读一次系统代理：代理软件开关过之后旧客户端会卡死
    crate::net::refresh_client();
    crate::lines::mirrors().await
}

/// 从国内直连中转页（hgai18.com）抓当前直连线路。大陆无需代理，第一优先数据源。
#[tauri::command]
pub async fn line_relay() -> Result<Value, String> {
    crate::net::refresh_client();
    crate::lines::relay_mirrors().await
}

/// 自动测速并切换到最快线路：收集固定线路 + 中转页直连线路 + 内置种子，
/// 全部探测后按延迟切换到最快的一条并落盘。
#[tauri::command]
pub async fn line_auto_fastest() -> Result<Value, String> {
    crate::net::refresh_client();
    Ok(crate::lines::auto_switch_fastest(&crate::net::base()).await)
}

/// 可达性探测：只报结果，不改当前线路。
/// （自动换线发生在 [`crate::net::edge`] 里，请求失败时才触发。）
#[tauri::command]
pub async fn line_probe(urls: Vec<String>) -> Result<Value, String> {
    crate::net::refresh_client();
    Ok(crate::lines::probe(urls).await)
}

/* ───────────────────────── 更新检查 ───────────────────────── */

const REPO: &str = "Minireel/HGhub";

fn ver_parts(v: &str) -> Vec<u64> {
    v.trim()
        .trim_start_matches(['v', 'V'])
        .split(['.', '-', '+'])
        .map(|s| s.trim().parse::<u64>().unwrap_or(0))
        .collect()
}

/// 只比较数字段：`v1.2.0` > `1.1.9`；解析不出的段按 0 处理。
fn is_newer(latest: &str, current: &str) -> bool {
    let (a, b) = (ver_parts(latest), ver_parts(current));
    for i in 0..a.len().max(b.len()) {
        let x = *a.get(i).unwrap_or(&0);
        let y = *b.get(i).unwrap_or(&0);
        if x != y {
            return x > y;
        }
    }
    false
}

/// 对比 GitHub Release 的 tag 与当前版本（未认证 60 次/小时/IP，够用）。
#[tauri::command]
pub async fn check_update() -> Result<Value, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let resp = crate::net::client()
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(12))
        .send()
        .await
        .map_err(|e| crate::net::err_text(&e))?;

    let status = resp.status();
    if status.as_u16() == 404 {
        // 还没发过 release
        return Ok(json!({
            "current": current, "latest": "", "has_update": false,
            "url": format!("https://github.com/{REPO}/releases"),
        }));
    }
    if !status.is_success() {
        return Err(format!("GitHub 返回 HTTP {status}"));
    }

    let v: Value = resp.json().await.map_err(|e| crate::net::err_text(&e))?;
    let tag = v.get("tag_name").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let html = v
        .get("html_url")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("https://github.com/{REPO}/releases"));
    let notes = v.get("body").and_then(|x| x.as_str()).unwrap_or("");

    Ok(json!({
        "current": current,
        "latest": tag.trim_start_matches(['v', 'V']).to_string(),
        "tag": tag,
        "has_update": !tag.is_empty() && is_newer(&tag, &current),
        "url": html,
        "name": v.get("name").and_then(|x| x.as_str()).unwrap_or(""),
        "published_at": v.get("published_at").and_then(|x| x.as_str()).unwrap_or(""),
        "notes": notes.chars().take(800).collect::<String>(),
    }))
}

/// 使用系统浏览器打开链接，移动端通过 Tauri 的原生 opener 插件处理。
#[tauri::command]
pub async fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let parsed = url::Url::parse(&url).map_err(|_| "链接格式无效".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("只允许打开 http(s) 链接".to_string());
    }
    app.opener().open_url(parsed.as_str(), None::<&str>).map_err(|e| e.to_string())
}

/* ───────────────────────── 会话 ───────────────────────── */

#[tauri::command]
pub async fn app_boot(state: State<'_, Api>) -> Result<Value, String> {
    Ok(json!({
        "user": state.session.user(),
        "logged_in": state.session.token().is_some(),
        "base": base(),
    }))
}

#[tauri::command]
pub async fn api_login(
    state: State<'_, Api>,
    username: String,
    password: String,
) -> Result<Value, String> {
    let data = edge(
        "POST",
        "/api/account/loginByPassword",
        Some(json!({ "username": username, "password": password })),
        None,
    )
    .await?;
    let token = data
        .get("token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "登录返回缺少 token".to_string())?
        .to_string();
    let user = data.get("user").cloned().unwrap_or(Value::Null);
    state.session.set(token, user.clone());
    Ok(json!({ "user": user }))
}

#[tauri::command]
pub async fn api_register(
    state: State<'_, Api>,
    username: String,
    password: String,
    email: String,
) -> Result<Value, String> {
    let mut body = json!({
        "username": username,
        "password": password,
        "confirm_password": password,
    });
    if !email.trim().is_empty() {
        body["email"] = json!(email);
    }
    let data = edge("POST", "/api/account/registerByPassword", Some(body), None).await?;
    let token = data
        .get("token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "注册返回缺少 token".to_string())?
        .to_string();
    let user = data.get("user").cloned().unwrap_or(Value::Null);
    state.session.set(token, user.clone());
    Ok(json!({ "user": user }))
}

#[tauri::command]
pub async fn api_logout(state: State<'_, Api>) -> Result<Value, String> {
    let token = state.token();
    let _ = edge("POST", "/api/account/logout", None, token.as_deref()).await;
    state.session.clear();
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn api_me(state: State<'_, Api>) -> Result<Value, String> {
    let me = state.get("/api/account/me").await?;
    if let Some(user) = state.session.token() {
        state.session.set(user, me.clone());
    }
    Ok(me)
}

/* ───────────────────────── 列表 ───────────────────────── */

#[tauri::command]
pub async fn api_home(state: State<'_, Api>) -> Result<Value, String> {
    let mut data = state.get("/api/home").await?;
    normalize_home_assets(&mut data, &base());
    Ok(data)
}

#[tauri::command]
pub async fn api_home_featured() -> Result<Value, String> {
    crate::catalog::home_featured().await
}

fn normalize_home_assets(data: &mut Value, base: &str) {
    let Some(data) = data.as_object_mut() else { return; };
    for section in ["featured", "latest", "topic_rec"] {
        let Some(items) = data.get_mut(section).and_then(Value::as_array_mut) else { continue; };
        for item in items {
            for field in ["cover", "image"] {
                let Some(path) = item.get(field).and_then(Value::as_str).map(str::to_string) else { continue; };
                if path.starts_with('/') {
                    if let Ok(url) = url::Url::parse(base).and_then(|origin| origin.join(&path)) {
                        item[field] = Value::String(url.to_string());
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub async fn api_feed(state: State<'_, Api>, page: u32, size: u32) -> Result<Value, String> {
    state
        .get(&format!("/api/videos?page={page}&size={size}"))
        .await
}

fn category_path(cate: &str, page: u32, size: u32) -> String {
    let cate = percent_encoding::utf8_percent_encode(cate, PATH_SEGMENT);
    format!("/api/videos/category/{cate}?page={}&size={}", page.max(1), size.clamp(1, 50))
}

fn category_query(cate: &str, page: u32, size: u32, sort: &str, original: bool) -> String {
    let mut path = category_path(cate, page, size);
    if sort == "hot" {
        path.push_str("&sort=hot");
    }
    if original {
        path.push_str("&is_original=1");
        if sort == "latest" || sort.is_empty() {
            path.push_str("&sort=latest");
        }
    }
    path
}

#[tauri::command]
pub async fn api_category(
    state: State<'_, Api>,
    cate: String,
    page: u32,
    size: u32,
    sort: Option<String>,
    original: Option<bool>,
) -> Result<Value, String> {
    let sort = sort.as_deref().unwrap_or("latest");
    match sort {
        "latest" | "" | "hot" => {
            state.get(&category_query(&cate, page, size, sort, original.unwrap_or(false))).await
        }
        // 当前公开 REST 拒绝这两个排序参数；沿用网站服务器渲染列表的实际顺序。
        mode @ ("hot_window" | "random") => {
            if original.unwrap_or(false) {
                return Err("此排序暂不支持原创筛选".to_string());
            }
            crate::catalog::category(&cate, page, mode).await
        }
        _ => Err("不支持的排序方式".to_string()),
    }
}

#[tauri::command]
pub async fn api_rank(state: State<'_, Api>, kind: String) -> Result<Value, String> {
    let kind = match kind.as_str() {
        "recommend" | "potential" => kind,
        _ => "hot".to_string(),
    };
    state.get(&format!("/api/ranks/{kind}")).await
}

#[tauri::command]
pub async fn api_search(
    state: State<'_, Api>,
    q: String,
    page: u32,
    size: u32,
) -> Result<Value, String> {
    let encoded: String = url::form_urlencoded::byte_serialize(q.as_bytes()).collect();
    state
        .get(&format!("/api/search?q={encoded}&page={page}&size={size}"))
        .await
}

#[tauri::command]
pub async fn api_posts(state: State<'_, Api>, page: u32, size: u32) -> Result<Value, String> {
    state
        .get(&format!("/api/posts?page={page}&size={size}"))
        .await
}

#[tauri::command]
pub async fn api_post(state: State<'_, Api>, id: i64) -> Result<Value, String> {
    state.get(&format!("/api/posts/{id}")).await
}

/* ───────────────────────── 专题 ───────────────────────── */

/// 专题列表：`GET /api/topics` → `{items:[{id,title,slug,cover,intro,video_count}], pagination}`
#[tauri::command]
pub async fn api_topics(state: State<'_, Api>, page: u32, size: u32) -> Result<Value, String> {
    state.get(&format!("/api/topics?page={page}&size={size}")).await
}

/// 专题详情：`GET /api/topics/{slug}` → `{topic:{...}, videos:{items:[...], pagination}, related:[...]}`
#[tauri::command]
pub async fn api_topic(
    state: State<'_, Api>, slug: String, page: Option<u32>, size: Option<u32>,
) -> Result<Value, String> {
    let slug = percent_encoding::utf8_percent_encode(&slug, PATH_SEGMENT);
    state.get(&format!("/api/topics/{slug}?page={}&size={}", page.unwrap_or(1).max(1), size.unwrap_or(20).clamp(1, 50))).await
}

/* ───────────────────────── 详情 / 播放 ───────────────────────── */

#[tauri::command]
pub async fn api_video(state: State<'_, Api>, id: i64) -> Result<Value, String> {
    state.get(&format!("/api/videos/{id}")).await
}

#[tauri::command]
pub async fn api_play(state: State<'_, Api>, id: i64, ep: u32) -> Result<Value, String> {
    // 上游接口已改版：旧 `GET /api/videos/{id}/play` 现在返回空 video_url，
    // 播放地址移到新接口 `POST /api/videos/{id}/episodes/{ep}/playback`（无需登录），
    // 其中 `data.streams.main` 是 m3u8 地址。这里统一转回前端熟悉的 `video_url` 字段。
    let token = state.token();
    let data = edge(
        "POST",
        &format!("/api/videos/{id}/episodes/{ep}/playback"),
        None,
        token.as_deref(),
    )
    .await?;
    let video_url = data
        .get("streams")
        .and_then(|s| s.get("main"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            data.get("video_url")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
        })
        .unwrap_or_default();

    let mut out = json!({
        "id": data.get("id").and_then(|v| v.as_str()).and_then(|s| s.parse::<i64>().ok()).unwrap_or(id),
        "ep_num": data.get("ep").and_then(|v| v.as_i64()).unwrap_or(ep as i64),
        "duration": data.get("duration").and_then(|v| v.as_i64()).unwrap_or(0),
        "title": data.get("title").and_then(|v| v.as_str()).unwrap_or(""),
        "video_url": video_url,
    });
    // 附带 cdn 鉴权信息（若有，取 m3u8/分片时可能需要）
    if let Some(cdn) = data.get("cdn") {
        out["cdn"] = cdn.clone();
    }
    Ok(out)
}

/* ───────────────────────── 评论 / 互动 ───────────────────────── */

#[tauri::command]
pub async fn api_comments(
    state: State<'_, Api>,
    id: i64,
    ep: u32,
    page: u32,
    size: u32,
) -> Result<Value, String> {
    state
        .get(&format!(
            "/api/videos/{id}/comments?ep={ep}&page={page}&size={size}"
        ))
        .await
}

#[tauri::command]
pub async fn api_comment_send(
    state: State<'_, Api>,
    id: i64,
    ep: u32,
    text: String,
    reply_id: Option<i64>,
) -> Result<Value, String> {
    let mut body = json!({ "text": text });
    let path = match reply_id {
        Some(rid) if rid > 0 => {
            body["reply_id"] = json!(rid);
            format!("/api/videos/{id}/comments")
        }
        _ => format!("/api/videos/{id}/comments?ep={ep}"),
    };
    state.authed("POST", &path, Some(body)).await
}

#[tauri::command]
pub async fn api_like(
    state: State<'_, Api>,
    id: i64,
    ep: u32,
    on: bool,
) -> Result<Value, String> {
    let method = if on { "POST" } else { "DELETE" };
    state
        .authed(method, &format!("/api/videos/{id}/like?ep={ep}"), None)
        .await
}

#[tauri::command]
pub async fn api_collect(
    state: State<'_, Api>,
    id: i64,
    on: bool,
) -> Result<Value, String> {
    let method = if on { "POST" } else { "DELETE" };
    state
        .authed(method, &format!("/api/videos/{id}/collect"), None)
        .await
}

#[tauri::command]
pub async fn api_follow(
    state: State<'_, Api>,
    uid: i64,
    on: bool,
) -> Result<Value, String> {
    let method = if on { "POST" } else { "DELETE" };
    state
        .authed(method, &format!("/api/users/{uid}/follow"), None)
        .await
}

/* ───────────────────────── 本地缓存 ───────────────────────── */

#[tauri::command]
pub async fn cache_clear() -> Result<(), String> {
    crate::media::clear_caches();
    Ok(())
}

/* ───────────────────────── 吃瓜帖子互动 ───────────────────────── */

#[tauri::command]
pub async fn api_post_like(state: State<'_, Api>, id: i64, on: bool) -> Result<Value, String> {
    let method = if on { "POST" } else { "DELETE" };
    state
        .authed(method, &format!("/api/posts/{id}/like"), None)
        .await
}

#[tauri::command]
pub async fn api_post_collect(state: State<'_, Api>, id: i64, on: bool) -> Result<Value, String> {
    let method = if on { "POST" } else { "DELETE" };
    state
        .authed(method, &format!("/api/posts/{id}/collect"), None)
        .await
}

#[tauri::command]
pub async fn api_post_comments(
    state: State<'_, Api>,
    id: i64,
    page: u32,
    size: u32,
) -> Result<Value, String> {
    state
        .get(&format!("/api/posts/{id}/comments?page={page}&size={size}"))
        .await
}
#[cfg(test)]
mod tests {
    use super::{category_path, category_query, is_newer};

    #[test]
    fn category_paths_bound_paging_and_encode_segments() {
        assert_eq!(category_path("ai-duanju", 0, 20), "/api/videos/category/ai-duanju?page=1&size=20");
        assert_eq!(category_path("a/b", 2, 500), "/api/videos/category/a%2Fb?page=2&size=50");
        assert_eq!(category_query("ai-duanju", 1, 20, "hot", false), "/api/videos/category/ai-duanju?page=1&size=20&sort=hot");
        assert_eq!(category_query("ai-duanju", 1, 50, "latest", true), "/api/videos/category/ai-duanju?page=1&size=50&is_original=1&sort=latest");
    }

    #[test]
    fn normalizes_relative_assets_in_home_sections() {
        let mut home = serde_json::json!({
            "featured": [{ "cover": "/upload/a.jpg" }],
            "latest": [{ "cover": "https://cdn.example/b.jpg" }],
            "topic_rec": [{ "cover": "/upload/topic.jpg" }],
        });
        super::normalize_home_assets(&mut home, "https://mirror.example");
        assert_eq!(home["featured"][0]["cover"], "https://mirror.example/upload/a.jpg");
        assert_eq!(home["latest"][0]["cover"], "https://cdn.example/b.jpg");
        assert_eq!(home["topic_rec"][0]["cover"], "https://mirror.example/upload/topic.jpg");
    }

    #[test]
    fn compares_versions() {
        assert!(is_newer("v1.0.2", "1.0.1"));
        assert!(is_newer("v1.1", "1.0.9"));
        assert!(is_newer("1.0.10", "1.0.9"));
        assert!(!is_newer("v1.0.1", "1.0.1"));
        assert!(!is_newer("v0.9.9", "1.0.1"));
        assert!(!is_newer("", "1.0.1"));
    }
}
