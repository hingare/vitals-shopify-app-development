use crate::offers::{calculate, Applied, Config, Line};
use shopify_function::prelude::*;
use shopify_function::Result;

// কার্টের লাইন থেকে অফারের ছাড় বের করে Shopify-কে দেয়।
// কনফিগ না থাকলে বা ভুল হলে কোনো ছাড় দেয় না (চেকআউট কখনো ভাঙে না)।
#[shopify_function_target(
    query_path = "src/cart_lines_discounts_generate_run.graphql",
    schema_path = "schema.graphql"
)]
fn cart_lines_discounts_generate_run(
    input: input::ResponseData,
) -> Result<output::CartLinesDiscountsGenerateRunResult> {
    let empty = output::CartLinesDiscountsGenerateRunResult { operations: vec![] };
    if !input
        .discount
        .discount_classes
        .contains(&input::DiscountClass::PRODUCT)
    {
        return Ok(empty);
    }
    let config: Config = match &input.discount.metafield {
        Some(m) => serde_json::from_value(m.json_value.clone()).unwrap_or_default(),
        None => return Ok(empty),
    };

    let lines: Vec<Line> = input
        .cart
        .lines
        .iter()
        .filter_map(|l| match &l.merchandise {
            input::InputCartLinesMerchandise::ProductVariant(v) => Some(Line {
                id: l.id.clone(),
                product_id: v
                    .product
                    .id
                    .trim_start_matches("gid://shopify/Product/")
                    .to_string(),
                quantity: l.quantity,
                unit_price: l.cost.amount_per_quantity.amount.0,
            }),
            _ => None,
        })
        .collect();

    let discounts = calculate(&config, &lines, input.presentment_currency_rate.0);
    if discounts.is_empty() {
        return Ok(empty);
    }

    let candidates = discounts
        .into_iter()
        .map(|d| output::ProductDiscountCandidate {
            targets: vec![output::ProductDiscountCandidateTarget::CartLine(
                output::CartLineTarget {
                    id: d.line_id,
                    quantity: d.quantity,
                },
            )],
            message: Some(d.message),
            value: match d.value {
                Applied::Percent(p) => {
                    output::ProductDiscountCandidateValue::Percentage(output::Percentage {
                        value: Decimal(p),
                    })
                }
                Applied::AmountEach(a) => output::ProductDiscountCandidateValue::FixedAmount(
                    output::ProductDiscountCandidateFixedAmount {
                        amount: Decimal(a),
                        applies_to_each_item: Some(true),
                    },
                ),
            },
            associated_discount_code: None,
            prerequisites: None,
        })
        .collect();

    Ok(output::CartLinesDiscountsGenerateRunResult {
        operations: vec![output::CartOperation::ProductDiscountsAdd(
            output::ProductDiscountsAddOperation {
                selection_strategy: output::ProductDiscountSelectionStrategy::ALL,
                candidates,
            },
        )],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cart_lines_discounts_generate_run::output;
    use shopify_function::run_function_with_input;

    fn run(config: &str, classes: &str) -> output::CartLinesDiscountsGenerateRunResult {
        let input = format!(
            r#"{{
              "presentmentCurrencyRate": "1.0",
              "cart": {{ "lines": [
                {{ "id": "gid://shopify/CartLine/1", "quantity": 3,
                   "cost": {{ "amountPerQuantity": {{ "amount": "10.0" }} }},
                   "merchandise": {{ "__typename": "ProductVariant", "id": "gid://shopify/ProductVariant/9",
                                     "product": {{ "id": "gid://shopify/Product/1" }} }} }}
              ] }},
              "discount": {{ "discountClasses": {classes}, "metafield": {config} }}
            }}"#
        );
        run_function_with_input(cart_lines_discounts_generate_run, &input).unwrap()
    }

    #[test]
    fn applies_volume_discount_through_shopify_types() {
        let result = run(
            r#"{ "jsonValue": { "offers": [ { "type": "volume", "id": "v1",
                "tiers": [ { "minQty": 3, "value": { "percent": 15 } } ] } ] } }"#,
            r#"["PRODUCT"]"#,
        );
        assert_eq!(result.operations.len(), 1);
        let output::CartOperation::ProductDiscountsAdd(op) = &result.operations[0] else {
            panic!("expected product discount");
        };
        assert_eq!(op.candidates.len(), 1);
        assert_eq!(
            op.candidates[0].value,
            output::ProductDiscountCandidateValue::Percentage(output::Percentage {
                value: Decimal(15.0)
            })
        );
    }

    #[test]
    fn does_nothing_without_config_or_product_class() {
        assert!(run("null", r#"["PRODUCT"]"#).operations.is_empty());
        assert!(
            run(r#"{ "jsonValue": { "offers": [] } }"#, r#"["PRODUCT"]"#)
                .operations
                .is_empty()
        );
        let volume = r#"{ "jsonValue": { "offers": [ { "type": "volume", "id": "v1",
            "tiers": [ { "minQty": 1, "value": { "percent": 10 } } ] } ] } }"#;
        assert!(run(volume, r#"["ORDER"]"#).operations.is_empty());
        assert!(run(r#"{ "jsonValue": "broken" }"#, r#"["PRODUCT"]"#)
            .operations
            .is_empty());
    }
}
