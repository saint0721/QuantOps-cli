use std::env;
use std::fs;
use std::path::PathBuf;

const TRADING_DAYS: f64 = 252.0;

#[derive(Debug, Clone)]
struct Row {
    date: String,
    ticker: String,
    provider_symbol: String,
    close: f64,
    volume: Option<f64>,
}

#[derive(Debug)]
struct Args {
    base: String,
    symbol: String,
    source: String,
    interval: String,
    provider_symbol: Option<String>,
}

fn main() {
    match run() {
        Ok(text) => {
            println!("{text}");
        }
        Err(error) => {
            println!("{{\"ok\":false,\"error\":{}}}", json_string(&error));
            std::process::exit(1);
        }
    }
}

fn run() -> Result<String, String> {
    let args = parse_args(env::args().skip(1).collect())?;
    Ok(stats_json(&args))
}

fn parse_args(raw: Vec<String>) -> Result<Args, String> {
    let mut base = "data".to_string();
    let mut symbol: Option<String> = None;
    let mut source = "stooq".to_string();
    let mut interval = "d".to_string();
    let mut provider_symbol: Option<String> = None;
    let mut i = 0;
    while i < raw.len() {
        match raw[i].as_str() {
            "--base" => {
                i += 1;
                base = raw.get(i).ok_or("--base requires a value")?.to_string();
            }
            "--symbol" => {
                i += 1;
                symbol = Some(raw.get(i).ok_or("--symbol requires a value")?.to_string());
            }
            "--source" => {
                i += 1;
                source = raw.get(i).ok_or("--source requires a value")?.to_string();
            }
            "--interval" => {
                i += 1;
                interval = raw.get(i).ok_or("--interval requires a value")?.to_string();
            }
            "--provider-symbol" => {
                i += 1;
                provider_symbol = Some(raw.get(i).ok_or("--provider-symbol requires a value")?.to_string());
            }
            "--help" | "-h" => return Err("usage: quantops-stats --symbol SYMBOL [--base DIR] [--source stooq|yahoo] [--interval d] [--provider-symbol ID]".to_string()),
            other => return Err(format!("unknown argument: {other}")),
        }
        i += 1;
    }
    let symbol = symbol.ok_or("--symbol is required")?;
    Ok(Args {
        base,
        symbol,
        source,
        interval,
        provider_symbol,
    })
}

fn stats_json(args: &Args) -> String {
    let rows = market_rows(args);
    if rows.is_empty() {
        return format!(
            "{{\"ok\":false,\"ticker\":{},\"source\":{},\"interval\":{},\"rows\":0,\"error\":\"no market dataset found; run data download first\",\"next_command\":{}}}",
            json_string(&args.symbol.to_uppercase()),
            json_string(&args.source),
            json_string(&args.interval),
            json_string(&format!("data download {}", args.symbol.to_uppercase())),
        );
    }

    let closes: Vec<f64> = rows.iter().map(|row| row.close).collect();
    let row_returns = returns(&closes);
    let latest_close = *closes.last().unwrap();
    let first_close = *closes.first().unwrap();
    let total_return = if first_close == 0.0 {
        None
    } else {
        Some(latest_close / first_close - 1.0)
    };
    let average_return = mean(&row_returns);
    let volatility = stddev(&row_returns);
    let ma20 = moving_average(&closes, 20);
    let ma50 = moving_average(&closes, 50);
    let latest = rows.last().unwrap();

    format!(
        concat!(
            "{{",
            "\"ok\":true,",
            "\"ticker\":{},",
            "\"provider_symbol\":{},",
            "\"source\":{},",
            "\"interval\":{},",
            "\"rows\":{},",
            "\"start_date\":{},",
            "\"end_date\":{},",
            "\"latest_close\":{},",
            "\"total_return\":{},",
            "\"average_return\":{},",
            "\"volatility\":{},",
            "\"annualized_volatility\":{},",
            "\"max_drawdown\":{},",
            "\"best_return\":{},",
            "\"worst_return\":{},",
            "\"moving_average_20\":{},",
            "\"moving_average_50\":{},",
            "\"latest_volume\":{},",
            "\"volume_ratio_20\":{},",
            "\"regime\":{},",
            "\"engine\":\"rust\",",
            "\"readiness\":{{\"basic_stats\":{},\"moving_average_20\":{},\"moving_average_50\":{},\"backtest_ready\":{}}}",
            "}}"
        ),
        json_string(&latest.ticker),
        json_string(&latest.provider_symbol),
        json_string(&args.source),
        json_string(&args.interval),
        rows.len(),
        json_string(&rows.first().unwrap().date),
        json_string(&latest.date),
        num(Some(latest_close)),
        num(total_return),
        num(average_return),
        num(volatility),
        num(volatility.map(|value| value * TRADING_DAYS.sqrt())),
        num(max_drawdown(&closes)),
        num(row_returns.iter().cloned().reduce(f64::max)),
        num(row_returns.iter().cloned().reduce(f64::min)),
        num(ma20),
        num(ma50),
        num(latest.volume),
        num(volume_ratio(&rows, 20)),
        json_string(&regime(total_return, Some(latest_close), ma20, ma50, volatility)),
        rows.len() >= 2,
        rows.len() >= 20,
        rows.len() >= 50,
        rows.len() >= 60,
    )
}

fn market_rows(args: &Args) -> Vec<Row> {
    let resolved_symbol = if args.source == "stooq" {
        normalize_stooq_symbol(&args.symbol, args.provider_symbol.as_deref())
    } else {
        args.provider_symbol
            .clone()
            .unwrap_or_else(|| args.symbol.clone())
            .to_lowercase()
    };
    let mut path = PathBuf::from(&args.base);
    path.push("market");
    path.push(&args.source);
    path.push(format!(
        "{}.jsonl",
        safe_dataset_name(&resolved_symbol, &args.interval)
    ));
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut rows: Vec<Row> = text
        .lines()
        .filter_map(|line| {
            parse_row(
                line,
                &args.symbol,
                &resolved_symbol,
                &args.source,
                &args.interval,
            )
        })
        .collect();
    rows.sort_by(|a, b| a.date.cmp(&b.date));
    rows
}

fn parse_row(
    line: &str,
    symbol: &str,
    resolved_symbol: &str,
    source: &str,
    interval: &str,
) -> Option<Row> {
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
    .filter(|row| !row.date.is_empty() && !source.is_empty() && !interval.is_empty())
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

fn returns(closes: &[f64]) -> Vec<f64> {
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

fn mean(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        None
    } else {
        Some(values.iter().sum::<f64>() / values.len() as f64)
    }
}

fn stddev(values: &[f64]) -> Option<f64> {
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

fn max_drawdown(closes: &[f64]) -> Option<f64> {
    let mut iter = closes.iter();
    let mut peak = *iter.next()?;
    let mut worst = 0.0;
    for close in closes {
        peak = peak.max(*close);
        if peak != 0.0 {
            worst = f64::min(worst, close / peak - 1.0);
        }
    }
    Some(worst)
}

fn moving_average(values: &[f64], window: usize) -> Option<f64> {
    if values.len() < window {
        None
    } else {
        mean(&values[values.len() - window..])
    }
}

fn volume_ratio(rows: &[Row], window: usize) -> Option<f64> {
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

fn regime(
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

fn normalize_stooq_symbol(symbol: &str, provider_symbol: Option<&str>) -> String {
    let raw = provider_symbol.unwrap_or(symbol).trim();
    if raw.starts_with('^') || raw.contains('.') {
        raw.to_lowercase()
    } else {
        format!("{}.us", raw).to_lowercase()
    }
}

fn safe_dataset_name(symbol: &str, interval: &str) -> String {
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

fn json_string(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn num(value: Option<f64>) -> String {
    match value {
        Some(value) if value.is_finite() => value.to_string(),
        _ => "null".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_same_core_regime_for_rising_prices() {
        let closes: Vec<f64> = (1..=60).map(|i| 100.0 + i as f64).collect();
        let rets = returns(&closes);
        assert_eq!(
            moving_average(&closes, 20).unwrap() > moving_average(&closes, 50).unwrap(),
            true
        );
        assert_eq!(
            regime(
                Some(0.5),
                Some(160.0),
                moving_average(&closes, 20),
                moving_average(&closes, 50),
                stddev(&rets)
            ),
            "trend-up"
        );
    }

    #[test]
    fn matches_typescript_dataset_name_rules() {
        assert_eq!(safe_dataset_name("aapl.us", "d"), "aapl_us_d");
        assert_eq!(safe_dataset_name("^IXIC", "1d"), "ixic_1d");
        assert_eq!(normalize_stooq_symbol("AAPL", None), "aapl.us");
    }
}
