#[derive(Clone, Debug)]
pub(crate) struct Dataset {
    pub(crate) source: String,
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) rows: Vec<Row>,
}

#[derive(Clone, Debug)]
pub(crate) struct Row {
    pub(crate) date: String,
    pub(crate) provider_symbol: String,
    pub(crate) interval: String,
    pub(crate) close_present: bool,
    pub(crate) volume_valid: bool,
}

#[derive(Debug)]
pub(crate) struct Args {
    pub(crate) base: String,
    pub(crate) symbol: Option<String>,
    pub(crate) now: String,
    pub(crate) max_stale_days: i64,
}
