//! 分类排序的公开 HTML 兼容层：保留网站服务端给出的随机 / 热播顺序。

use scraper::{ElementRef, Html, Selector};
use serde_json::{json, Value};
use std::collections::HashSet;

// 已核对公开 SSR 页每页 39 张卡片；末页不能用实际卡片数覆盖分页大小。
const PAGE_SIZE: u64 = 39;

pub async fn category(cate: &str, page: u32, sort: &str) -> Result<Value, String> {
    let (panel, path) = category_path(cate, page, sort)?;
    let (base, bytes) = crate::net::fetch_public_page(&path).await?;
    let html = std::str::from_utf8(&bytes).map_err(|_| "分类页面编码无效".to_string())?;
    parse_page(&base, page, panel, html)
}

fn category_path(cate: &str, page: u32, sort: &str) -> Result<(&'static str, String), String> {
    if cate != "ai-duanju" {
        return Err("HTML 分类兼容层不支持此分类".to_string());
    }
    let panel = match sort {
        "random" => "random",
        "hot_window" => "hot",
        _ => return Err("HTML 分类兼容层不支持此排序".to_string()),
    };
    if page == 0 {
        return Err("分类页码必须从 1 开始".to_string());
    }
    let path = if page == 1 {
        format!("/ai-duanju/{panel}/")
    } else {
        format!("/ai-duanju/{panel}/{page}/")
    };
    Ok((panel, path))
}

fn selector(css: &str) -> Result<Selector, String> {
    Selector::parse(css).map_err(|_| "分类页面解析规则无效".to_string())
}

fn text(element: ElementRef<'_>) -> String {
    element
        .text()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn field_text(element: ElementRef<'_>, selector: &Selector) -> String {
    element
        .select(selector)
        .next()
        .map(text)
        .unwrap_or_default()
}

fn attr_number(element: ElementRef<'_>, name: &str, label: &str) -> Result<u64, String> {
    element
        .value()
        .attr(name)
        .and_then(|v| v.trim().parse().ok())
        .ok_or_else(|| format!("分类页面缺少有效{label}"))
}

struct CardSelectors {
    title: Selector,
    cover: Selector,
    episode: Selector,
    views: Selector,
    score: Selector,
    tags: Selector,
}

impl CardSelectors {
    fn new() -> Result<Self, String> {
        Ok(Self {
            title: selector(".hg-drama-card__title a")?,
            cover: selector(".hg-drama-card__cover-link img")?,
            episode: selector(".hg-drama-card__episode")?,
            views: selector(".hg-drama-card__views")?,
            score: selector(".hg-drama-card__score")?,
            tags: selector(".hg-drama-card__tags .hg-tag")?,
        })
    }
}

/// 文本节点排除图标的 alt；支持公开页面使用的 w 及常见数量单位。
fn metric(text: &str) -> Option<f64> {
    let start = text.find(|c: char| c.is_ascii_digit())?;
    let rest = &text[start..];
    let end = rest
        .find(|c: char| !c.is_ascii_digit() && c != '.' && c != ',')
        .unwrap_or(rest.len());
    let number: f64 = rest[..end].replace(',', "").parse().ok()?;
    let suffix = rest[end..].trim_start();
    let multiplier = if suffix.starts_with(['w', 'W', '万']) {
        10_000.0
    } else if suffix.starts_with('亿') {
        100_000_000.0
    } else if suffix.starts_with(['k', 'K', '千']) {
        1_000.0
    } else {
        1.0
    };
    let value = number * multiplier;
    value.is_finite().then_some(value)
}

fn parse_card(
    card: ElementRef<'_>,
    base: &str,
    selectors: &CardSelectors,
) -> Result<Value, String> {
    let id = ["data-track-item-id", "data-track-id"]
        .into_iter()
        .filter_map(|name| card.value().attr(name))
        .filter_map(|value| value.parse::<i64>().ok())
        .find(|id| *id > 0)
        .ok_or_else(|| "分类卡片缺少有效视频 ID".to_string())?;
    let title = field_text(card, &selectors.title);
    if title.is_empty() {
        return Err("分类卡片缺少标题".to_string());
    }
    let image = card
        .select(&selectors.cover)
        .next()
        .ok_or_else(|| "分类卡片缺少封面".to_string())?;
    let source = image
        .value()
        .attr("data-src")
        .filter(|src| !src.trim().is_empty())
        .or_else(|| image.value().attr("src"))
        .ok_or_else(|| "分类卡片缺少封面地址".to_string())?;
    let cover = url::Url::parse(base)
        .and_then(|origin| origin.join(source.trim()))
        .map_err(|_| "分类卡片封面地址无效".to_string())?;
    if !matches!(cover.scheme(), "http" | "https") {
        return Err("分类卡片封面不是有效的网络图片".to_string());
    }
    let episode = field_text(card, &selectors.episode);
    let episode_count = metric(&episode).unwrap_or(0.0) as u64;
    let is_finished = episode.starts_with('全') || episode.contains("已完结") || episode == "完结";
    let hot = metric(&field_text(card, &selectors.views))
        .unwrap_or(0.0)
        .round() as u64;
    let score = metric(&field_text(card, &selectors.score)).unwrap_or(0.0);
    let mut seen = HashSet::new();
    let tags: Vec<String> = card
        .select(&selectors.tags)
        .map(text)
        .filter(|tag| !tag.is_empty() && seen.insert(tag.clone()))
        .collect();
    Ok(json!({
        "id": id,
        "title": title,
        "cover": cover.as_str(),
        "tags": tags,
        "score": score,
        "episode_count": episode_count,
        "total_episodes": if is_finished { episode_count } else { 0 },
        "hot": hot,
        // 公开卡片未披露这些互动计数，不能从热度推算。
        "like_count": 0,
        "collect_count": 0,
        "comment_count": 0,
        "is_finished": is_finished,
        "is_original": 0,
    }))
}

fn parse_page(base: &str, requested_page: u32, panel: &str, source: &str) -> Result<Value, String> {
    let html = Html::parse_document(source);
    let main = html
        .select(&selector("[data-channel-page]")?)
        .next()
        .ok_or_else(|| "分类页面缺少主内容区域，请检查线路或网站结构".to_string())?;
    if main.value().attr("data-active-tab") != Some(panel) {
        return Err("分类页面返回的排序与请求不一致".to_string());
    }
    let current_page = attr_number(main, "data-page", "当前页码")?;
    if current_page != u64::from(requested_page) || current_page == 0 {
        return Err("分类页面返回的页码与请求不一致".to_string());
    }
    let grid = main
        .select(&selector(&format!(
            ".hg-card-grid[data-channel-panel='{panel}']"
        ))?)
        .next()
        .ok_or_else(|| "分类页面缺少对应排序的卡片网格".to_string())?;
    let total = attr_number(grid, "data-panel-total", "条目总数")?;
    let pager = main
        .select(&selector(&format!(
            ".hg-channel-pager[data-channel-panel='{panel}'] nav.hg-pager"
        ))?)
        .next()
        .ok_or_else(|| "分类页面缺少对应排序的分页信息".to_string())?;
    let jump = pager
        .select(&selector("[data-hg-pager-jump]")?)
        .next()
        .ok_or_else(|| "分类页面缺少分页跳转信息".to_string())?;
    let expected_template = format!("/ai-duanju/{panel}/{{page}}/");
    let first_url = format!("/ai-duanju/{panel}/");
    if jump.value().attr("data-jump-tpl") != Some(expected_template.as_str())
        || jump.value().attr("data-first-url") != Some(first_url.as_str())
    {
        return Err("分类页面分页路径与请求排序不一致".to_string());
    }
    let pages = attr_number(jump, "data-pages", "总页数")?;
    let pager_page = pager
        .select(&selector("[aria-current='page']")?)
        .next()
        .map(text)
        .and_then(|v| v.parse::<u64>().ok())
        .ok_or_else(|| "分类分页组件缺少有效当前页码".to_string())?;
    if pager_page != current_page
        || current_page > pages
        || pages != total.div_ceil(PAGE_SIZE).max(1)
    {
        return Err("分类页面分页数据不一致，请检查网站结构".to_string());
    }
    let selectors = CardSelectors::new()?;
    let items: Vec<Value> = grid
        .select(&selector(".hg-drama-card")?)
        .map(|card| parse_card(card, base, &selectors))
        .collect::<Result<_, _>>()?;
    let expected_count = total
        .saturating_sub((current_page - 1) * PAGE_SIZE)
        .min(PAGE_SIZE);
    if items.len() as u64 != expected_count {
        return Err("分类页面卡片数量与分页信息不一致，请检查网站结构".to_string());
    }
    Ok(json!({
        "items": items,
        "pagination": { "page": current_page, "pages": pages, "size": PAGE_SIZE, "total": total },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(id: u64) -> String {
        format!(
            r#"<div class="hg-drama-card" data-track-item-id="{id}" data-track-id="{id}">
          <a class="hg-drama-card__cover-link"><img src="/placeholder.svg" data-src="/cover-{id}.jpg?a=1&amp;b=2"></a>
          <span class="hg-drama-card__score">8.3分</span>
          <span class="hg-drama-card__episode">更新至3集</span>
          <span class="hg-drama-card__views"><img src="/play-icon.svg" alt="播放">84.5w</span>
          <h2 class="hg-drama-card__title"><a>山城 &amp; 来信 {id}</a></h2>
          <div class="hg-drama-card__tags"><a class="hg-tag">友情</a><a class="hg-tag">都市</a></div>
        </div>"#
        )
    }

    fn fixture(panel: &str, page: u32, total: u64, cards: &str) -> String {
        let mut html =
            format!(r#"<section data-channel-page data-active-tab="{panel}" data-page="{page}">"#);
        for mode in ["latest", "hot", "random"] {
            let hidden = if mode == panel { "" } else { "hidden" };
            let body = if mode == panel {
                cards.to_string()
            } else {
                card(999)
            };
            let count = if mode == panel { total } else { 1 };
            let pages = count.div_ceil(PAGE_SIZE).max(1);
            html.push_str(&format!(r#"
              <div class="hg-card-grid" data-channel-panel="{mode}" data-panel-total="{count}" {hidden}>{body}</div>
              <template><span>neutral template</span></template>
              <div class="hg-channel-pager" data-channel-panel="{mode}" {hidden}>
                <nav class="hg-pager"><span aria-current="page">{page}</span>
                  <div data-hg-pager-jump data-jump-tpl="/ai-duanju/{mode}/{{page}}/"
                    data-first-url="/ai-duanju/{mode}/" data-pages="{pages}"></div>
                </nav>
              </div>"#));
        }
        html.push_str(&format!("<aside>{}</aside></section>", card(888)));
        html
    }

    fn full_page() -> String {
        [41, 7, 99].into_iter().chain(100..136).map(card).collect()
    }

    #[test]
    fn validates_supported_routes() {
        assert_eq!(
            category_path("ai-duanju", 1, "random").unwrap(),
            ("random", "/ai-duanju/random/".to_string())
        );
        assert_eq!(
            category_path("ai-duanju", 2, "hot_window").unwrap(),
            ("hot", "/ai-duanju/hot/2/".to_string())
        );
        assert!(category_path("other", 1, "random").is_err());
        assert!(category_path("ai-duanju", 1, "latest").is_err());
        assert!(category_path("ai-duanju", 0, "random").is_err());
    }

    #[test]
    fn extracts_only_requested_grid_preserving_server_order_and_fields() {
        let html = fixture("random", 1, 80, &full_page());
        let result = parse_page("https://catalog.example/", 1, "random", &html).unwrap();
        let items = result["items"].as_array().unwrap();
        assert_eq!(items.len(), 39);
        assert_eq!(
            items
                .iter()
                .take(3)
                .map(|v| v["id"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![41, 7, 99]
        );
        let first = &items[0];
        assert_eq!(first["title"], "山城 & 来信 41");
        assert_eq!(
            first["cover"],
            "https://catalog.example/cover-41.jpg?a=1&b=2"
        );
        assert_eq!(first["tags"], json!(["友情", "都市"]));
        assert_eq!(first["hot"], 845_000);
        assert_eq!(first["score"], 8.3);
        assert_eq!(first["episode_count"], 3);
        assert_eq!(first["total_episodes"], 0);
        assert_eq!(first["is_finished"], false);
        assert_eq!(
            result["pagination"],
            json!({ "page": 1, "pages": 3, "size": 39, "total": 80 })
        );
    }

    #[test]
    fn hot_panel_uses_its_own_grid_and_pager() {
        let result = parse_page(
            "https://catalog.example",
            2,
            "hot",
            &fixture("hot", 2, 80, &full_page()),
        )
        .unwrap();
        assert_eq!(result["items"].as_array().unwrap().len(), 39);
        assert_eq!(result["pagination"]["page"], 2);
    }

    #[test]
    fn last_page_retains_server_page_size() {
        let cards = format!("{}{}", card(3), card(4));
        let result = parse_page(
            "https://catalog.example",
            3,
            "random",
            &fixture("random", 3, 80, &cards),
        )
        .unwrap();
        assert_eq!(result["items"].as_array().unwrap().len(), 2);
        assert_eq!(
            result["pagination"],
            json!({ "page": 3, "pages": 3, "size": 39, "total": 80 })
        );
    }

    #[test]
    fn finished_episodes_and_fallback_ids_are_parsed() {
        let source = card(12)
            .replace("data-track-item-id=\"12\"", "")
            .replace("更新至3集", "全6集")
            .replace("84.5w", "1.2万");
        let document = Html::parse_fragment(&source);
        let item = parse_card(
            document
                .select(&selector(".hg-drama-card").unwrap())
                .next()
                .unwrap(),
            "https://catalog.example",
            &CardSelectors::new().unwrap(),
        )
        .unwrap();
        assert_eq!(item["id"], 12);
        assert_eq!(item["episode_count"], 6);
        assert_eq!(item["total_episodes"], 6);
        assert_eq!(item["is_finished"], true);
        assert_eq!(item["hot"], 12_000);
        assert_eq!(metric("1,234"), Some(1234.0));
        assert_eq!(metric("2.5亿"), Some(250_000_000.0));
    }

    #[test]
    fn rejects_mismatched_or_incomplete_page_structures() {
        let html = fixture("random", 1, 80, &full_page());
        for broken in [
            "<html>unavailable</html>".to_string(),
            html.replace("data-active-tab=\"random\"", "data-active-tab=\"hot\""),
            html.replace(
                "data-channel-panel=\"random\"",
                "data-channel-panel=\"unknown\"",
            ),
            html.replace("data-panel-total", "data-missing-total"),
            html.replace("data-pages", "data-missing-pages"),
            html.replace("/ai-duanju/random/{page}/", "/other/{page}/"),
            fixture("random", 1, 80, ""),
            fixture("random", 1, 80, &card(1)),
        ] {
            assert!(parse_page("https://catalog.example", 1, "random", &broken).is_err());
        }
        assert!(parse_page("https://catalog.example", 2, "random", &html).is_err());
    }

    #[test]
    #[ignore = "requires HGHUB_CATALOG_SSR pointing to a local first-page random SSR snapshot"]
    fn local_ssr_snapshot() {
        let path = std::env::var("HGHUB_CATALOG_SSR").expect("set HGHUB_CATALOG_SSR");
        let html = std::fs::read_to_string(path).expect("read local SSR snapshot");
        let result = parse_page("https://catalog.example", 1, "random", &html)
            .expect("parse local SSR snapshot");
        println!(
            "cards={} pages={} total={}",
            result["items"].as_array().unwrap().len(),
            result["pagination"]["pages"],
            result["pagination"]["total"]
        );
        assert_eq!(result["items"].as_array().unwrap().len(), 39);
        assert_eq!(result["pagination"]["pages"], 47);
        assert_eq!(result["pagination"]["total"], 1831);
    }
}
