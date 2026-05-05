use super::calendar::{is_iso_date, iso_day};
use super::model::Dataset;
use super::output::issue_json;

pub(crate) fn validate_dataset(dataset: &Dataset, now: &str, max_stale_days: i64) -> Vec<String> {
    let mut issues = Vec::new();
    if dataset.rows.is_empty() {
        issues.push(issue_json(
            "error",
            "empty_dataset",
            "dataset has no rows",
            &dataset.name,
            None,
        ));
        return issues;
    }
    let mut seen = Vec::<String>::new();
    let mut previous = String::new();
    for row in &dataset.rows {
        if !is_iso_date(&row.date) {
            issues.push(issue_json(
                "error",
                "invalid_date",
                "row date must be YYYY-MM-DD",
                &dataset.name,
                Some(&row.date),
            ));
        }
        if seen.iter().any(|date| date == &row.date) {
            issues.push(issue_json(
                "error",
                "duplicate_date",
                "dataset contains duplicate date rows",
                &dataset.name,
                Some(&row.date),
            ));
        }
        seen.push(row.date.clone());
        if !previous.is_empty() && row.date < previous {
            issues.push(issue_json(
                "warn",
                "unsorted_rows",
                "dataset rows are not sorted by date",
                &dataset.name,
                Some(&row.date),
            ));
        }
        previous = row.date.clone();
        if !row.close_present {
            issues.push(issue_json(
                "error",
                "invalid_close",
                "row close must be numeric",
                &dataset.name,
                Some(&row.date),
            ));
        }
        if !row.volume_valid {
            issues.push(issue_json(
                "warn",
                "invalid_volume",
                "row volume should be numeric or null",
                &dataset.name,
                Some(&row.date),
            ));
        }
    }
    if dataset.rows.len() < 20 {
        issues.push(issue_json(
            "warn",
            "short_history",
            "dataset has fewer than 20 rows; indicators will be limited",
            &dataset.name,
            None,
        ));
    }
    if let (Some(latest), Some(now_day)) = (
        dataset.rows.last().and_then(|row| iso_day(&row.date)),
        iso_day(now),
    ) {
        if now_day - latest > max_stale_days {
            issues.push(issue_json(
                "warn",
                "stale_dataset",
                &format!("latest row is {} days old", now_day - latest),
                &dataset.name,
                dataset.rows.last().map(|row| row.date.as_str()),
            ));
        }
    }
    issues
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data_validate::model::Dataset;
    use crate::data_validate::parser::parse_row;

    #[test]
    fn validates_duplicate_and_unsorted_rows() {
        let dataset = Dataset {
            source: "yahoo".to_string(),
            name: "aapl_d".to_string(),
            path: "aapl_d.jsonl".to_string(),
            rows: vec![
                parse_row(
                    r#"{"date":"2024-01-03","provider_symbol":"AAPL","interval":"d","payload":{"close":111,"volume":10}}"#,
                ),
                parse_row(
                    r#"{"date":"2024-01-02","provider_symbol":"AAPL","interval":"d","payload":{"close":"bad","volume":"bad"}}"#,
                ),
                parse_row(
                    r#"{"date":"2024-01-02","provider_symbol":"AAPL","interval":"d","payload":{"close":112,"volume":12}}"#,
                ),
            ],
        };
        let issues = validate_dataset(&dataset, "2024-01-20", 7).join("\n");
        assert!(issues.contains("\"code\":\"unsorted_rows\""));
        assert!(issues.contains("\"code\":\"invalid_close\""));
        assert!(issues.contains("\"code\":\"invalid_volume\""));
        assert!(issues.contains("\"code\":\"duplicate_date\""));
        assert!(issues.contains("\"code\":\"stale_dataset\""));
    }
}
