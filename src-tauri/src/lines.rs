//! 线路（数据源）：固定线路 + 地址发布页上的镜像线路。
//!
//! 上游只是域名在变，请求链路与数据模型完全一致，所以「切线路」等价于换 `net::base()`。
//! 镜像地址来自 <https://huangguoai.pages.dev/>：那个页面本身是空壳，真正的清单在
//! `publish.js` 里（`var urls` 域名数组 + `var subdomains` 子域数组，页面自己随机拼）。

use serde_json::{json, Value};
use std::time::{Duration, Instant};

/// 固定线路：写死在客户端里，不依赖任何外部页面。
pub const FIXED: [(&str, &str); 2] = [
    ("固定线路 1", "https://huangguoai.com"),
    ("固定线路 2", "https://huangguoai.ai"),
];

const PUBLISH_PAGE: &str = "https://huangguoai.pages.dev/";
/// 镜像列表上限（子域 × 域名是笛卡尔积，界面只展示这么多）
const MIRROR_MAX: usize = 60;
/// 单条线路探测超时
const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
/// 自动换线时单条探测超时（比手动测速更急，别让首屏等太久）
const AUTO_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
/// 自动换线最多试多少个镜像（发布页镜像可达上百条，全试一遍要几分钟）
const AUTO_MIRROR_TRY: usize = 18;
/// 自动换线的总预算：超了就放弃，宁可报错也不无限卡首屏
const AUTO_BUDGET: Duration = Duration::from_secs(22);

/// 判断「这条线路真能跑业务」用的接口：最便宜且不需要登录。
const PROBE_PATH: &str = "/api/videos?page=1&size=1";

/// 兜底种子域名：发布页抓不到时用它自举。
///
/// 这些域名是**泛解析**（`<任意子域>.lbvrhyir.cc` 都能解析到同一组服务器，
/// 裸域反而不通），发布页自己也是用 `getRandomSubdomain()` 随机拼的。
/// 所以随机子域比写死的子域更难被定点封锁——每次启动换一批就行。
const SEED_DOMAINS: [&str; 1] = ["lbvrhyir.cc"];
/// 种子里的固定子域（大学代号，发布页给的原始清单）
const SEED_SUBS: [&str; 8] = ["thu", "pku", "fdu", "sjtu", "zju", "nju", "xmu", "sysu"];
/// 兜底时另外生成多少个随机子域
const SEED_RANDOM: usize = 6;

/// 6 位小写字母数字子域。不引 `rand`：纳秒时间 + 进程号做种子的 LCG 足够。
fn rand_sub() -> String {
    const ALPH: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9e37_79b9_7f4a_7c15);
    let mut x = nanos ^ (std::process::id() as u64).wrapping_mul(0x2545_f491_4f6c_dd1d);
    let mut s = String::with_capacity(6);
    for _ in 0..6 {
        x = x
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        s.push(ALPH[((x >> 33) % ALPH.len() as u64) as usize] as char);
    }
    s
}

/// 内置种子线路：随机子域优先（最不容易被封），再排固定子域。
pub fn seeds() -> Vec<String> {
    let mut out = Vec::new();
    for d in SEED_DOMAINS {
        for _ in 0..SEED_RANDOM {
            out.push(format!("https://{}.{d}", rand_sub()));
        }
        for s in SEED_SUBS {
            out.push(format!("https://{s}.{d}"));
        }
    }
    out
}

pub fn fixed() -> Value {
    json!(FIXED
        .iter()
        .map(|(name, url)| json!({ "name": name, "url": url }))
        .collect::<Vec<_>>())
}

/// 拉地址发布页 → 解析 publish.js → 拼出镜像地址。只在用户点开「线路」时调用。
///
/// 发布页打不开（被墙 / 改版）时退回内置种子，界面至少还有可选的线路，
/// 不会只剩一句「拉取失败」。
pub async fn mirrors() -> Result<Value, String> {
    let html = match get_text(PUBLISH_PAGE).await {
        Ok(h) => h,
        Err(e) => return Ok(seed_result(&format!("发布页打不开（{e}），已改用内置种子线路"))),
    };
    let js_rel = script_src(&html).unwrap_or_else(|| "publish.js".to_string());
    let js_url = absolute(PUBLISH_PAGE, &js_rel);
    let js = match get_text(&js_url).await {
        Ok(j) => j,
        Err(e) => return Ok(seed_result(&format!("发布页脚本拉取失败（{e}），已改用内置种子线路"))),
    };

    let domains = js_array(&js, "var urls");
    let subs = js_array(&js, "var subdomains");
    if domains.is_empty() {
        return Ok(seed_result("发布页格式有变化：没找到镜像域名，已改用内置种子线路"));
    }

    let mut items: Vec<Value> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    'outer: for domain in domains {
        let domain = domain.trim_end_matches('/').to_string();
        if domain.is_empty() {
            continue;
        }
        let hosts: Vec<String> = if subs.is_empty() {
            vec![domain.clone()]
        } else {
            subs.iter().map(|s| format!("{s}.{domain}")).collect()
        };
        for host in hosts {
            if !seen.insert(host.clone()) {
                continue;
            }
            items.push(json!({ "url": format!("https://{host}"), "host": host }));
            if items.len() >= MIRROR_MAX {
                break 'outer;
            }
        }
    }
    if items.is_empty() {
        return Ok(seed_result("发布页里没有可用的镜像地址，已改用内置种子线路"));
    }

    Ok(json!({ "source": PUBLISH_PAGE, "script": js_url, "items": items }))
}

/// 内置种子作为镜像清单返回（带 `fallback` 标记，自动换线据此跳过重复探测）。
fn seed_result(note: &str) -> Value {
    let items: Vec<Value> = seeds()
        .into_iter()
        .map(|url| {
            let host = url.trim_start_matches("https://").to_string();
            json!({ "url": url, "host": host })
        })
        .collect();
    json!({
        "source": "内置种子",
        "note": note,
        "fallback": true,
        "items": items,
    })
}

/// 可达性探测（并发 6 条一组）。只报结果，不做自动切换。
///
/// 注意：判据是**真实业务接口**，不是首页。有些线路根路径 200 但 `/api/edge/request`
/// 是 404（空壳跳转页），只看首页会误报「可用」。
pub async fn probe(urls: Vec<String>) -> Value {
    let mut out: Vec<Value> = Vec::new();
    for chunk in urls.chunks(6) {
        let mut handles = Vec::new();
        for u in chunk {
            let u = u.clone();
            handles.push(tokio::spawn(async move { probe_one(u).await }));
        }
        for h in handles {
            if let Ok(v) = h.await {
                out.push(v);
            }
        }
    }
    json!(out)
}

async fn probe_one(url: String) -> Value {
    let started = Instant::now();
    let res = api_ok(&url, PROBE_TIMEOUT).await;
    let ms = started.elapsed().as_millis() as u64;
    match res {
        Ok(()) => json!({ "url": url, "ok": true, "status": 200, "ms": ms }),
        Err((Some(code), _)) => json!({ "url": url, "ok": false, "status": code, "ms": ms }),
        Err((None, e)) => json!({ "url": url, "ok": false, "ms": ms, "error": e }),
    }
}

/// 打一次边缘信封，判断该线路是否**真的在提供业务接口**。
///
/// `Ok(())` 可用；`Err((Some(code), _))` HTTP 通但不是有效接口；`Err((None, _))` 连不上。
async fn api_ok(url: &str, timeout: Duration) -> Result<(), (Option<u16>, String)> {
    let origin = url.trim_end_matches('/');
    let envelope = json!({
        "method": "GET",
        "path": PROBE_PATH,
        "body": "",
        "content_type": "",
    });
    let resp = crate::net::client()
        .post(format!("{origin}/api/edge/request"))
        .timeout(timeout)
        .header("Accept", "application/json")
        .header("Referer", format!("{origin}/"))
        .json(&envelope)
        .send()
        .await
        .map_err(|e| (None, crate::net::err_text(&e)))?;

    let status = resp.status();
    if !status.is_success() {
        return Err((Some(status.as_u16()), format!("HTTP {status}")));
    }
    let code = status.as_u16();
    let text = resp
        .text()
        .await
        .map_err(|e| (Some(code), crate::net::err_text(&e)))?;
    // 有效响应一定是 {"status":1,"data":…}；空壳站 / 跳转页返回的是 HTML
    match serde_json::from_str::<Value>(&text) {
        Ok(v) if v.get("status").is_some() || v.get("data").is_some() => Ok(()),
        _ => Err((Some(code), "返回的不是接口信封".to_string())),
    }
}

/// 自动换线：先试写死的固定线路，再试地址发布页上的镜像，返回第一条真能跑业务的地址。
///
/// 成功即落盘（`line.json`），下次启动直接用它，不会再探一遍。
/// 整体有 [`AUTO_BUDGET`] 预算，超时返回 `None`，绝不无限卡住首屏。
pub async fn auto_failover(current: &str) -> Option<String> {
    match tokio::time::timeout(AUTO_BUDGET, auto_failover_inner(current)).await {
        Ok(hit) => hit,
        Err(_) => None,
    }
}

async fn auto_failover_inner(current: &str) -> Option<String> {
    // 1) 写死的固定线路
    let fixed: Vec<String> = FIXED
        .iter()
        .map(|(_, u)| u.to_string())
        .filter(|u| u != current)
        .collect();
    if let Some(hit) = first_ok(&fixed, PROBE_TIMEOUT).await {
        let _ = crate::net::set_base(&hit);
        return Some(hit);
    }

    // 2) 内置种子（不需要任何外部页面，泛解析随机子域）
    let seed: Vec<String> = seeds().into_iter().filter(|u| u != current).collect();
    if let Some(hit) = first_ok(&seed, AUTO_PROBE_TIMEOUT).await {
        let _ = crate::net::set_base(&hit);
        return Some(hit);
    }

    // 3) 最后才去抓发布页（这一步本身也可能被墙，且要多花几秒）
    let Ok(v) = mirrors().await else {
        return None;
    };
    // 返回的是内置种子说明发布页没抓到，而种子在第 2 步已经试过了
    if v.get("fallback").and_then(|b| b.as_bool()) == Some(true) {
        return None;
    }
    let list: Vec<String> = v
        .get("items")
        .and_then(|i| i.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.get("url").and_then(|u| u.as_str()))
                .map(|s| s.to_string())
                .filter(|u| u != current)
                .take(AUTO_MIRROR_TRY)
                .collect()
        })
        .unwrap_or_default();

    let hit = first_ok(&list, AUTO_PROBE_TIMEOUT).await?;
    let _ = crate::net::set_base(&hit);
    Some(hit)
}

/// 并发 6 条一组探测，返回第一条可用的（同组内按完成顺序）。
async fn first_ok(urls: &[String], timeout: Duration) -> Option<String> {
    for chunk in urls.chunks(6) {
        let mut handles = Vec::new();
        for u in chunk {
            let u = u.clone();
            handles.push(tokio::spawn(async move {
                match api_ok(&u, timeout).await {
                    Ok(()) => Some(u),
                    Err(_) => None,
                }
            }));
        }
        for h in handles {
            if let Ok(Some(u)) = h.await {
                return Some(u);
            }
        }
    }
    None
}

async fn get_text(url: &str) -> Result<String, String> {
    let resp = crate::net::client()
        .get(url)
        .timeout(Duration::from_secs(12))
        .send()
        .await
        .map_err(|e| crate::net::err_text(&e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.text().await.map_err(|e| crate::net::err_text(&e))
}

/// 从 HTML 里挑出脚本地址（发布页只有一个 `publish.js?<版本>`）。
fn script_src(html: &str) -> Option<String> {
    let mut rest = html;
    while let Some(i) = rest.find("src=\"") {
        let after = &rest[i + 5..];
        let end = after.find('"')?;
        let candidate = &after[..end];
        if candidate.contains(".js") {
            return Some(candidate.to_string());
        }
        rest = &after[end..];
    }
    None
}

fn absolute(base: &str, rel: &str) -> String {
    if rel.starts_with("http://") || rel.starts_with("https://") {
        return rel.to_string();
    }
    let origin = url::Url::parse(base).ok().map(|u| {
        format!(
            "{}://{}",
            u.scheme(),
            u.host_str().unwrap_or_default()
        )
    });
    match origin {
        Some(o) if rel.starts_with('/') => format!("{o}{rel}"),
        Some(o) => format!("{o}/{rel}"),
        None => rel.to_string(),
    }
}

/// 取 JS 里 `var <name> = [ ... ]` 的字符串数组（去掉行尾 `//` 注释，但保留字符串里的 `//`）。
fn js_array(src: &str, decl: &str) -> Vec<String> {
    let Some(at) = src.find(decl) else {
        return Vec::new();
    };
    let rest = &src[at..];
    let Some(open) = rest.find('[') else {
        return Vec::new();
    };
    let Some(close) = rest[open..].find(']') else {
        return Vec::new();
    };
    strip_line_comments(&rest[open + 1..open + close])
        .split(',')
        .map(|raw| {
            raw.trim()
                .trim_matches(|c: char| c == '\'' || c == '"')
                .trim()
                .to_string()
        })
        .filter(|s| !s.is_empty())
        .collect()
}

/// 去掉 `//` 行尾注释（引号内的 `//` 是 URL，不能动）。
fn strip_line_comments(body: &str) -> String {
    let mut out = String::with_capacity(body.len());
    let mut quote: Option<char> = None;
    let mut chars = body.chars().peekable();
    while let Some(c) = chars.next() {
        match quote {
            Some(q) => {
                out.push(c);
                if c == q {
                    quote = None;
                }
            }
            None => {
                if c == '\'' || c == '"' {
                    quote = Some(c);
                    out.push(c);
                } else if c == '/' && chars.peek() == Some(&'/') {
                    for n in chars.by_ref() {
                        if n == '\n' {
                            out.push('\n');
                            break;
                        }
                    }
                } else {
                    out.push(c);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
var subdomains = [
    'thu',  // 清华
    'pku',  // 北大
];
var urls=[
	'xxbgwypx.cc/',
];
var otherUrls = [
	'https://huangguoai.pages.dev',
];
var foreverUrls = [
	  'https://huangguoai.com',
	JumpPage,
	'https://huangguoai.ai',
];
"#;

    #[test]
    fn parses_publish_js_arrays() {
        assert_eq!(js_array(SAMPLE, "var urls"), vec!["xxbgwypx.cc/"]);
        assert_eq!(js_array(SAMPLE, "var subdomains"), vec!["thu", "pku"]);
        assert_eq!(
            js_array(SAMPLE, "var foreverUrls"),
            vec!["https://huangguoai.com", "JumpPage", "https://huangguoai.ai"]
        );
    }

    #[test]
    fn resolves_relative_script() {
        assert_eq!(
            absolute("https://huangguoai.pages.dev/", "publish.js?20261103-2"),
            "https://huangguoai.pages.dev/publish.js?20261103-2"
        );
        assert_eq!(
            absolute("https://huangguoai.pages.dev/", "/a/b.js"),
            "https://huangguoai.pages.dev/a/b.js"
        );
    }

    #[test]
    fn picks_script_src() {
        let html = r#"<link rel="stylesheet" href="publish.css?1" /><script type="text/javascript" src="publish.js?20261103-2"></script>"#;
        assert_eq!(script_src(html).as_deref(), Some("publish.js?20261103-2"));
    }

    /// 手动跑：`cargo test --lib lines::tests::mirrors_live -- --nocapture`
    #[tokio::test]
    async fn mirrors_live() {
        match mirrors().await {
            Ok(v) => println!("{}", serde_json::to_string_pretty(&v).expect("json")),
            Err(e) => panic!("mirrors failed: {e}"),
        }
    }

    /// 手动跑：`cargo test --lib lines::tests::probe_live -- --nocapture`
    #[tokio::test]
    async fn probe_live() {
        let urls = vec![
            "https://huangguoai.com".to_string(),
            "https://huangguoai.ai".to_string(),
            "https://thu.xxbgwypx.cc".to_string(),
        ];
        println!("{}", serde_json::to_string_pretty(&probe(urls).await).expect("json"));
    }

    /// 手动跑（要联网，故 ignore）：
    /// `cargo test --lib lines::tests::auto_failover_live -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn auto_failover_live() {
        let started = Instant::now();
        let hit = auto_failover(crate::net::DEFAULT_BASE).await;
        println!(
            "auto_failover -> {hit:?}  耗时 {}ms",
            started.elapsed().as_millis()
        );
        assert!(hit.is_some(), "应该能自动找到一条可用线路");
    }
}
