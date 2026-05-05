use std::env;

use quantops_tui::market_data::{
    json_string, market_rows, max_drawdown, moving_average, num, stddev, MarketOptions,
    TRADING_DAYS,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Strategy {
    BuyHold,
    MaCross,
    Momentum,
    MeanReversion,
}

#[derive(Debug)]
struct BacktestArgs {
    market: MarketOptions,
    strategy: Strategy,
    fast: Option<f64>,
    slow: Option<f64>,
    lookback: Option<f64>,
    threshold: Option<f64>,
    created_at: String,
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
    Ok(backtest_json(&args))
}

fn parse_args(raw: Vec<String>) -> Result<BacktestArgs, String> {
    let mut market = MarketOptions {
        base: "data".to_string(),
        symbol: String::new(),
        source: "yahoo".to_string(),
        interval: "d".to_string(),
        provider_symbol: None,
    };
    let mut strategy = Strategy::MaCross;
    let mut fast = None;
    let mut slow = None;
    let mut lookback = None;
    let mut threshold = None;
    let mut created_at = "1970-01-01T00:00:00Z".to_string();
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
            "--strategy" => {
                i += 1;
                strategy = strategy_name(raw.get(i).ok_or("--strategy requires a value")?)?;
            }
            "--fast" => {
                i += 1;
                fast = parse_number(raw.get(i), "--fast")?;
            }
            "--slow" => {
                i += 1;
                slow = parse_number(raw.get(i), "--slow")?;
            }
            "--lookback" => {
                i += 1;
                lookback = parse_number(raw.get(i), "--lookback")?;
            }
            "--threshold" => {
                i += 1;
                threshold = parse_number(raw.get(i), "--threshold")?;
            }
            "--created-at" => {
                i += 1;
                created_at = raw.get(i).ok_or("--created-at requires a value")?.to_string();
            }
            "--help" | "-h" => return Err("usage: quantops-backtest --symbol SYMBOL [--strategy ma-cross|momentum|mean-reversion|buy-hold]".to_string()),
            other => return Err(format!("unknown argument: {other}")),
        }
        i += 1;
    }
    if market.symbol.is_empty() {
        return Err("--symbol is required".to_string());
    }
    Ok(BacktestArgs {
        market,
        strategy,
        fast,
        slow,
        lookback,
        threshold,
        created_at,
    })
}

fn parse_number(value: Option<&String>, name: &str) -> Result<Option<f64>, String> {
    let value = value.ok_or_else(|| format!("{name} requires a value"))?;
    value
        .parse::<f64>()
        .ok()
        .filter(|number| number.is_finite())
        .map(Some)
        .ok_or_else(|| format!("{name} must be a number"))
}

fn strategy_name(value: &str) -> Result<Strategy, String> {
    match value.trim().to_lowercase().as_str() {
        "buy-hold" | "buyhold" | "buy-and-hold" => Ok(Strategy::BuyHold),
        "ma-cross" | "ma_cross" | "ma" | "moving-average" => Ok(Strategy::MaCross),
        "momentum" => Ok(Strategy::Momentum),
        "mean-reversion" => Ok(Strategy::MeanReversion),
        other => Err(format!("unknown backtest strategy: {other}")),
    }
}

fn strategy_label(strategy: Strategy) -> &'static str {
    match strategy {
        Strategy::BuyHold => "buy-hold",
        Strategy::MaCross => "ma-cross",
        Strategy::Momentum => "momentum",
        Strategy::MeanReversion => "mean-reversion",
    }
}

fn positive_or(value: Option<f64>, fallback: f64) -> f64 {
    value.filter(|number| *number > 0.0).unwrap_or(fallback)
}

fn number_or(value: Option<f64>, fallback: f64) -> f64 {
    value.unwrap_or(fallback)
}

fn parameters(strategy: Strategy, args: &BacktestArgs) -> String {
    match strategy {
        Strategy::MaCross => {
            let slow = positive_or(args.slow, 50.0);
            let fast = positive_or(args.fast, 20.0).min(slow - 1.0);
            format!(
                "{{\"fast\":{},\"slow\":{}}}",
                num(Some(fast)),
                num(Some(slow))
            )
        }
        Strategy::Momentum => format!(
            "{{\"lookback\":{},\"threshold\":{}}}",
            num(Some(positive_or(args.lookback, 20.0))),
            num(Some(number_or(args.threshold, 0.0)))
        ),
        Strategy::MeanReversion => format!(
            "{{\"lookback\":{},\"threshold\":{}}}",
            num(Some(positive_or(args.lookback, 20.0))),
            num(Some(number_or(args.threshold, 0.03)))
        ),
        Strategy::BuyHold => "{}".to_string(),
    }
}

fn backtest_json(args: &BacktestArgs) -> String {
    let rows = market_rows(&args.market);
    let params_json = parameters(args.strategy, args);
    let ticker = args.market.symbol.to_uppercase();
    if rows.len() < 2 {
        return format!(
            "{{\"ok\":false,\"created_at\":{},\"symbol\":{},\"source\":{},\"interval\":{},\"strategy\":{},\"parameters\":{},\"rows\":{},\"error\":\"not enough market data for backtest; run data download first\",\"next_command\":{}}}",
            json_string(&args.created_at),
            json_string(&ticker),
            json_string(&args.market.source),
            json_string(&args.market.interval),
            json_string(strategy_label(args.strategy)),
            params_json,
            rows.len(),
            json_string(&format!("data download {ticker} --period 1y")),
        );
    }

    let closes: Vec<f64> = rows.iter().map(|row| row.close).collect();
    let mut equity = vec![1.0];
    let mut daily_strategy_returns = Vec::new();
    let mut positions = Vec::new();
    let mut trades = 0;
    let mut previous_position = 0.0;
    for day in 1..rows.len() {
        let position = position_for_day(args.strategy, &closes, day, args);
        if position != previous_position {
            trades += 1;
        }
        previous_position = position;
        positions.push(position);
        let previous_close = rows[day - 1].close;
        let current_close = rows[day].close;
        let market_return = if previous_close == 0.0 {
            0.0
        } else {
            current_close / previous_close - 1.0
        };
        let strategy_return = position * market_return;
        daily_strategy_returns.push(strategy_return);
        equity.push(equity.last().unwrap() * (1.0 + strategy_return));
    }

    let latest = rows.last().unwrap();
    let first_close = rows.first().unwrap().close;
    let latest_close = latest.close;
    let total_return = equity.last().unwrap() - 1.0;
    let benchmark_return = if first_close == 0.0 {
        None
    } else {
        Some(latest_close / first_close - 1.0)
    };
    let years = daily_strategy_returns.len() as f64 / TRADING_DAYS;
    let volatility = stddev(&daily_strategy_returns);
    let exposure = if positions.is_empty() {
        None
    } else {
        Some(positions.iter().sum::<f64>() / positions.len() as f64)
    };
    let win_rate = if daily_strategy_returns.is_empty() {
        None
    } else {
        Some(
            daily_strategy_returns
                .iter()
                .filter(|value| **value > 0.0)
                .count() as f64
                / daily_strategy_returns.len() as f64,
        )
    };

    format!(
        concat!(
            "{{",
            "\"ok\":true,",
            "\"created_at\":{},",
            "\"symbol\":{},",
            "\"provider_symbol\":{},",
            "\"source\":{},",
            "\"interval\":{},",
            "\"strategy\":{},",
            "\"parameters\":{},",
            "\"rows\":{},",
            "\"start_date\":{},",
            "\"end_date\":{},",
            "\"total_return\":{},",
            "\"benchmark_return\":{},",
            "\"annualized_return\":{},",
            "\"annualized_volatility\":{},",
            "\"max_drawdown\":{},",
            "\"exposure\":{},",
            "\"trades\":{},",
            "\"win_rate\":{},",
            "\"engine\":\"rust\"",
            "}}"
        ),
        json_string(&args.created_at),
        json_string(&latest.ticker),
        json_string(&latest.provider_symbol),
        json_string(&args.market.source),
        json_string(&args.market.interval),
        json_string(strategy_label(args.strategy)),
        params_json,
        rows.len(),
        json_string(&rows.first().unwrap().date),
        json_string(&latest.date),
        num(Some(total_return)),
        num(benchmark_return),
        num(if years > 0.0 {
            Some(equity.last().unwrap().powf(1.0 / years) - 1.0)
        } else {
            None
        }),
        num(volatility.map(|value| value * TRADING_DAYS.sqrt())),
        num(max_drawdown(&equity)),
        num(exposure),
        trades,
        num(win_rate),
    )
}

fn position_for_day(strategy: Strategy, closes: &[f64], day: usize, args: &BacktestArgs) -> f64 {
    if strategy == Strategy::BuyHold {
        return 1.0;
    }
    let prior = day.saturating_sub(1);
    if prior == 0 {
        return 0.0;
    }
    match strategy {
        Strategy::MaCross => {
            let slow = positive_or(args.slow, 50.0) as usize;
            let fast = (positive_or(args.fast, 20.0).min(slow as f64 - 1.0)) as usize;
            let fast_ma = moving_average(closes, prior + 1, fast);
            let slow_ma = moving_average(closes, prior + 1, slow);
            if fast_ma.is_some_and(|fast| slow_ma.is_some_and(|slow| fast > slow)) {
                1.0
            } else {
                0.0
            }
        }
        Strategy::Momentum | Strategy::MeanReversion => {
            let lookback = positive_or(args.lookback, 20.0) as usize;
            let threshold = number_or(
                args.threshold,
                if strategy == Strategy::Momentum {
                    0.0
                } else {
                    0.03
                },
            );
            if prior < lookback {
                return 0.0;
            }
            let base = closes[prior - lookback];
            let latest = closes[prior];
            if base == 0.0 {
                return 0.0;
            }
            if strategy == Strategy::Momentum {
                if latest / base - 1.0 > threshold {
                    1.0
                } else {
                    0.0
                }
            } else {
                let avg = moving_average(closes, prior + 1, lookback);
                if avg.is_some_and(|avg| latest < avg * (1.0 - threshold)) {
                    1.0
                } else {
                    0.0
                }
            }
        }
        Strategy::BuyHold => unreachable!(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aliases_strategy_names() {
        assert_eq!(strategy_name("ma").unwrap(), Strategy::MaCross);
        assert_eq!(strategy_name("buyhold").unwrap(), Strategy::BuyHold);
    }

    #[test]
    fn emits_parameter_json() {
        let args = BacktestArgs {
            market: MarketOptions {
                base: "data".to_string(),
                symbol: "AAPL".to_string(),
                source: "yahoo".to_string(),
                interval: "d".to_string(),
                provider_symbol: None,
            },
            strategy: Strategy::MaCross,
            fast: Some(5.0),
            slow: Some(20.0),
            lookback: None,
            threshold: None,
            created_at: "now".to_string(),
        };
        assert_eq!(
            parameters(Strategy::MaCross, &args),
            "{\"fast\":5,\"slow\":20}"
        );
    }
}
