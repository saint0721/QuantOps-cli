use std::env;

use quantops_core::market_data::{
    json_string, market_rows, max_drawdown, num, regime, returns, stddev, trailing_average,
    volume_ratio, MarketOptions, TRADING_DAYS,
};

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
    Ok(stats_json(&args))
}

fn parse_args(raw: Vec<String>) -> Result<MarketOptions, String> {
    let mut options = MarketOptions {
        base: "data".to_string(),
        symbol: String::new(),
        source: "stooq".to_string(),
        interval: "d".to_string(),
        provider_symbol: None,
    };
    let mut i = 0;
    while i < raw.len() {
        match raw[i].as_str() {
            "--base" => {
                i += 1;
                options.base = raw.get(i).ok_or("--base requires a value")?.to_string();
            }
            "--symbol" => {
                i += 1;
                options.symbol = raw.get(i).ok_or("--symbol requires a value")?.to_string();
            }
            "--source" => {
                i += 1;
                options.source = raw.get(i).ok_or("--source requires a value")?.to_string();
            }
            "--interval" => {
                i += 1;
                options.interval = raw.get(i).ok_or("--interval requires a value")?.to_string();
            }
            "--provider-symbol" => {
                i += 1;
                options.provider_symbol = Some(
                    raw.get(i)
                        .ok_or("--provider-symbol requires a value")?
                        .to_string(),
                );
            }
            "--help" | "-h" => return Err("usage: quantops-stats --symbol SYMBOL [--base DIR] [--source stooq|yahoo] [--interval d] [--provider-symbol ID]".to_string()),
            other => return Err(format!("unknown argument: {other}")),
        }
        i += 1;
    }
    if options.symbol.is_empty() {
        return Err("--symbol is required".to_string());
    }
    Ok(options)
}

fn stats_json(options: &MarketOptions) -> String {
    let rows = market_rows(options);
    if rows.is_empty() {
        return format!(
            "{{\"ok\":false,\"ticker\":{},\"source\":{},\"interval\":{},\"rows\":0,\"error\":\"no market dataset found; run data download first\",\"next_command\":{}}}",
            json_string(&options.symbol.to_uppercase()),
            json_string(&options.source),
            json_string(&options.interval),
            json_string(&format!("data download {}", options.symbol.to_uppercase())),
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
    let volatility = stddev(&row_returns);
    let ma20 = trailing_average(&closes, 20);
    let ma50 = trailing_average(&closes, 50);
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
        json_string(&options.source),
        json_string(&options.interval),
        rows.len(),
        json_string(&rows.first().unwrap().date),
        json_string(&latest.date),
        num(Some(latest_close)),
        num(total_return),
        num(quantops_core::market_data::mean(&row_returns)),
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

#[cfg(test)]
mod tests {
    use super::*;
    use quantops_core::market_data::{moving_average, returns, stddev};

    #[test]
    fn computes_same_core_regime_for_rising_prices() {
        let closes: Vec<f64> = (1..=60).map(|i| 100.0 + i as f64).collect();
        let rets = returns(&closes);
        assert!(
            moving_average(&closes, closes.len(), 20).unwrap()
                > moving_average(&closes, closes.len(), 50).unwrap()
        );
        assert_eq!(
            regime(
                Some(0.5),
                Some(160.0),
                moving_average(&closes, closes.len(), 20),
                moving_average(&closes, closes.len(), 50),
                stddev(&rets)
            ),
            "trend-up"
        );
    }
}
