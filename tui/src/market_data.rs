use std::fs;
use std::path::PathBuf;

pub const TRADING_DAYS: f64 = 252.0;

#[derive(Debug, Clone)]
pub struct Row {
    pub date: String,
    pub ticker: String,
    pub provider_symbol: String,
    pub close: f64,
    pub volume: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct MarketOptions {
    pub base: String,
    pub symbol: String,
    pub source: String,
    pub interval: String,
    pub provider_symbol: Option<String>,
}

pub fn market_rows(options: &MarketOptions) -> Vec<Row> {
    let resolved_symbol = if options.source == "stooq" {
        normalize_stooq_symbol(&options.symbol, options.provider_symbol.as_deref())
    } else {
        options
            .provider_symbol
            .clone()
            .unwrap_or_else(|| options.symbol.clone())
            .to_lowercase()
    };
    let mut path = PathBuf::from(&options.base);
    path.push("market");
    path.push(&options.source);
    path.push(format!(
        "{}.jsonl",
        safe_dataset_name(&resolved_symbol, &options.interval)
    ));
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut rows: Vec<Row> = text
        .lines()
        .filter_map(|line| parse_row(line, &options.symbol, &resolved_symbol))
        .collect();
    rows.sort_by(|a, b| a.date.cmp(&b.date));
    rows
}

fn parse_row(line: &str, symbol: &str, resolved_symbol: &str) -> Option<Row> {
    let close = extract_number(line, "\"close\":")?;
    Some(Row {
        date: extract_string(line, "\"date\":").unwrap_or_default(),
        ticker: extract_string(line, "\"ticker\":")
            .unwrap_or_else(|| symbol.to_uppercase())
            .to_uppercase(),
        provider_symbol: extract_string(line, "\"provider_symbol\":")
            .unwrap_or_else(|| resolved_symbol.to_string()),
        close,
        volume: extract_number(line, "\"volume\":"),
    })
    .filter(|row| !row.date.is_empty())
}

fn extract_string(line: &str, key: &str) -> Option<String> {
    let start = line.find(key)? + key.len();
    let rest = line.get(start..)?.trim_start();
    let rest = rest.strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn extract_number(line: &str, key: &str) -> Option<f64> {
    let start = line.find(key)? + key.len();
    let rest = line.get(start..)?.trim_start();
    let end = rest
        .find(|c: char| {
            !c.is_ascii_digit() && c != '.' && c != '-' && c != 'e' && c != 'E' && c != '+'
        })
        .unwrap_or(rest.len());
    rest[..end]
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
}

pub fn returns(closes: &[f64]) -> Vec<f64> {
    closes
        .windows(2)
        .filter_map(|pair| {
            let previous = pair[0];
            if previous == 0.0 {
                None
            } else {
                Some(pair[1] / previous - 1.0)
            }
        })
        .collect()
}

pub fn mean(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        None
    } else {
        Some(values.iter().sum::<f64>() / values.len() as f64)
    }
}

pub fn stddev(values: &[f64]) -> Option<f64> {
    if values.len() < 2 {
        return None;
    }
    let average = mean(values)?;
    Some(
        (values
            .iter()
            .map(|value| (value - average).powi(2))
            .sum::<f64>()
            / (values.len() - 1) as f64)
            .sqrt(),
    )
}

pub fn max_drawdown(values: &[f64]) -> Option<f64> {
    let mut iter = values.iter();
    let mut peak = *iter.next()?;
    let mut worst = 0.0;
    for value in values {
        peak = peak.max(*value);
        if peak != 0.0 {
            worst = f64::min(worst, value / peak - 1.0);
        }
    }
    Some(worst)
}

pub fn moving_average(values: &[f64], end_exclusive: usize, window: usize) -> Option<f64> {
    if end_exclusive < window || end_exclusive > values.len() {
        None
    } else {
        mean(&values[end_exclusive - window..end_exclusive])
    }
}

pub fn trailing_average(values: &[f64], window: usize) -> Option<f64> {
    moving_average(values, values.len(), window)
}

pub fn volume_ratio(rows: &[Row], window: usize) -> Option<f64> {
    let volumes: Vec<f64> = rows.iter().filter_map(|row| row.volume).collect();
    let latest = *volumes.last()?;
    if volumes.len() < window || latest == 0.0 {
        return None;
    }
    let average = mean(&volumes[volumes.len() - window..])?;
    if average == 0.0 {
        None
    } else {
        Some(latest / average)
    }
}

pub fn regime(
    total_return: Option<f64>,
    latest_close: Option<f64>,
    ma20: Option<f64>,
    ma50: Option<f64>,
    volatility: Option<f64>,
) -> String {
    let Some(latest_close) = latest_close else {
        return "no-price-data".to_string();
    };
    if let (Some(ma20), Some(ma50)) = (ma20, ma50) {
        if latest_close > ma20 && ma20 > ma50 {
            return "trend-up".to_string();
        }
        if latest_close < ma20 && ma20 < ma50 {
            return "trend-down".to_string();
        }
    }
    if volatility.is_some_and(|value| value > 0.04) {
        return "high-volatility".to_string();
    }
    if total_return.is_some_and(|value| value.abs() < 0.02) {
        return "range-bound".to_string();
    }
    "watch".to_string()
}

pub fn normalize_stooq_symbol(symbol: &str, provider_symbol: Option<&str>) -> String {
    let raw = provider_symbol.unwrap_or(symbol).trim();
    if raw.starts_with('^') || raw.contains('.') {
        raw.to_lowercase()
    } else {
        format!("{}.us", raw).to_lowercase()
    }
}

pub fn safe_dataset_name(symbol: &str, interval: &str) -> String {
    format!("{}_{}", safe_part(symbol), safe_part(interval))
}

fn safe_part(value: &str) -> String {
    let mut out = String::new();
    let mut previous_was_sep = false;
    for ch in value.to_lowercase().chars() {
        let keep = ch.is_ascii_alphanumeric() || ch == '_' || ch == '-';
        if keep {
            out.push(ch);
            previous_was_sep = false;
        } else if !previous_was_sep {
            out.push('_');
            previous_was_sep = true;
        }
    }
    let trimmed = out.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "symbol".to_string()
    } else {
        trimmed
    }
}

pub fn json_string(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

pub fn num(value: Option<f64>) -> String {
    match value {
        Some(value) if value.is_finite() => value.to_string(),
        _ => "null".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_typescript_dataset_name_rules() {
        assert_eq!(safe_dataset_name("aapl.us", "d"), "aapl_us_d");
        assert_eq!(safe_dataset_name("^IXIC", "1d"), "ixic_1d");
        assert_eq!(normalize_stooq_symbol("AAPL", None), "aapl.us");
    }
}
