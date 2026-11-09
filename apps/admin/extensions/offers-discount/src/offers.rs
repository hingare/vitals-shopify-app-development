//! অফারের হিসাব (Shopify-র টাইপ ছাড়া, তাই সহজে টেস্ট করা যায়)।
//!
//! নিয়ম:
//! - প্রতিটি অফারের শর্ত (তারিখ, ন্যূনতম কার্ট, কোন ক্রেতা, দেশ, A/B গ্রুপ) আগে মেলানো হয়।
//! - প্রতিটি কার্ট লাইনে শুধু একটা অফার বসে, তাই কখনো দুটো অফার মিলে দ্বিগুণ ছাড় হয় না।
//! - কোনটা বসবে: "best" মোডে যেটা ক্রেতাকে বেশি ছাড় দেয়, "priority" মোডে যার অগ্রাধিকার বেশি
//!   (সমান হলে বেশি ছাড়েরটা)।

use serde::Deserialize;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Deserialize, Default, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Conflict {
    #[default]
    Best,
    Priority,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default)]
    pub offers: Vec<Offer>,
    #[serde(default)]
    pub conflict: Conflict,
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Value {
    /// শতাংশ ছাড় (০-১০০)
    #[serde(default)]
    pub percent: Option<f64>,
    /// প্রতিটি আইটেমে নির্দিষ্ট টাকা ছাড় (স্টোরের মূল মুদ্রায়)
    #[serde(default)]
    pub amount_each: Option<f64>,
}

const FREE: Value = Value {
    percent: Some(100.0),
    amount_each: None,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tier {
    pub min_qty: i64,
    pub value: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleItem {
    pub product_id: String,
    pub qty: i64,
}

#[derive(Debug, Deserialize, Default, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Audience {
    #[default]
    All,
    /// প্রথমবার কিনছেন (অতিথি বা আগে কোনো অর্ডার নেই)
    New,
    /// আগে অন্তত একটা অর্ডার আছে
    Returning,
    /// লগইন করা ক্রেতা
    LoggedIn,
}

/// অফার কখন ও কাকে দেখাবে
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Rules {
    /// YYYY-MM-DD, স্টোরের সময় অনুযায়ী (এই দিন থেকে)
    #[serde(default)]
    pub starts_on: Option<String>,
    /// YYYY-MM-DD (এই দিন পর্যন্ত, দিনটিসহ)
    #[serde(default)]
    pub ends_on: Option<String>,
    /// স্টোরের মূল মুদ্রায় ন্যূনতম কার্ট (ফ্রি গিফটের দাম বাদে)
    #[serde(default)]
    pub min_subtotal: Option<f64>,
    #[serde(default)]
    pub audience: Audience,
    /// ক্রেতার এর যেকোনো একটা ট্যাগ থাকলে (খালি = সবাই)
    #[serde(default)]
    pub customer_tags: Vec<String>,
    /// দেশের ISO কোড (খালি = সব দেশ)
    #[serde(default)]
    pub countries: Vec<String>,
    /// A/B টেস্ট: শুধু এই গ্রুপের ক্রেতাদের ("A" বা "B")
    #[serde(default)]
    pub ab_group: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Kind {
    /// একই প্রোডাক্ট বেশি কিনলে বেশি ছাড় (যেমন ২টায় ১০%, ৩টায় ১৫%)
    #[serde(rename = "volume", rename_all = "camelCase")]
    Volume {
        /// খালি থাকলে সব প্রোডাক্টে
        #[serde(default)]
        product_ids: Vec<String>,
        tiers: Vec<Tier>,
    },
    /// নির্দিষ্ট প্রোডাক্টগুলো একসাথে কিনলে ছাড়
    #[serde(rename = "bundle", rename_all = "camelCase")]
    Bundle {
        items: Vec<BundleItem>,
        value: Value,
    },
    /// শর্ত পূরণ হলে একটা ভেরিয়েন্ট ফ্রি (গিফট কার্টে থাকতে হয়; স্টোরফ্রন্ট নিজে যোগ করে)
    #[serde(rename = "gift", rename_all = "camelCase")]
    Gift {
        /// এগুলোর যেকোনোটা কিনলে (খালি = যেকোনো প্রোডাক্ট)
        #[serde(default)]
        trigger_product_ids: Vec<String>,
        #[serde(default = "one")]
        min_qty: i64,
        gift_variant_id: String,
        #[serde(default = "one")]
        gift_qty: i64,
    },
    /// X কিনলে Y ফ্রি বা ছাড়ে (Buy one get one)
    #[serde(rename = "bogo", rename_all = "camelCase")]
    Bogo {
        /// খালি = যেকোনো প্রোডাক্ট
        #[serde(default)]
        buy_product_ids: Vec<String>,
        buy_qty: i64,
        /// খালি = buy-এর তালিকাই
        #[serde(default)]
        get_product_ids: Vec<String>,
        get_qty: i64,
        #[serde(default = "free")]
        value: Value,
        /// এক অর্ডারে সর্বোচ্চ কতবার (০ = সীমা নেই)
        #[serde(default = "one")]
        max_uses: i64,
    },
}

fn one() -> i64 {
    1
}
fn free() -> Value {
    FREE
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub id: String,
    #[serde(default)]
    pub priority: i64,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub rules: Rules,
    #[serde(flatten)]
    pub kind: Kind,
}

#[derive(Debug, Clone)]
pub struct Line {
    pub id: String,
    pub product_id: String,
    pub variant_id: String,
    pub quantity: i64,
    /// কার্টের মুদ্রায় এক পিসের দাম
    pub unit_price: f64,
}

/// ক্রেতা ও সময়ের তথ্য (Shopify-র input থেকে)
#[derive(Debug, Clone, Default)]
pub struct Context {
    /// স্টোরের আজকের তারিখ YYYY-MM-DD
    pub today: String,
    /// স্টোরের মূল মুদ্রা থেকে কার্টের মুদ্রার হার
    pub rate: f64,
    pub logged_in: bool,
    /// লগইন না থাকলে None
    pub orders_count: Option<i64>,
    pub tags: HashSet<String>,
    pub country: String,
    pub ab_group: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Applied {
    Percent(f64),
    /// কার্টের মুদ্রায়, প্রতিটি আইটেমে
    AmountEach(f64),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Discount {
    pub line_id: String,
    /// None মানে পুরো লাইন
    pub quantity: Option<i64>,
    pub value: Applied,
    pub message: String,
}

struct Candidate {
    quantity: i64,
    full_line: bool,
    value: Applied,
    message: String,
    saving: f64,
    priority: i64,
}

/// ছাড় শতাংশ বা টাকায়; টাকা হলে কার্টের মুদ্রায় বদলে নেয় আর দামের বেশি হতে দেয় না
fn resolve(value: &Value, unit_price: f64, rate: f64) -> Option<(Applied, f64)> {
    if let Some(p) = value.percent {
        if p > 0.0 {
            let p = p.min(100.0);
            return Some((Applied::Percent(p), unit_price * p / 100.0));
        }
    }
    if let Some(a) = value.amount_each {
        if a > 0.0 {
            let amount = (a * rate).min(unit_price);
            let amount = (amount * 100.0).round() / 100.0;
            if amount > 0.0 {
                return Some((Applied::AmountEach(amount), amount));
            }
        }
    }
    None
}

fn default_message(value: &Value, fallback: &str) -> String {
    match value.percent {
        Some(p) if p >= 100.0 => format!("{} (free)", fallback),
        Some(p) if p > 0.0 => format!("{} {}% off", fallback, trim(p)),
        _ => fallback.to_string(),
    }
}

/// f64-এর Display ব্যবহার করলে wasm বড় হয় (Shopify-র ২৫৬KB সীমা), তাই পূর্ণসংখ্যা দিয়ে লেখা
fn trim(v: f64) -> String {
    let tenths = (v * 10.0).round() as i64;
    if tenths % 10 == 0 {
        format!("{}", tenths / 10)
    } else {
        format!("{}.{}", tenths / 10, tenths % 10)
    }
}

fn wins(candidate: &Candidate, current: &Candidate, mode: Conflict) -> bool {
    if mode == Conflict::Priority && candidate.priority != current.priority {
        return candidate.priority > current.priority;
    }
    candidate.saving > current.saving + 1e-9
}

fn consider(
    best: &mut HashMap<String, Candidate>,
    line_id: &str,
    candidate: Candidate,
    mode: Conflict,
) {
    if candidate.saving <= 0.0 {
        return;
    }
    let better = match best.get(line_id) {
        Some(current) => wins(&candidate, current, mode),
        None => true,
    };
    if better {
        best.insert(line_id.to_string(), candidate);
    }
}

fn matches(list: &[String], id: &str) -> bool {
    list.is_empty() || list.iter().any(|x| x == id)
}

/// অফারের শর্ত এই কার্ট ও ক্রেতার জন্য পূরণ হয় কিনা
fn eligible(rules: &Rules, ctx: &Context, subtotal: f64) -> bool {
    // YYYY-MM-DD স্ট্রিং তুলনা তারিখের ক্রমেই হয়
    let today = ctx.today.as_str();
    if !today.is_empty() {
        if let Some(start) = rules.starts_on.as_deref().filter(|s| !s.is_empty()) {
            if today < start {
                return false;
            }
        }
        if let Some(end) = rules.ends_on.as_deref().filter(|s| !s.is_empty()) {
            if today > end {
                return false;
            }
        }
    }
    if let Some(min) = rules.min_subtotal {
        if min > 0.0 && subtotal + 1e-9 < min * ctx.rate {
            return false;
        }
    }
    let ok_audience = match rules.audience {
        Audience::All => true,
        Audience::New => ctx.orders_count.unwrap_or(0) == 0,
        Audience::Returning => ctx.orders_count.unwrap_or(0) > 0,
        Audience::LoggedIn => ctx.logged_in,
    };
    if !ok_audience {
        return false;
    }
    if !rules.customer_tags.is_empty() && !rules.customer_tags.iter().any(|t| ctx.tags.contains(t))
    {
        return false;
    }
    if !rules.countries.is_empty()
        && !rules
            .countries
            .iter()
            .any(|c| c.eq_ignore_ascii_case(&ctx.country))
    {
        return false;
    }
    if let Some(group) = rules.ab_group.as_deref().filter(|g| !g.is_empty()) {
        if ctx.ab_group.as_deref() != Some(group) {
            return false;
        }
    }
    true
}

fn text(message: &Option<String>, value: &Value, fallback: &str) -> String {
    message
        .clone()
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| default_message(value, fallback))
}

pub fn calculate(config: &Config, lines: &[Line], ctx: &Context) -> Vec<Discount> {
    let rate = if ctx.rate > 0.0 { ctx.rate } else { 1.0 };
    let ctx = Context {
        rate,
        ..ctx.clone()
    };
    let mode = config.conflict;
    let mut qty_by_product: HashMap<&str, i64> = HashMap::new();
    for line in lines {
        *qty_by_product.entry(line.product_id.as_str()).or_insert(0) += line.quantity;
    }
    let subtotal: f64 = lines.iter().map(|l| l.unit_price * l.quantity as f64).sum();

    let mut best: HashMap<String, Candidate> = HashMap::new();

    for offer in &config.offers {
        // ফ্রি গিফটের নিজের দাম ন্যূনতম কার্টে গোনা হয় না
        let offer_subtotal = match &offer.kind {
            Kind::Gift {
                gift_variant_id, ..
            } => {
                subtotal
                    - lines
                        .iter()
                        .filter(|l| &l.variant_id == gift_variant_id)
                        .map(|l| l.unit_price * l.quantity as f64)
                        .sum::<f64>()
            }
            _ => subtotal,
        };
        if !eligible(&offer.rules, &ctx, offer_subtotal) {
            continue;
        }
        let priority = offer.priority;
        let mut push = |line: &Line, qty: i64, value: Applied, per_unit: f64, message: String| {
            consider(
                &mut best,
                &line.id,
                Candidate {
                    quantity: qty,
                    full_line: qty == line.quantity,
                    value,
                    message,
                    saving: per_unit * qty as f64,
                    priority,
                },
                mode,
            );
        };

        match &offer.kind {
            Kind::Volume { product_ids, tiers } => {
                for line in lines {
                    if !matches(product_ids, &line.product_id) {
                        continue;
                    }
                    let total = qty_by_product
                        .get(line.product_id.as_str())
                        .copied()
                        .unwrap_or(0);
                    let tier = tiers
                        .iter()
                        .filter(|t| t.min_qty >= 1 && t.min_qty <= total)
                        .max_by_key(|t| t.min_qty);
                    let Some(tier) = tier else { continue };
                    let Some((value, per_unit)) = resolve(&tier.value, line.unit_price, rate)
                    else {
                        continue;
                    };
                    let message = text(&offer.message, &tier.value, "Volume discount");
                    push(line, line.quantity, value, per_unit, message);
                }
            }
            Kind::Bundle { items, value } => {
                if items.is_empty() || items.iter().any(|i| i.qty < 1) {
                    continue;
                }
                // কতগুলো পূর্ণ বান্ডেল কার্টে আছে
                let sets = items
                    .iter()
                    .map(|i| {
                        qty_by_product
                            .get(i.product_id.as_str())
                            .copied()
                            .unwrap_or(0)
                            / i.qty
                    })
                    .min()
                    .unwrap_or(0);
                if sets < 1 {
                    continue;
                }
                let message = text(&offer.message, value, "Bundle");
                for item in items {
                    let mut remaining = sets * item.qty;
                    for line in lines.iter().filter(|l| l.product_id == item.product_id) {
                        if remaining <= 0 {
                            break;
                        }
                        let qty = remaining.min(line.quantity);
                        remaining -= qty;
                        let Some((applied, per_unit)) = resolve(value, line.unit_price, rate)
                        else {
                            continue;
                        };
                        push(line, qty, applied, per_unit, message.clone());
                    }
                }
            }
            Kind::Gift {
                trigger_product_ids,
                min_qty,
                gift_variant_id,
                gift_qty,
            } => {
                let bought: i64 = lines
                    .iter()
                    .filter(|l| &l.variant_id != gift_variant_id)
                    .filter(|l| matches(trigger_product_ids, &l.product_id))
                    .map(|l| l.quantity)
                    .sum();
                if bought < (*min_qty).max(1) {
                    continue;
                }
                let message = text(&offer.message, &FREE, "Free gift");
                let mut remaining = (*gift_qty).max(1);
                for line in lines.iter().filter(|l| &l.variant_id == gift_variant_id) {
                    if remaining <= 0 {
                        break;
                    }
                    let qty = remaining.min(line.quantity);
                    remaining -= qty;
                    if let Some((applied, per_unit)) = resolve(&FREE, line.unit_price, rate) {
                        push(line, qty, applied, per_unit, message.clone());
                    }
                }
            }
            Kind::Bogo {
                buy_product_ids,
                buy_qty,
                get_product_ids,
                get_qty,
                value,
                max_uses,
            } => {
                if *buy_qty < 1 || *get_qty < 1 {
                    continue;
                }
                let get_list = if get_product_ids.is_empty() {
                    buy_product_ids
                } else {
                    get_product_ids
                };
                // প্রতিটি পিস আলাদা ইউনিট: (লাইনের index, দাম)
                let mut units: Vec<(usize, f64)> = Vec::new();
                for (i, line) in lines.iter().enumerate() {
                    for _ in 0..line.quantity.clamp(0, 500) {
                        units.push((i, line.unit_price));
                    }
                }
                let n = units.len();
                let mut used = vec![false; n];
                // দামি পিস "কেনা" হিসেবে, সস্তা পিসে ছাড় (দোকানের জন্য ন্যায্য, প্রচলিত নিয়ম)
                let mut by_price_desc: Vec<usize> = (0..n).collect();
                by_price_desc.sort_by(|a, b| units[*b].1.total_cmp(&units[*a].1));
                let mut by_price_asc = by_price_desc.clone();
                by_price_asc.reverse();
                let is_buy = |u: usize| matches(buy_product_ids, &lines[units[u].0].product_id);
                let is_get = |u: usize| matches(get_list, &lines[units[u].0].product_id);

                let mut discounted: HashMap<usize, i64> = HashMap::new();
                let mut uses = 0;
                loop {
                    if *max_uses > 0 && uses >= *max_uses {
                        break;
                    }
                    // আগে ছাড়ের পিস বাছাই (সবচেয়ে সস্তা), তারপর বাকি থেকে কেনার পিস
                    let gets: Vec<usize> = by_price_asc
                        .iter()
                        .copied()
                        .filter(|u| !used[*u] && is_get(*u))
                        .take(*get_qty as usize)
                        .collect();
                    if gets.len() < *get_qty as usize {
                        break;
                    }
                    let buys: Vec<usize> = by_price_desc
                        .iter()
                        .copied()
                        .filter(|u| !used[*u] && !gets.contains(u) && is_buy(*u))
                        .take(*buy_qty as usize)
                        .collect();
                    if buys.len() < *buy_qty as usize {
                        break;
                    }
                    for u in buys.iter().chain(gets.iter()) {
                        used[*u] = true;
                    }
                    for u in gets {
                        *discounted.entry(units[u].0).or_insert(0) += 1;
                    }
                    uses += 1;
                }
                let message = text(&offer.message, value, "Buy more, save");
                let mut entries: Vec<(usize, i64)> = discounted.into_iter().collect();
                entries.sort();
                for (i, qty) in entries {
                    let line = &lines[i];
                    if let Some((applied, per_unit)) = resolve(value, line.unit_price, rate) {
                        push(line, qty, applied, per_unit, message.clone());
                    }
                }
            }
        }
    }

    let mut out: Vec<Discount> = lines
        .iter()
        .filter_map(|line| {
            best.remove(&line.id).map(|c| Discount {
                line_id: line.id.clone(),
                quantity: if c.full_line { None } else { Some(c.quantity) },
                value: c.value,
                message: c.message,
            })
        })
        .collect();
    out.sort_by(|a, b| a.line_id.cmp(&b.line_id));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(id: &str, product: &str, qty: i64, price: f64) -> Line {
        Line {
            id: id.into(),
            product_id: product.into(),
            variant_id: format!("v-{}", product),
            quantity: qty,
            unit_price: price,
        }
    }

    fn config(json: &str) -> Config {
        serde_json::from_str(json).unwrap()
    }

    fn ctx() -> Context {
        Context {
            today: "2026-11-09".into(),
            rate: 1.0,
            country: "BD".into(),
            ..Context::default()
        }
    }

    fn calc(c: &Config, lines: &[Line]) -> Vec<Discount> {
        calculate(c, lines, &ctx())
    }

    #[test]
    fn volume_picks_highest_tier_reached() {
        let c = config(
            r#"{"offers":[{"type":"volume","id":"v1","productIds":[],"tiers":[
              {"minQty":2,"value":{"percent":10}},{"minQty":3,"value":{"percent":15}}]}]}"#,
        );
        let lines = vec![line("a", "p1", 2, 10.0), line("b", "p1", 1, 10.0)];
        let out = calc(&c, &lines);
        assert_eq!(out.len(), 2);
        assert!(out.iter().all(|d| d.value == Applied::Percent(15.0)));
        assert!(out.iter().all(|d| d.quantity.is_none()));
        assert_eq!(out[0].message, "Volume discount 15% off");
    }

    #[test]
    fn volume_needs_the_minimum_and_respects_product_list() {
        let c = config(
            r#"{"offers":[{"type":"volume","id":"v1","productIds":["p2"],"tiers":[
              {"minQty":2,"value":{"percent":10}}]}]}"#,
        );
        assert!(calc(&c, &[line("a", "p1", 5, 10.0)]).is_empty());
        assert!(calc(&c, &[line("a", "p2", 1, 10.0)]).is_empty());
        assert_eq!(calc(&c, &[line("a", "p2", 2, 10.0)]).len(), 1);
    }

    #[test]
    fn bundle_discounts_only_complete_sets() {
        let c = config(
            r#"{"offers":[{"type":"bundle","id":"b1","message":"Bundle deal","value":{"percent":20},
              "items":[{"productId":"p1","qty":1},{"productId":"p2","qty":2}]}]}"#,
        );
        // p1 x3, p2 x4 → ২টা পূর্ণ সেট: p1-এর ২টা, p2-এর ৪টা
        let lines = vec![line("a", "p1", 3, 10.0), line("b", "p2", 4, 5.0)];
        let out = calc(&c, &lines);
        assert_eq!(
            out,
            vec![
                Discount {
                    line_id: "a".into(),
                    quantity: Some(2),
                    value: Applied::Percent(20.0),
                    message: "Bundle deal".into()
                },
                Discount {
                    line_id: "b".into(),
                    quantity: None,
                    value: Applied::Percent(20.0),
                    message: "Bundle deal".into()
                },
            ]
        );
        assert!(calc(&c, &[line("a", "p1", 3, 10.0)]).is_empty());
    }

    #[test]
    fn best_offer_wins_per_line_without_stacking() {
        let c = config(
            r#"{"offers":[
              {"type":"volume","id":"v1","tiers":[{"minQty":2,"value":{"percent":10}}]},
              {"type":"bundle","id":"b1","value":{"percent":25},"items":[{"productId":"p1","qty":1},{"productId":"p2","qty":1}]}
            ]}"#,
        );
        let lines = vec![line("a", "p1", 2, 10.0), line("b", "p2", 1, 10.0)];
        let out = calc(&c, &lines);
        // a: volume 10% × 2 = 2.0 বনাম bundle 25% × 1 = 2.5 → bundle
        assert_eq!(out[0].value, Applied::Percent(25.0));
        assert_eq!(out[0].quantity, Some(1));
        assert_eq!(out[1].value, Applied::Percent(25.0));
    }

    #[test]
    fn priority_mode_lets_the_merchant_choose() {
        let c = config(
            r#"{"conflict":"priority","offers":[
              {"type":"volume","id":"v1","priority":5,"tiers":[{"minQty":2,"value":{"percent":10}}]},
              {"type":"bundle","id":"b1","priority":1,"value":{"percent":25},"items":[{"productId":"p1","qty":1},{"productId":"p2","qty":1}]}
            ]}"#,
        );
        let lines = vec![line("a", "p1", 2, 10.0), line("b", "p2", 1, 10.0)];
        let out = calc(&c, &lines);
        // a-তে volume (অগ্রাধিকার বেশি), b-তে শুধু bundle মেলে
        assert_eq!(out[0].value, Applied::Percent(10.0));
        assert_eq!(out[0].quantity, None);
        assert_eq!(out[1].value, Applied::Percent(25.0));
    }

    #[test]
    fn fixed_amount_uses_currency_rate_and_never_exceeds_price() {
        let c = config(
            r#"{"offers":[{"type":"volume","id":"v1","tiers":[{"minQty":1,"value":{"amountEach":5}}]}]}"#,
        );
        let out = calculate(
            &c,
            &[line("a", "p1", 1, 100.0)],
            &Context { rate: 1.5, ..ctx() },
        );
        assert_eq!(out[0].value, Applied::AmountEach(7.5));
        let out = calc(&c, &[line("a", "p1", 1, 3.0)]);
        assert_eq!(out[0].value, Applied::AmountEach(3.0));
    }

    #[test]
    fn default_messages_show_the_discount() {
        assert_eq!(trim(12.5), "12.5");
        assert_eq!(trim(20.0), "20");
        assert_eq!(default_message(&FREE, "Free gift"), "Free gift (free)");
    }

    #[test]
    fn empty_or_invalid_config_gives_nothing() {
        assert!(calc(&Config::default(), &[line("a", "p1", 1, 10.0)]).is_empty());
        let c = config(
            r#"{"offers":[{"type":"volume","id":"v1","tiers":[{"minQty":1,"value":{"percent":0}}]}]}"#,
        );
        assert!(calc(&c, &[line("a", "p1", 1, 10.0)]).is_empty());
    }

    #[test]
    fn rules_check_dates_subtotal_audience_tags_country_and_ab_group() {
        let offer = |rules: &str| {
            config(&format!(
                r#"{{"offers":[{{"type":"volume","id":"v1","rules":{rules},
                  "tiers":[{{"minQty":1,"value":{{"percent":10}}}}]}}]}}"#
            ))
        };
        let lines = [line("a", "p1", 2, 10.0)];
        let applies = |rules: &str, c: Context| !calculate(&offer(rules), &lines, &c).is_empty();

        assert!(applies(
            r#"{"startsOn":"2026-11-09","endsOn":"2026-11-09"}"#,
            ctx()
        ));
        assert!(!applies(r#"{"startsOn":"2026-11-10"}"#, ctx()));
        assert!(!applies(r#"{"endsOn":"2026-11-08"}"#, ctx()));

        assert!(applies(r#"{"minSubtotal":20}"#, ctx()));
        assert!(!applies(r#"{"minSubtotal":20.01}"#, ctx()));
        // মূল মুদ্রায় ১৫, কার্টের মুদ্রায় ৩০ লাগবে
        assert!(!applies(
            r#"{"minSubtotal":15}"#,
            Context { rate: 2.0, ..ctx() }
        ));

        let returning = Context {
            logged_in: true,
            orders_count: Some(3),
            tags: HashSet::from(["VIP".to_string()]),
            ..ctx()
        };
        assert!(applies(r#"{"audience":"new"}"#, ctx()));
        assert!(!applies(r#"{"audience":"new"}"#, returning.clone()));
        assert!(applies(r#"{"audience":"returning"}"#, returning.clone()));
        assert!(!applies(r#"{"audience":"loggedIn"}"#, ctx()));
        assert!(applies(
            r#"{"customerTags":["VIP","Gold"]}"#,
            returning.clone()
        ));
        assert!(!applies(r#"{"customerTags":["VIP"]}"#, ctx()));

        assert!(applies(r#"{"countries":["bd","IN"]}"#, ctx()));
        assert!(!applies(r#"{"countries":["US"]}"#, ctx()));

        let group_b = Context {
            ab_group: Some("B".into()),
            ..ctx()
        };
        assert!(applies(r#"{"abGroup":"B"}"#, group_b));
        assert!(!applies(r#"{"abGroup":"A"}"#, ctx()));
        assert!(applies(r#"{"abGroup":""}"#, ctx()));
    }

    #[test]
    fn free_gift_needs_trigger_and_ignores_its_own_price() {
        let c = config(
            r#"{"offers":[{"type":"gift","id":"g1","giftVariantId":"v-gift","rules":{"minSubtotal":50}}]}"#,
        );
        let gift = line("g", "gift", 2, 30.0);
        // কার্ট ৪০ + গিফট ৬০: গিফট বাদে ৫০-এর নিচে, তাই কিছু না
        assert!(calc(&c, &[line("a", "p1", 4, 10.0), gift.clone()]).is_empty());
        let out = calc(&c, &[line("a", "p1", 5, 10.0), gift.clone()]);
        assert_eq!(
            out,
            vec![Discount {
                line_id: "g".into(),
                quantity: Some(1),
                value: Applied::Percent(100.0),
                message: "Free gift (free)".into()
            }]
        );
        // শুধু গিফট কার্টে থাকলে ফ্রি নয়
        let any = config(r#"{"offers":[{"type":"gift","id":"g1","giftVariantId":"v-gift"}]}"#);
        assert!(calc(&any, std::slice::from_ref(&gift)).is_empty());
        let only = config(
            r#"{"offers":[{"type":"gift","id":"g1","giftVariantId":"v-gift","triggerProductIds":["p2"],"minQty":2}]}"#,
        );
        assert!(calc(&only, &[line("a", "p1", 5, 10.0), gift.clone()]).is_empty());
        assert_eq!(calc(&only, &[line("a", "p2", 2, 10.0), gift]).len(), 1);
    }

    #[test]
    fn bogo_discounts_the_cheapest_items_and_respects_max_uses() {
        // ২টা কিনলে ১টা ফ্রি, যেকোনো প্রোডাক্ট
        let c =
            config(r#"{"offers":[{"type":"bogo","id":"b1","buyQty":2,"getQty":1,"maxUses":0}]}"#);
        let lines = vec![line("a", "p1", 3, 30.0), line("b", "p2", 3, 10.0)];
        let out = calc(&c, &lines);
        // ৬ পিস → ২ বার: সবচেয়ে সস্তা ২টা (p2) ফ্রি
        assert_eq!(
            out,
            vec![Discount {
                line_id: "b".into(),
                quantity: Some(2),
                value: Applied::Percent(100.0),
                message: "Buy more, save (free)".into()
            }]
        );
        let once = config(r#"{"offers":[{"type":"bogo","id":"b1","buyQty":2,"getQty":1}]}"#);
        assert_eq!(calc(&once, &lines)[0].quantity, Some(1));
        // ২টা পিস হলে ২+১ পূরণ হয় না
        assert!(calc(&once, &[line("a", "p1", 2, 10.0)]).is_empty());
    }

    #[test]
    fn bogo_with_separate_get_list_and_partial_discount() {
        let c = config(
            r#"{"offers":[{"type":"bogo","id":"b1","buyProductIds":["shirt"],"buyQty":1,
              "getProductIds":["sock"],"getQty":1,"value":{"percent":50}}]}"#,
        );
        assert!(calc(&c, &[line("s", "sock", 2, 4.0)]).is_empty());
        let out = calc(
            &c,
            &[line("t", "shirt", 1, 20.0), line("s", "sock", 2, 4.0)],
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].line_id, "s");
        assert_eq!(out[0].quantity, Some(1));
        assert_eq!(out[0].value, Applied::Percent(50.0));
    }

    #[test]
    fn all_offer_types_together_never_double_discount_a_line() {
        let c = config(
            r#"{"offers":[
              {"type":"volume","id":"v","tiers":[{"minQty":2,"value":{"percent":10}}]},
              {"type":"bundle","id":"b","value":{"percent":15},"items":[{"productId":"p1","qty":1},{"productId":"p2","qty":1}]},
              {"type":"bogo","id":"x","buyQty":1,"getQty":1,"value":{"percent":50},"maxUses":0},
              {"type":"gift","id":"g","giftVariantId":"v-gift"}
            ]}"#,
        );
        let lines = vec![
            line("a", "p1", 2, 10.0),
            line("b", "p2", 2, 10.0),
            line("g", "gift", 1, 5.0),
        ];
        let out = calc(&c, &lines);
        let ids: Vec<&str> = out.iter().map(|d| d.line_id.as_str()).collect();
        let unique: HashSet<&str> = ids.iter().copied().collect();
        assert_eq!(ids.len(), unique.len());
        // প্রতিটি লাইনের ছাড় লাইনের দামের বেশি নয়
        for d in &out {
            let l = lines.iter().find(|l| l.id == d.line_id).unwrap();
            let qty = d.quantity.unwrap_or(l.quantity);
            assert!(qty <= l.quantity);
            if let Applied::Percent(p) = d.value {
                assert!(p <= 100.0);
            }
        }
        // গিফট সবসময় ফ্রি
        assert!(out
            .iter()
            .any(|d| d.line_id == "g" && d.value == Applied::Percent(100.0)));
    }
}
