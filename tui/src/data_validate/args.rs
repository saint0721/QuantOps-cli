use super::calendar::current_utc_date;
use super::model::Args;

pub(crate) fn parse_args(raw: Vec<String>) -> Result<Args, String> {
    let mut args = Args {
        base: "data".to_string(),
        symbol: None,
        now: current_utc_date(),
        max_stale_days: 7,
    };
    let mut i = 0;
    while i < raw.len() {
        match raw[i].as_str() {
            "--base" => {
                i += 1;
                args.base = raw.get(i).ok_or("--base requires a value")?.to_string();
            }
            "--symbol" => {
                i += 1;
                args.symbol = Some(raw.get(i).ok_or("--symbol requires a value")?.to_string());
            }
            "--now" => {
                i += 1;
                args.now = raw.get(i).ok_or("--now requires a value")?.to_string();
            }
            "--max-stale-days" => {
                i += 1;
                args.max_stale_days = raw
                    .get(i)
                    .ok_or("--max-stale-days requires a value")?
                    .parse::<i64>()
                    .map_err(|_| "--max-stale-days must be an integer".to_string())?;
            }
            "--help" | "-h" => {
                return Err("usage: quantops-validate [--base DIR] [--symbol SYMBOL] [--now YYYY-MM-DD] [--max-stale-days N]".to_string());
            }
            other => return Err(format!("unknown argument: {other}")),
        }
        i += 1;
    }
    Ok(args)
}
