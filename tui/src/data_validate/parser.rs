use super::model::Row;

pub(crate) fn parse_row(line: &str) -> Row {
    Row {
        date: extract_string(line, "\"date\":").unwrap_or_default(),
        provider_symbol: extract_string(line, "\"provider_symbol\":").unwrap_or_default(),
        interval: extract_string(line, "\"interval\":").unwrap_or_default(),
        close_present: extract_payload_number(line, "close").is_some(),
        volume_valid: extract_payload_raw(line, "volume")
            .map(|raw| raw == "null" || raw.parse::<f64>().is_ok_and(|value| value.is_finite()))
            .unwrap_or(true),
    }
}

fn extract_string(line: &str, key: &str) -> Option<String> {
    let start = line.find(key)? + key.len();
    let rest = line.get(start..)?.trim_start();
    let rest = rest.strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn extract_payload_raw<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let payload = line.find("\"payload\":")?;
    let key_start = line[payload..].find(&format!("\"{key}\":"))? + payload;
    let rest = line.get(key_start + key.len() + 3..)?.trim_start();
    if let Some(rest) = rest.strip_prefix('"') {
        let end = rest.find('"')?;
        return Some(&rest[..end]);
    }
    let end = rest
        .find(|c: char| c == ',' || c == '}' || c.is_whitespace())
        .unwrap_or(rest.len());
    Some(rest[..end].trim())
}

fn extract_payload_number(line: &str, key: &str) -> Option<f64> {
    extract_payload_raw(line, key)
        .and_then(|raw| raw.parse::<f64>().ok().filter(|value| value.is_finite()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_invalid_payload_numbers() {
        let row = parse_row(
            r#"{"date":"2024-01-02","provider_symbol":"AAPL","interval":"d","payload":{"close":"bad","volume":"bad"}}"#,
        );
        assert!(!row.close_present);
        assert!(!row.volume_valid);
    }
}
