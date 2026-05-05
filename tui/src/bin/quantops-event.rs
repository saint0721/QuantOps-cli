use std::env;

use quantops_tui::market_data::{json_string, market_rows, num, MarketOptions, Row};

#[derive(Clone, Debug)]
struct EventWindow {
    from: isize,
    to: isize,
    label: String,
}

#[derive(Debug)]
struct EventArgs {
    market: MarketOptions,
    event_date: String,
    benchmark: Option<String>,
    windows: Vec<EventWindow>,
}

#[derive(Debug)]
struct WindowResult {
    json: String,
    label: String,
    value: Option<f64>,
}

fn main() {
    match run() {
        Ok(text) => println!("{text}"),
        Err(error) => {
            println!("{{\"ok\":false,\"error\":{}}}", json_string(&error));
            std::process::exit(1);
        }
    }
}

fn run() -> Result<String, String> {
    let args = parse_args(env::args().skip(1).collect())?;
    Ok(event_study_json(&args))
}

fn default_windows() -> Vec<EventWindow> {
    vec![
        EventWindow {
            from: -5,
            to: -1,
            label: "D-5..D-1".to_string(),
        },
        EventWindow {
            from: 0,
            to: 0,
            label: "D0".to_string(),
        },
        EventWindow {
            from: 1,
            to: 5,
            label: "D+1..D+5".to_string(),
        },
        EventWindow {
            from: 6,
            to: 20,
            label: "D+6..D+20".to_string(),
        },
    ]
}

fn parse_args(raw: Vec<String>) -> Result<EventArgs, String> {
    let mut market = MarketOptions {
        base: "data".to_string(),
        symbol: String::new(),
        source: "yahoo".to_string(),
        interval: "d".to_string(),
        provider_symbol: None,
    };
    let mut event_date = String::new();
    let mut benchmark = None;
    let mut windows = Vec::new();
    let mut i = 0;
    while i < raw.len() {
        match raw[i].as_str() {
            "--base" => {
                i += 1;
                market.base = raw.get(i).ok_or("--base requires a value")?.to_string();
            }
            "--symbol" => {
                i += 1;
                market.symbol = raw.get(i).ok_or("--symbol requires a value")?.to_string();
            }
            "--event-date" => {
                i += 1;
                event_date = raw.get(i).ok_or("--event-date requires a value")?.to_string();
            }
            "--benchmark" => {
                i += 1;
                benchmark = Some(raw.get(i).ok_or("--benchmark requires a value")?.to_string());
            }
            "--source" => {
                i += 1;
                market.source = raw.get(i).ok_or("--source requires a value")?.to_string();
            }
            "--interval" => {
                i += 1;
                market.interval = raw.get(i).ok_or("--interval requires a value")?.to_string();
            }
            "--provider-symbol" => {
                i += 1;
                market.provider_symbol = Some(
                    raw.get(i)
                        .ok_or("--provider-symbol requires a value")?
                        .to_string(),
                );
            }
            "--window" => {
                i += 1;
                windows.push(parse_window(raw.get(i).ok_or("--window requires a value")?)?);
            }
            "--help" | "-h" => return Err("usage: quantops-event --symbol SYMBOL --event-date YYYY-MM-DD [--benchmark SYMBOL] [--window FROM,TO]".to_string()),
            other => return Err(format!("unknown argument: {other}")),
        }
        i += 1;
    }
    if market.symbol.is_empty() {
        return Err("--symbol is required".to_string());
    }
    if event_date.is_empty() {
        return Err("--event-date is required".to_string());
    }
    if windows.is_empty() {
        windows = default_windows();
    }
    Ok(EventArgs {
        market,
        event_date,
        benchmark,
        windows,
    })
}

fn parse_window(value: &str) -> Result<EventWindow, String> {
    let mut parts = value.split(',');
    let from = parts
        .next()
        .ok_or_else(|| format!("invalid event window: {value}"))?
        .parse::<isize>()
        .map_err(|_| format!("invalid event window: {value}"))?;
    let to = parts
        .next()
        .unwrap_or_else(|| value.split(',').next().unwrap_or(value))
        .parse::<isize>()
        .map_err(|_| format!("invalid event window: {value}"))?;
    Ok(EventWindow {
        from,
        to,
        label: format!("D{}{}..D{}{}", sign(from), from, sign(to), to),
    })
}

fn sign(value: isize) -> &'static str {
    if value >= 0 {
        "+"
    } else {
        ""
    }
}

fn event_index(rows: &[Row], event_date: &str) -> Option<usize> {
    rows.iter().position(|row| row.date.as_str() >= event_date)
}

fn window_return(rows: &[Row], index: usize, window: &EventWindow) -> WindowResult {
    let start_index = index as isize + window.from;
    let end_index = index as isize + window.to;
    let base_index = if window.from <= 0 {
        start_index - 1
    } else {
        index as isize
    };
    if base_index < 0
        || end_index < 0
        || base_index >= rows.len() as isize
        || end_index >= rows.len() as isize
        || end_index < base_index
    {
        return WindowResult {
            json: format!(
                "{{\"ok\":false,\"label\":{},\"from\":{},\"to\":{},\"error\":\"window outside available data\"}}",
                json_string(&window.label),
                window.from,
                window.to,
            ),
            label: window.label.clone(),
            value: None,
        };
    }
    let start = rows.get(start_index.max(0) as usize).unwrap();
    let base = rows.get(base_index as usize).unwrap();
    let end = rows.get(end_index as usize).unwrap();
    let value = if base.close == 0.0 {
        None
    } else {
        Some(end.close / base.close - 1.0)
    };
    WindowResult {
        json: format!(
            concat!(
                "{{",
                "\"ok\":true,",
                "\"label\":{},",
                "\"from\":{},",
                "\"to\":{},",
                "\"start_date\":{},",
                "\"base_date\":{},",
                "\"end_date\":{},",
                "\"return\":{}",
                "}}"
            ),
            json_string(&window.label),
            window.from,
            window.to,
            json_string(&start.date),
            json_string(&base.date),
            json_string(&end.date),
            num(value),
        ),
        label: window.label.clone(),
        value,
    }
}

fn event_study_json(args: &EventArgs) -> String {
    let rows = market_rows(&args.market);
    let ticker = args.market.symbol.to_uppercase();
    if rows.is_empty() {
        return format!(
            "{{\"ok\":false,\"symbol\":{},\"error\":\"no target market data\",\"next_command\":{},\"engine\":\"rust\"}}",
            json_string(&ticker),
            json_string(&format!("data download {ticker} --period 1y")),
        );
    }
    let Some(index) = event_index(&rows, &args.event_date) else {
        return format!(
            "{{\"ok\":false,\"symbol\":{},\"event_date\":{},\"error\":\"event date is after available data\",\"engine\":\"rust\"}}",
            json_string(&ticker),
            json_string(&args.event_date),
        );
    };

    let target: Vec<WindowResult> = args
        .windows
        .iter()
        .map(|window| window_return(&rows, index, window))
        .collect();
    let benchmark_rows = args
        .benchmark
        .as_ref()
        .map(|symbol| {
            market_rows(&MarketOptions {
                base: args.market.base.clone(),
                symbol: symbol.clone(),
                source: args.market.source.clone(),
                interval: args.market.interval.clone(),
                provider_symbol: None,
            })
        })
        .unwrap_or_default();
    let benchmark = event_index(&benchmark_rows, &args.event_date)
        .map(|benchmark_index| {
            args.windows
                .iter()
                .map(|window| window_return(&benchmark_rows, benchmark_index, window))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let abnormal = target
        .iter()
        .enumerate()
        .map(|(i, target_window)| {
            let benchmark_return = benchmark.get(i).and_then(|window| window.value);
            let excess_return = target_window
                .value
                .and_then(|target_return| benchmark_return.map(|bench| target_return - bench));
            format!(
                "{{\"label\":{},\"target_return\":{},\"benchmark_return\":{},\"excess_return\":{}}}",
                json_string(&target_window.label),
                num(target_window.value),
                num(benchmark_return),
                num(excess_return),
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    let latest = rows.last().unwrap();
    format!(
        concat!(
            "{{",
            "\"ok\":true,",
            "\"symbol\":{},",
            "\"event_date\":{},",
            "\"matched_event_row_date\":{},",
            "\"source\":{},",
            "\"interval\":{},",
            "\"rows\":{},",
            "\"benchmark_symbol\":{},",
            "\"benchmark_rows\":{},",
            "\"windows\":[{}],",
            "\"benchmark_windows\":[{}],",
            "\"abnormal_returns\":[{}],",
            "\"note\":\"Event study is descriptive context, not trading advice. Check event timing, market hours, and source quality before drawing conclusions.\",",
            "\"engine\":\"rust\"",
            "}}"
        ),
        json_string(&latest.ticker),
        json_string(&args.event_date),
        json_string(&rows[index].date),
        json_string(&args.market.source),
        json_string(&args.market.interval),
        rows.len(),
        args.benchmark
            .as_ref()
            .map(|symbol| json_string(&symbol.to_uppercase()))
            .unwrap_or_else(|| "null".to_string()),
        benchmark_rows.len(),
        target
            .iter()
            .map(|window| window.json.clone())
            .collect::<Vec<_>>()
            .join(","),
        benchmark
            .iter()
            .map(|window| window.json.clone())
            .collect::<Vec<_>>()
            .join(","),
        abnormal,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(day: usize, close: f64) -> Row {
        Row {
            date: format!("2026-01-{day:02}"),
            ticker: "TSM".to_string(),
            provider_symbol: "TSM".to_string(),
            close,
            volume: Some(1000.0 + day as f64),
        }
    }

    #[test]
    fn parses_custom_windows_like_typescript() {
        let window = parse_window("-2,-1").unwrap();
        assert_eq!(window.from, -2);
        assert_eq!(window.to, -1);
        assert_eq!(window.label, "D-2..D-1");
    }

    #[test]
    fn computes_event_window_return() {
        let rows: Vec<Row> = (1..=10).map(|day| row(day, 100.0 + day as f64)).collect();
        let index = event_index(&rows, "2026-01-05").unwrap();
        let result = window_return(
            &rows,
            index,
            &EventWindow {
                from: 1,
                to: 3,
                label: "D+1..D+3".to_string(),
            },
        );
        assert!(result.json.contains("\"ok\":true"));
        assert_eq!(result.value, Some(108.0 / 105.0 - 1.0));
    }
}
