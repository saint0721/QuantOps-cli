use crate::market_data::json_string;

use super::calendar::iso_day;
use super::model::Dataset;

pub(crate) fn missing_dataset_issue_json(symbol: Option<&str>) -> String {
    format!(
        "{{\"severity\":\"error\",\"code\":\"missing_dataset\",\"message\":{}}}",
        json_string(&format!(
            "no market dataset found for {}",
            symbol
                .map(|value| value.to_uppercase())
                .unwrap_or_else(|| "any symbol".to_string())
        ))
    )
}

pub(crate) fn issue_json(
    severity: &str,
    code: &str,
    message: &str,
    dataset: &str,
    date: Option<&str>,
) -> String {
    format!(
        "{{\"severity\":{},\"code\":{},\"message\":{},\"dataset\":{}{} }}",
        json_string(severity),
        json_string(code),
        json_string(message),
        json_string(dataset),
        date.map(|value| format!(",\"date\":{}", json_string(value)))
            .unwrap_or_default(),
    )
    .replace(" }", "}")
}

pub(crate) fn dataset_json(dataset: &Dataset, now: &str) -> String {
    let first = dataset.rows.first();
    let latest = dataset.rows.last();
    let provider = latest
        .map(|row| row.provider_symbol.as_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    format!(
        concat!(
            "{{",
            "\"source\":{},",
            "\"name\":{},",
            "\"path\":{},",
            "\"rows\":{},",
            "\"first_date\":{},",
            "\"latest_date\":{},",
            "\"provider_symbol\":{},",
            "\"interval\":{},",
            "\"latest_age_days\":{},",
            "\"next_command\":{}",
            "}}"
        ),
        json_string(&dataset.source),
        json_string(&dataset.name),
        json_string(&dataset.path),
        dataset.rows.len(),
        first
            .map(|row| json_string(&row.date))
            .unwrap_or_else(|| "null".to_string()),
        latest
            .map(|row| json_string(&row.date))
            .unwrap_or_else(|| "null".to_string()),
        if provider.is_empty() {
            "null".to_string()
        } else {
            json_string(provider)
        },
        latest
            .map(|row| json_string(&row.interval))
            .unwrap_or_else(|| "null".to_string()),
        latest
            .and_then(|row| iso_day(&row.date))
            .and_then(|latest_day| iso_day(now).map(|now_day| (now_day - latest_day).max(0)))
            .map(|age| age.to_string())
            .unwrap_or_else(|| "null".to_string()),
        json_string(&format!(
            "data refresh {} --source {}",
            if provider.is_empty() {
                &dataset.name
            } else {
                provider
            }
            .to_uppercase(),
            dataset.source
        )),
    )
}
