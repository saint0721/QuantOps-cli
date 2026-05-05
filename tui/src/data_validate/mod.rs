mod args;
mod calendar;
mod model;
mod output;
mod parser;
mod scan;
mod validate;

use std::env;

use crate::market_data::json_string;
use args::parse_args;
use model::Dataset;
use output::{dataset_json, missing_dataset_issue_json};
use scan::{dataset_matches_symbol, list_datasets};
use validate::validate_dataset;

pub fn run() -> Result<String, String> {
    let args = parse_args(env::args().skip(1).collect())?;
    Ok(validate_json(&args))
}

fn validate_json(args: &model::Args) -> String {
    let datasets: Vec<Dataset> = list_datasets(&args.base)
        .into_iter()
        .filter(|dataset| dataset_matches_symbol(dataset, args.symbol.as_deref()))
        .collect();
    let mut issues = Vec::new();
    for dataset in &datasets {
        issues.extend(validate_dataset(dataset, &args.now, args.max_stale_days));
    }
    if datasets.is_empty() {
        issues.push(missing_dataset_issue_json(args.symbol.as_deref()));
    }
    let ok = !issues
        .iter()
        .any(|issue| issue.contains("\"severity\":\"error\""));
    format!(
        concat!(
            "{{",
            "\"ok\":{},",
            "\"symbol\":{},",
            "\"datasets\":[{}],",
            "\"issues\":[{}],",
            "\"next_command\":{},",
            "\"engine\":\"rust\"",
            "}}"
        ),
        ok,
        args.symbol
            .as_ref()
            .map(|symbol| json_string(&symbol.to_uppercase()))
            .unwrap_or_else(|| "null".to_string()),
        datasets
            .iter()
            .map(|dataset| dataset_json(dataset, &args.now))
            .collect::<Vec<_>>()
            .join(","),
        issues.join(","),
        if datasets.is_empty() {
            json_string(&format!(
                "data download {} --period 1y",
                args.symbol
                    .as_ref()
                    .map(|symbol| symbol.to_uppercase())
                    .unwrap_or_else(|| "AAPL".to_string())
            ))
        } else {
            "null".to_string()
        },
    )
}
