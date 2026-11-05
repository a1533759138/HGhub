//! 媒体层：封面解密 + HLS 代理。
//!
//! 站点封面是 AES-128-CBC 密文，m3u8 内部分片/key 又可能被 WebView 的 CORS 拦住，
//! 所以图片与视频统一走本地自定义协议（Windows/Android 为 `http://hg.localhost`，
//! macOS 为 `hg://localhost`，见 [`LOCAL_ORIGIN`]）。

use crate::net::fetch_bytes;
use aes::cipher::{BlockDecrypt, KeyInit};
use aes::Aes128;
use once_cell::sync::Lazy;
use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::http::{Response, StatusCode};

/// 本平台自定义协议的完整基址。
///
/// Tauri 的自定义协议地址随平台不同：Windows / Android 是 `http://<scheme>.localhost`，
/// macOS / iOS / Linux 是 `<scheme>://localhost`。m3u8 里的分片与 key 地址按它改写。
/// 前端 `src/api.ts` 的 `LOCAL` 必须与此一致，否则封面与视频全部加载失败。
#[cfg(any(target_os = "windows", target_os = "android"))]
pub const LOCAL_ORIGIN: &str = "http://hg.localhost";
#[cfg(not(any(target_os = "windows", target_os = "android")))]
pub const LOCAL_ORIGIN: &str = "hg://localhost";

const IMG_KEY: &[u8] = b"f5d965df75336270";
const IMG_IV: &[u8] = b"97b60394abc2fbe1";

static IMG_CACHE: Lazy<Mutex<HashMap<String, Arc<Vec<u8>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
/// 播放列表 → (改写后的文本, 原始分片地址序列)
static PL_CACHE: Lazy<Mutex<HashMap<String, (Arc<String>, Arc<Vec<String>>)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

const IMG_CACHE_MAX: usize = 240;
const PL_CACHE_MAX: usize = 60;

fn cache_put<V: Clone>(map: &Mutex<HashMap<String, V>>, key: String, val: V, max: usize) {
    let mut m = map.lock().unwrap();
    if m.len() >= max {
        if let Some(k) = m.keys().next().cloned() {
            m.remove(&k);
        }
    }
    m.insert(key, val);
}

/* ───────────────────────── AES ───────────────────────── */

fn aes_cbc_decrypt(data: &[u8]) -> Option<Vec<u8>> {
    if data.is_empty() || data.len() % 16 != 0 {
        return None;
    }
    let cipher = Aes128::new_from_slice(IMG_KEY).ok()?;
    let mut prev = [0u8; 16];
    prev.copy_from_slice(IMG_IV);
    let mut out = Vec::with_capacity(data.len());
    for chunk in data.chunks(16) {
        let mut ct = [0u8; 16];
        ct.copy_from_slice(chunk);
        let mut block = ct;
        cipher.decrypt_block((&mut block).into());
        for i in 0..16 {
            out.push(block[i] ^ prev[i]);
        }
        prev = ct;
    }
    Some(out)
}

fn strip_padding(mut buf: Vec<u8>) -> Vec<u8> {
    let pad = *buf.last().unwrap_or(&0) as usize;
    if pad > 0 && pad <= 16 && buf.len() >= pad {
        if buf[buf.len() - pad..].iter().all(|b| *b as usize == pad) {
            buf.truncate(buf.len() - pad);
        }
    }
    buf
}

fn image_kind(buf: &[u8]) -> Option<&'static str> {
    if buf.len() < 12 {
        return None;
    }
    if buf[0] == 0xFF && buf[1] == 0xD8 {
        return Some("image/jpeg");
    }
    if buf.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        return Some("image/png");
    }
    if buf.starts_with(b"GIF8") {
        return Some("image/gif");
    }
    if buf.starts_with(b"RIFF") && &buf[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

/// 取封面：命中缓存直接返回，否则下载并按需解密。
pub async fn load_image(url: &str) -> Result<(String, Arc<Vec<u8>>), String> {
    if let Some(hit) = IMG_CACHE.lock().unwrap().get(url).cloned() {
        let kind = image_kind(&hit).unwrap_or("image/jpeg");
        return Ok((kind.to_string(), hit));
    }
    let (_, bytes) = fetch_bytes(url).await?;
    let plain = if image_kind(&bytes).is_some() {
        bytes
    } else {
        let dec = aes_cbc_decrypt(&bytes).ok_or_else(|| "封面解密失败".to_string())?;
        strip_padding(dec)
    };
    let kind = image_kind(&plain).unwrap_or("image/jpeg").to_string();
    let arc = Arc::new(plain);
    cache_put(&IMG_CACHE, url.to_string(), arc.clone(), IMG_CACHE_MAX);
    Ok((kind, arc))
}

/* ───────────────────────── HLS ───────────────────────── */

fn enc(s: &str) -> String {
    utf8_percent_encode(s, NON_ALPHANUMERIC).to_string()
}

fn dec(s: &str) -> String {
    percent_decode_str(s).decode_utf8_lossy().to_string()
}

fn absolutize(base: &str, target: &str) -> String {
    if target.starts_with("http://") || target.starts_with("https://") {
        return target.to_string();
    }
    if let Ok(b) = url::Url::parse(base) {
        if let Ok(j) = b.join(target) {
            return j.to_string();
        }
    }
    target.to_string()
}

fn rewrite_uri_attr(line: &str, prefix: &str) -> String {
    // #EXT-X-KEY:...URI="xxx" / #EXT-X-MAP:URI="xxx"
    if let Some(start) = line.find("URI=\"") {
        let rest = &line[start + 5..];
        if let Some(end) = rest.find('"') {
            let uri = &rest[..end];
            let new = format!("{prefix}/seg?u={}", enc(uri));
            return format!("{}{}{}", &line[..start + 5], new, &rest[end..]);
        }
    }
    line.to_string()
}

/// 取 m3u8 并把 key / 分片地址改写到本地协议。
pub async fn load_playlist(url: &str, prefix: &str) -> Result<Arc<String>, String> {
    if let Some((text, segs)) = PL_CACHE.lock().unwrap().get(url).cloned() {
        index_segments(&segs);
        return Ok(text);
    }
    let (_, bytes) = fetch_bytes(url).await?;
    let text = String::from_utf8_lossy(&bytes).to_string();

    let mut out = String::with_capacity(text.len() + 512);
    let mut segs = Vec::new();
    let mut after_inf = false;
    for raw in text.lines() {
        let line = raw.trim_end();
        if line.is_empty() {
            out.push('\n');
            continue;
        }
        if line.starts_with('#') {
            after_inf |= line.starts_with("#EXTINF");
            if line.starts_with("#EXT-X-KEY") || line.starts_with("#EXT-X-MAP") {
                // 先把相对 URI 绝对化再改写
                let absolute = absolutize_uri_in_attr(url, line);
                out.push_str(&rewrite_uri_attr(&absolute, prefix));
            } else {
                out.push_str(line);
            }
        } else {
            let absolute = absolutize(url, line);
            out.push_str(&format!("{prefix}/seg?u={}", enc(&absolute)));
            // 只记 #EXTINF 后面的媒体分片；master 列表里的子列表不预取
            if after_inf {
                segs.push(absolute);
            }
            after_inf = false;
        }
        out.push('\n');
    }

    let arc = Arc::new(out);
    let segs = Arc::new(segs);
    index_segments(&segs);
    cache_put(&PL_CACHE, url.to_string(), (arc.clone(), segs), PL_CACHE_MAX);
    Ok(arc)
}

fn absolutize_uri_in_attr(base: &str, line: &str) -> String {
    if let Some(start) = line.find("URI=\"") {
        let rest = &line[start + 5..];
        if let Some(end) = rest.find('"') {
            let uri = &rest[..end];
            let abs = absolutize(base, uri);
            return format!("{}{}{}", &line[..start + 5], abs, &rest[end..]);
        }
    }
    line.to_string()
}

/* ───────────────────────── 分片缓存 + 预取 ─────────────────────────
 * 分片约 5 秒 / 2MB，以前每次都现下：拖进度到没缓冲的地方，要等整片从上游下完才出画面。
 * 现在：同一分片并发请求只下一次（hls.js 取消重发、预取撞车都会合并），
 * 下完留在内存里（往回拖秒开），每取一片就顺序往后预取几片。 */

type Seg = (Option<String>, Arc<Vec<u8>>);
type SegCell = Arc<tokio::sync::OnceCell<Result<Seg, String>>>;

/// 分片缓存上限：约 30 片 / 2.5 分钟
const SEG_CACHE_BYTES: usize = 64 * 1024 * 1024;
/// 每取一片，往后预取几片（约 20 秒）
const SEG_PREFETCH: usize = 4;
const SEG_INDEX_MAX: usize = 20_000;

#[derive(Default)]
struct SegCache {
    cells: HashMap<String, SegCell>,
    /// 已下完的分片按完成先后排，超预算从最旧的扔
    done: VecDeque<(String, usize)>,
    bytes: usize,
}

static SEG_CACHE: Lazy<Mutex<SegCache>> = Lazy::new(|| Mutex::new(SegCache::default()));
/// 分片地址 → (所在播放列表的分片序列, 下标)，预取时据此找「下一片」
/// 预取代数：新的预取开始后，旧的就别再往下取了（拖到远处后不跟目标分片抢带宽）
static PREFETCH_GEN: AtomicU64 = AtomicU64::new(0);
static SEG_INDEX: Lazy<Mutex<HashMap<String, (Arc<Vec<String>>, usize)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn index_segments(segs: &Arc<Vec<String>>) {
    let Some(first) = segs.first() else { return };
    let mut idx = SEG_INDEX.lock().unwrap();
    if idx.contains_key(first) {
        return;
    }
    if idx.len() + segs.len() > SEG_INDEX_MAX {
        idx.clear();
    }
    for (i, u) in segs.iter().enumerate() {
        idx.insert(u.clone(), (segs.clone(), i));
    }
}

fn seg_account(url: &str, len: usize) {
    let mut c = SEG_CACHE.lock().unwrap();
    c.done.push_back((url.to_string(), len));
    c.bytes += len;
    while c.bytes > SEG_CACHE_BYTES && c.done.len() > 1 {
        let Some((old, n)) = c.done.pop_front() else { break };
        c.bytes = c.bytes.saturating_sub(n);
        c.cells.remove(&old);
    }
}

/// 取分片：命中缓存直接返回；正在下的就等同一个下载；失败不缓存。
async fn load_segment(url: &str) -> Result<Seg, String> {
    let cell: SegCell = SEG_CACHE.lock().unwrap().cells.entry(url.to_string()).or_default().clone();
    let res = cell
        .get_or_init(|| async {
            let r = fetch_bytes(url).await.map(|(ct, b)| (ct, Arc::new(b)));
            if let Ok((_, b)) = &r {
                seg_account(url, b.len());
            }
            r
        })
        .await
        .clone();
    if res.is_err() {
        let mut c = SEG_CACHE.lock().unwrap();
        if c.cells.get(url).is_some_and(|x| Arc::ptr_eq(x, &cell)) {
            c.cells.remove(url);
        }
    }
    res
}

/// 后台按顺序预取 `url` 之后的几片（顺序下，带宽先给最近要播的那片）。
fn prefetch_after(url: &str) {
    let next: Vec<String> = {
        let idx = SEG_INDEX.lock().unwrap();
        let Some((segs, i)) = idx.get(url) else { return };
        let cache = SEG_CACHE.lock().unwrap();
        segs.iter()
            .skip(i + 1)
            .take(SEG_PREFETCH)
            .filter(|u| !cache.cells.contains_key(*u))
            .cloned()
            .collect()
    };
    let round = PREFETCH_GEN.fetch_add(1, Ordering::Relaxed) + 1;
    if next.is_empty() {
        return;
    }
    tokio::spawn(async move {
        for u in next {
            if PREFETCH_GEN.load(Ordering::Relaxed) != round || load_segment(&u).await.is_err() {
                break;
            }
        }
    });
}

/// 清空封面 / 播放列表 / 分片内存缓存
pub fn clear_caches() {
    if let Ok(mut g) = IMG_CACHE.lock() { g.clear(); }
    if let Ok(mut g) = PL_CACHE.lock() { g.clear(); }
    if let Ok(mut g) = SEG_CACHE.lock() { *g = SegCache::default(); }
    if let Ok(mut g) = SEG_INDEX.lock() { g.clear(); }
}

/* ───────────────────────── 协议响应 ───────────────────────── */

fn respond(
    status: u16,
    ctype: &str,
    body: Vec<u8>,
    cache: &str,
) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::from_u16(status).unwrap_or(StatusCode::OK))
        .header("Content-Type", ctype)
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", cache)
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// 统一入口：`<LOCAL_ORIGIN>/img?u=` / `hls?u=` / `seg?u=`
///
/// `origin` 是本平台自定义协议的完整基址，见 [`LOCAL_ORIGIN`]；用于改写 m3u8 里的
/// 分片与 key 地址。正常情况下调用方直接传 [`LOCAL_ORIGIN`]。
pub async fn handle(path: &str, query: &str, origin: &str) -> Response<Vec<u8>> {
    let target = query
        .split('&')
        .find_map(|kv| kv.strip_prefix("u="))
        .map(dec)
        .unwrap_or_default();

    if target.is_empty() {
        return respond(400, "text/plain", b"missing u".to_vec(), "no-store");
    }

    match path {
        "/img" => match load_image(&target).await {
            Ok((kind, bytes)) => respond(200, &kind, bytes.as_ref().clone(), "public, max-age=86400"),
            Err(e) => respond(502, "text/plain", e.into_bytes(), "no-store"),
        },
        "/hls" => match load_playlist(&target, origin).await {
            Ok(text) => respond(
                200,
                "application/vnd.apple.mpegurl",
                text.as_bytes().to_vec(),
                "no-store",
            ),
            Err(e) => respond(502, "text/plain", e.into_bytes(), "no-store"),
        },
        "/seg" => match load_segment(&target).await {
            Ok((ctype, bytes)) => {
                prefetch_after(&target);
                respond(
                    200,
                    ctype.as_deref().unwrap_or("application/octet-stream"),
                    bytes.as_ref().clone(),
                    "public, max-age=3600",
                )
            }
            Err(e) => respond(502, "text/plain", e.into_bytes(), "no-store"),
        },
        _ => respond(404, "text/plain", b"not found".to_vec(), "no-store"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn live_play_chain() {
        use crate::net::edge;
        let play = edge("GET", "/api/videos/117/play?ep=3&page_texts=0", None, None).await
            .expect("play api");
        let url = play["video_url"].as_str().expect("video_url").to_string();
        println!("play url: {}", &url[..url.len().min(90)]);
        let (_, bytes) = fetch_bytes(&url).await.expect("fetch playlist");
        let text = String::from_utf8_lossy(&bytes);
        println!("raw playlist len={} head={}", text.len(), &text[..text.len().min(160)]);
        let q = format!("u={}", enc(&url));
        let resp = handle("/hls", &q, LOCAL_ORIGIN).await;
        let body = String::from_utf8_lossy(resp.body()).to_string();
        println!("proxied status={} len={}", resp.status(), body.len());
        assert!(body.contains("#EXTM3U"));
        // 取一个分片验证
        let seg_line = body.lines()
            .find(|l| !l.starts_with('#') && l.contains("/seg?u="))
            .expect("seg line").to_string();
        println!("seg line: {}", &seg_line[..seg_line.len().min(120)]);
        let seg_q = seg_line.split("?u=").nth(1).unwrap();
        let seg = handle("/seg", &format!("u={seg_q}"), LOCAL_ORIGIN).await;
        println!("segment status={} len={}", seg.status(), seg.body().len());
        assert_eq!(seg.status(), 200);
        assert!(seg.body().len() > 1000);
    }

    #[tokio::test]
    async fn segment_cache_and_prefetch() {
        use crate::net::edge;
        use std::time::{Duration, Instant};
        let play = edge("GET", "/api/videos/117/play?ep=3&page_texts=0", None, None).await
            .expect("play api");
        let url = play["video_url"].as_str().expect("video_url").to_string();
        let resp = handle("/hls", &format!("u={}", enc(&url)), "http://hg.localhost").await;
        let body = String::from_utf8_lossy(resp.body()).to_string();
        let segs: Vec<String> = body.lines()
            .filter(|l| !l.starts_with('#') && l.contains("/seg?u="))
            .map(|l| l.split("?u=").nth(1).unwrap().to_string())
            .collect();
        assert!(segs.len() > 50, "too few segments");

        // 同一分片并发请求只下一次
        let q = format!("u={}", segs[40]);
        let t = Instant::now();
        let (a, b) = tokio::join!(handle("/seg", &q, "http://hg.localhost"), handle("/seg", &q, "http://hg.localhost"));
        println!("cold seg 40: {:?} len={}", t.elapsed(), a.body().len());
        assert_eq!(a.status(), 200);
        assert_eq!(a.body(), b.body());
        assert_eq!(SEG_CACHE.lock().unwrap().done.iter().filter(|(u, _)| *u == dec(&segs[40])).count(), 1);

        // 之后几片应已在后台预取
        tokio::time::sleep(Duration::from_secs(8)).await;
        for i in 41..=40 + SEG_PREFETCH {
            let t = Instant::now();
            let r = handle("/seg", &format!("u={}", segs[i]), "http://hg.localhost").await;
            println!("prefetched seg {i}: {:?} len={}", t.elapsed(), r.body().len());
            assert_eq!(r.status(), 200);
            assert!(t.elapsed() < Duration::from_millis(200), "seg {i} not prefetched");
        }
    }

    #[tokio::test]
    async fn playlist_rewrite_works() {
        let m3u8 = "https://yd-lphu-hls.hzjvlo.cn/videos5/247f3c9862e8e1537ade0b20c45ac962/247f3c9862e8e1537ade0b20c45ac962.m3u8?auth_key=1793700503-0-0-b9575bb11258cf40cd5499c052fc5820&v=3&time=0&via=hgdj&via_bm=dx";
        let q = format!("u={}", enc(m3u8));
        let resp = handle("/hls", &q, LOCAL_ORIGIN).await;
        let body = String::from_utf8_lossy(resp.body()).to_string();
        println!("status={} len={}", resp.status(), body.len());
        println!("--- head ---\n{}", &body[..body.len().min(600)]);
        assert!(body.contains("#EXTM3U"), "not a playlist: {body}");
        assert!(body.contains("hg.localhost/seg?u="), "segments not rewritten");
    }

    #[tokio::test]
    async fn cover_decrypt_works() {
        let url = "https://pic.drleao.cn/upload_01/upload/20261029/2026102918545028336.jpg?auth_key=1793707703-0-0-1cbd9389b0b69141dd741f16bb71397a";
        match load_image(url).await {
            Ok((kind, bytes)) => {
                println!("kind={kind} len={}", bytes.len());
                assert!(kind.starts_with("image/"));
            }
            Err(e) => panic!("image failed: {e}"),
        }
    }
}