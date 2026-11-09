//! অফারের হিসাব (Shopify-র টাইপ ছাড়া, তাই সহজে টেস্ট করা যায়)।
//!
//! নিয়ম: প্রতিটি কার্ট লাইনে আমাদের অফারগুলোর মধ্যে যেটা সবচেয়ে বেশি ছাড় দেয় শুধু সেটাই বসে,
//! তাই একই প্রোডাক্টে Volume আর Bundle দুটো মিলে দ্বিগুণ ছাড় কখনো হয় না।

use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize, Default)]
pub struct Config {
    #[serde(default)]
    pub offers: Vec<Offer>,
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

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Offer {
    /// একই প্রোডাক্ট বেশি কিনলে বেশি ছাড় (যেমন ২টায় ১০%, ৩টায় ১৫%)
    #[serde(rename = "volume", rename_all = "camelCase")]
    Volume {
        id: String,
        /// খালি থাকলে সব প্রোডাক্টে
        #[serde(default)]
        product_ids: Vec<String>,
        tiers: Vec<Tier>,
        #[serde(default)]
        message: Option<String>,
    },
    /// নির্দিষ্ট প্রোডাক্টগুলো একসাথে কিনলে ছাড়
    #[serde(rename = "bundle", rename_all = "camelCase")]
    Bundle {
        id: String,
        items: Vec<BundleItem>,
        value: Value,
        #[serde(default)]
        message: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub struct Line {
    pub id: String,
    pub product_id: String,
    pub quantity: i64,
    /// কার্টের মুদ্রায় এক পিসের দাম
    pub unit_price: f64,
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
        Some(p) if p > 0.0 => format!("{} {}% off", fallback, trim(p)),
        _ => fallback.to_string(),
    }
}

fn trim(v: f64) -> String {
    if v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        format!("{:.1}", v)
    }
}

fn consider(best: &mut HashMap<String, Candidate>, line_id: &str, candidate: Candidate) {
    let better = match best.get(line_id) {
        Some(current) => candidate.saving > current.saving + 1e-9,
        None => candidate.saving > 0.0,
    };
    if better {
        best.insert(line_id.to_string(), candidate);
    }
}

pub fn calculate(config: &Config, lines: &[Line], rate: f64) -> Vec<Discount> {
    let rate = if rate > 0.0 { rate } else { 1.0 };
    let mut qty_by_product: HashMap<&str, i64> = HashMap::new();
    for line in lines {
        *qty_by_product.entry(line.product_id.as_str()).or_insert(0) += line.quantity;
    }

    let mut best: HashMap<String, Candidate> = HashMap::new();

    for offer in &config.offers {
        match offer {
            Offer::Volume {
                product_ids,
                tiers,
                message,
                ..
            } => {
                for line in lines {
                    if !product_ids.is_empty() && !product_ids.contains(&line.product_id) {
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
                    let text = message
                        .clone()
                        .filter(|m| !m.is_empty())
                        .unwrap_or_else(|| default_message(&tier.value, "Volume discount"));
                    consider(
                        &mut best,
                        &line.id,
                        Candidate {
                            quantity: line.quantity,
                            full_line: true,
                            value,
                            message: text,
                            saving: per_unit * line.quantity as f64,
                        },
                    );
                }
            }
            Offer::Bundle {
                items,
                value,
                message,
                ..
            } => {
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
                let text = message
                    .clone()
                    .filter(|m| !m.is_empty())
                    .unwrap_or_else(|| default_message(value, "Bundle"));
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
                        consider(
                            &mut best,
                            &line.id,
                            Candidate {
                                quantity: qty,
                                full_line: qty == line.quantity,
                                value: applied,
                                message: text.clone(),
                                saving: per_unit * qty as f64,
                            },
                        );
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
            quantity: qty,
            unit_price: price,
        }
    }

    fn config(json: &str) -> Config {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn volume_picks_highest_tier_reached() {
        let c = config(
            r#"{"offers":[{"type":"volume","id":"v1","productIds":[],"tiers":[
              {"minQty":2,"value":{"percent":10}},{"minQty":3,"value":{"percent":15}}]}]}"#,
        );
        let lines = vec![line("a", "p1", 2, 10.0), line("b", "p1", 1, 10.0)];
        let out = calculate(&c, &lines, 1.0);
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
        assert!(calculate(&c, &[line("a", "p1", 5, 10.0)], 1.0).is_empty());
        assert!(calculate(&c, &[line("a", "p2", 1, 10.0)], 1.0).is_empty());
        assert_eq!(calculate(&c, &[line("a", "p2", 2, 10.0)], 1.0).len(), 1);
    }

    #[test]
    fn bundle_discounts_only_complete_sets() {
        let c = config(
            r#"{"offers":[{"type":"bundle","id":"b1","message":"Bundle deal","value":{"percent":20},
              "items":[{"productId":"p1","qty":1},{"productId":"p2","qty":2}]}]}"#,
        );
        // p1 x3, p2 x4 → ২টা পূর্ণ সেট: p1-এর ২টা, p2-এর ৪টা
        let lines = vec![line("a", "p1", 3, 10.0), line("b", "p2", 4, 5.0)];
        let out = calculate(&c, &lines, 1.0);
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
        assert!(calculate(&c, &[line("a", "p1", 3, 10.0)], 1.0).is_empty());
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
        let out = calculate(&c, &lines, 1.0);
        // a: volume 10% × 2 = 2.0 বনাম bundle 25% × 1 = 2.5 → bundle
        assert_eq!(out[0].value, Applied::Percent(25.0));
        assert_eq!(out[0].quantity, Some(1));
        assert_eq!(out[1].value, Applied::Percent(25.0));
    }

    #[test]
    fn fixed_amount_uses_currency_rate_and_never_exceeds_price() {
        let c = config(
            r#"{"offers":[{"type":"volume","id":"v1","tiers":[{"minQty":1,"value":{"amountEach":5}}]}]}"#,
        );
        let out = calculate(&c, &[line("a", "p1", 1, 100.0)], 1.5);
        assert_eq!(out[0].value, Applied::AmountEach(7.5));
        let out = calculate(&c, &[line("a", "p1", 1, 3.0)], 1.0);
        assert_eq!(out[0].value, Applied::AmountEach(3.0));
    }

    #[test]
    fn empty_or_invalid_config_gives_nothing() {
        assert!(calculate(&Config::default(), &[line("a", "p1", 1, 10.0)], 1.0).is_empty());
        let c = config(
            r#"{"offers":[{"type":"volume","id":"v1","tiers":[{"minQty":1,"value":{"percent":0}}]}]}"#,
        );
        assert!(calculate(&c, &[line("a", "p1", 1, 10.0)], 1.0).is_empty());
    }
}
