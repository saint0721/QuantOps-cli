use std::fs;
use std::path::{Path, PathBuf};

use super::model::{Dataset, Row};
use super::parser::parse_row;

pub(crate) fn list_datasets(base: &str) -> Vec<Dataset> {
    let root = PathBuf::from(base).join("market");
    let Ok(source_entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut datasets = Vec::new();
    let mut sources: Vec<_> = source_entries.filter_map(Result::ok).collect();
    sources.sort_by_key(|entry| entry.file_name());
    for source in sources {
        let Ok(file_type) = source.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let source_name = source.file_name().to_string_lossy().to_string();
        let Ok(file_entries) = fs::read_dir(source.path()) else {
            continue;
        };
        let mut files: Vec<_> = file_entries.filter_map(Result::ok).collect();
        files.sort_by_key(|entry| entry.file_name());
        for file in files {
            let path = file.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                continue;
            }
            let rows = read_rows(&path);
            datasets.push(Dataset {
                source: source_name.clone(),
                name: path
                    .file_stem()
                    .and_then(|name| name.to_str())
                    .unwrap_or("dataset")
                    .to_string(),
                path: path.to_string_lossy().to_string(),
                rows,
            });
        }
    }
    datasets
}

pub(crate) fn dataset_matches_symbol(dataset: &Dataset, symbol: Option<&str>) -> bool {
    let Some(symbol) = symbol else {
        return true;
    };
    let ticker = symbol.to_uppercase();
    let ticker_path = ticker.replace('.', "_");
    let provider = dataset
        .rows
        .last()
        .map(|row| row.provider_symbol.to_uppercase())
        .unwrap_or_default();
    let name = dataset.name.to_uppercase();
    provider == ticker
        || provider.starts_with(&format!("{ticker}."))
        || name == ticker_path
        || name.starts_with(&format!("{ticker_path}_"))
}

fn read_rows(path: &Path) -> Vec<Row> {
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    text.lines().map(parse_row).collect()
}
