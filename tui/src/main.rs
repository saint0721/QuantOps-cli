use std::env;
use std::fs;
use std::io;
use std::io::IsTerminal;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use crossterm::event::{
    self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEvent, KeyModifiers,
    MouseEvent, MouseEventKind,
};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout, Position};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use ratatui::Terminal;

const TOSS_BLUE: Color = Color::Rgb(0, 100, 255);
const CHAT_BG: Color = Color::Rgb(238, 238, 238);
const PROMPT_LABEL: &str = " ❯ ";
const INPUT_PLACEHOLDER: &str = "자연어로 입력하세요. 예: NVDA 실적 모멘텀 검증";
const ROOT_COMMANDS: &[&str] = &[
    "/start",
    "/next",
    "/download",
    "/research",
    "/idea",
    "/lab",
    "/tools",
    "/provider",
    "/session",
    "/skills",
    "/list",
    "/status",
    "/collect",
    "/data",
    "/discover",
    "/sources",
    "/symbol",
    "/stats",
    "/backtest",
    "/strategy",
    "/quote",
    "/history",
    "/classify",
    "/portfolio",
    "/order",
    "/brief",
    "/watchlist",
    "/hud",
    "/runtime",
    "/codex",
    "/quant",
    "/exit",
];

struct App {
    entry: PathBuf,
    node: String,
    data_dir: String,
    mode: String,
    input: String,
    cursor: usize,
    history: Vec<String>,
    history_index: Option<usize>,
    draft_input: String,
    transcript: Vec<String>,
    scroll_offset: usize,
    pending: Option<PendingRun>,
}

struct PendingRun {
    child: Child,
    command: String,
    started_at: Instant,
}

impl App {
    fn new(entry: PathBuf, data_dir: String, node: String) -> Self {
        Self {
            entry,
            node,
            data_dir,
            mode: "quant".to_string(),
            input: String::new(),
            cursor: 0,
            history: Vec::new(),
            history_index: None,
            draft_input: String::new(),
            transcript: welcome_lines("quant"),
            scroll_offset: 0,
            pending: None,
        }
    }

    fn insert(&mut self, ch: char) {
        self.history_index = None;
        self.input.insert(self.cursor, ch);
        self.cursor += ch.len_utf8();
    }

    fn backspace(&mut self) {
        if self.cursor == 0 {
            return;
        }
        self.history_index = None;
        let prev = self.input[..self.cursor]
            .char_indices()
            .last()
            .map(|(idx, _)| idx)
            .unwrap_or(0);
        self.input.drain(prev..self.cursor);
        self.cursor = prev;
    }

    fn delete(&mut self) {
        if self.cursor >= self.input.len() {
            return;
        }
        self.history_index = None;
        let next = self.input[self.cursor..]
            .char_indices()
            .nth(1)
            .map(|(idx, _)| self.cursor + idx)
            .unwrap_or(self.input.len());
        self.input.drain(self.cursor..next);
    }

    fn move_left(&mut self) {
        if self.cursor == 0 {
            return;
        }
        self.cursor = self.input[..self.cursor]
            .char_indices()
            .last()
            .map(|(idx, _)| idx)
            .unwrap_or(0);
    }

    fn move_right(&mut self) {
        if self.cursor >= self.input.len() {
            return;
        }
        self.cursor = self.input[self.cursor..]
            .char_indices()
            .nth(1)
            .map(|(idx, _)| self.cursor + idx)
            .unwrap_or(self.input.len());
    }

    fn set_input(&mut self, input: String) {
        self.input = input;
        self.cursor = self.input.len();
    }

    fn history_prev(&mut self) {
        if self.history.is_empty() {
            return;
        }
        let next_index = match self.history_index {
            None => {
                self.draft_input = self.input.clone();
                self.history.len() - 1
            }
            Some(0) => 0,
            Some(index) => index - 1,
        };
        self.history_index = Some(next_index);
        self.set_input(self.history[next_index].clone());
    }

    fn history_next(&mut self) {
        let Some(index) = self.history_index else {
            return;
        };
        if index + 1 >= self.history.len() {
            self.history_index = None;
            self.set_input(self.draft_input.clone());
            self.draft_input.clear();
            return;
        }
        let next_index = index + 1;
        self.history_index = Some(next_index);
        self.set_input(self.history[next_index].clone());
    }

    fn completion_matches(&self) -> Vec<String> {
        completion_matches_with_data_dir(&self.input, &self.mode, Some(&self.data_dir))
    }

    fn complete_current_token(&mut self) {
        let matches = self.completion_matches();
        let Some(candidate) = matches.first() else {
            return;
        };
        let (start, end, _) = token_bounds(&self.input, self.cursor);
        self.input.replace_range(start..end, candidate);
        self.cursor = start + candidate.len();
        if !self.input[self.cursor..].starts_with(' ') {
            self.input.insert(self.cursor, ' ');
            self.cursor += 1;
        }
        self.history_index = None;
    }

    fn submit(&mut self) -> bool {
        let line = self.input.trim().to_string();
        self.input.clear();
        self.cursor = 0;
        if line.is_empty() {
            return false;
        }
        if self.history.last() != Some(&line) {
            self.history.push(line.clone());
        }
        self.history_index = None;
        self.draft_input.clear();
        if line == "/exit" {
            shutdown_managed_tmux_runtime();
            return true;
        }
        if matches!(line.as_str(), "exit" | "/quit" | "quit" | "/:q" | ":q") {
            self.append_exchange(
                &line,
                "Use /exit to close QuantOps and its managed tmux session.",
            );
            return false;
        }
        if line == "/codex" {
            self.mode = "codex".to_string();
            self.append_exchange(&line, "mode   codex");
            return false;
        }
        if line == "/quant" {
            self.mode = "quant".to_string();
            self.append_exchange(&line, "mode   quant");
            return false;
        }
        if self.pending.is_some() {
            self.append_exchange(
                &line,
                "A command is still running. Wait for it to finish before submitting another command.",
            );
            return false;
        }
        match self.start_line(&line) {
            Ok(()) => {}
            Err(output) => self.append_exchange(&line, &output),
        }
        false
    }

    fn scroll_up(&mut self, amount: usize) {
        self.scroll_offset = self.scroll_offset.saturating_add(amount);
    }

    fn scroll_down(&mut self, amount: usize) {
        self.scroll_offset = self.scroll_offset.saturating_sub(amount);
    }

    fn append_exchange(&mut self, command: &str, output: &str) {
        self.append_command(command);
        self.append_output(output);
    }

    fn append_command(&mut self, command: &str) {
        self.scroll_offset = 0;
        if self.transcript.last().is_some_and(|line| !line.is_empty()) {
            self.transcript.push(String::new());
        }
        self.transcript
            .push(format!("QuantOps {} ❯ {command}", self.mode));
    }

    fn append_output(&mut self, output: &str) {
        self.scroll_offset = 0;
        let cleaned = output.trim();
        if cleaned.is_empty() {
            self.transcript.push("done".to_string());
        } else {
            self.transcript
                .extend(cleaned.lines().map(|line| line.to_string()));
        }
    }

    fn start_line(&mut self, line: &str) -> Result<(), String> {
        let args = self.command_args(line);
        if args.is_empty() {
            return Err("try /start, /idea, /download NVDA, /stats NVDA, /backtest run NVDA, /next, or just type a natural-language chat message"
                .to_string());
        }
        let child = Command::new(&self.node)
            .arg(&self.entry)
            .arg("--no-tmux")
            .arg("--data-dir")
            .arg(&self.data_dir)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("failed to run command: {error}"))?;
        self.append_command(line);
        self.transcript.push("running...".to_string());
        self.pending = Some(PendingRun {
            child,
            command: line.to_string(),
            started_at: Instant::now(),
        });
        Ok(())
    }

    fn poll_pending(&mut self) {
        let Some(pending) = &mut self.pending else {
            return;
        };
        let Ok(Some(_status)) = pending.child.try_wait() else {
            return;
        };
        let Some(pending) = self.pending.take() else {
            return;
        };
        let output = pending.child.wait_with_output();
        let text = match output {
            Ok(output) => {
                let mut text = String::new();
                text.push_str(&String::from_utf8_lossy(&output.stdout));
                text.push_str(&String::from_utf8_lossy(&output.stderr));
                let cleaned = strip_ansi(&text).trim().to_string();
                if output.status.code() == Some(2) && cleaned.contains("unknown command:") {
                    "unknown slash command: try /start, /idea, /download NVDA, /stats NVDA, /backtest run NVDA, /next, or just type a natural-language chat message"
                        .to_string()
                } else {
                    cleaned
                }
            }
            Err(error) => format!("failed to read command output: {error}"),
        };
        if self.transcript.last().is_some_and(|line| line == "running...") {
            self.transcript.pop();
        }
        self.append_output(&text);
    }

    fn command_args(&self, line: &str) -> Vec<String> {
        if line == "/status" {
            return vec!["status".to_string()];
        }
        if let Some(rest) = line.strip_prefix("/watchlist") {
            return split_args(&format!("watchlist{rest}"));
        }
        if line == "/hud" {
            return vec!["hud".to_string()];
        }
        if let Some(rest) = line.strip_prefix("/runtime") {
            return split_args(&format!("runtime{rest}"));
        }
        if let Some(command) = line.strip_prefix('/') {
            return split_args(command);
        }
        if line.starts_with('$') {
            return vec!["codex-prompt".to_string(), line.to_string()];
        }
        if self.mode == "codex" {
            return vec!["codex-prompt".to_string(), line.to_string()];
        }
        vec!["agent".to_string(), line.to_string()]
    }
}

fn welcome_lines(mode: &str) -> Vec<String> {
    vec![
        "  ___                  _    ___             ".to_string(),
        " / _ \\ _   _  __ _ _ __ | |_ / _ \\ _ __  ___ ".to_string(),
        "| | | | | | |/ _` | '_ \\| __| | | | '_ \\/ __|".to_string(),
        "| |_| | |_| | (_| | | | | |_| |_| | |_) \\__ \\".to_string(),
        " \\__\\_\\\\__,_|\\__,_|_| |_|\\__|\\___/| .__/|___/".to_string(),
        "                                  |_|        ".to_string(),
        "".to_string(),
        format!("QuantOps@{mode}"),
        "project  QuantOps-cli — agentic quant research and execution workflows".to_string(),
        "runtime  TypeScript CLI + Rust TUI + tmux HUD when available".to_string(),
        "safety   read-only data by default · trading mutations disabled".to_string(),
        "".to_string(),
        "chat     그냥 입력: NVDA 실적 모멘텀을 검증하고 싶어".to_string(),
        "beginner /start · /next · /idea · /lab · /skills · /download <SYMBOL> · /stats <SYMBOL> · /research <SYMBOL> · /list".to_string(),
        "flow     자연어 채팅 → agent tool 실행/제안 → /idea 또는 /lab 저장 → /backtest".to_string(),
        "advanced /backtest run latest · /strategy list · /lab verify latest · /discover · /data info · /stats <SYMBOL>".to_string(),
        "tools    /skills · /tools · $quantops-idea-coach · /hud · /codex · /quant · /exit".to_string(),
        "keys     Tab completes from the search row · ↑/↓ history · ←/→ move cursor".to_string(),
        "".to_string(),
        "try      /start".to_string(),
    ]
}

fn split_args(line: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for ch in line.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if let Some(active) = quote {
            if ch == active {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
            quote = Some(ch);
            continue;
        }
        if ch.is_whitespace() {
            if !current.is_empty() {
                args.push(current);
                current = String::new();
            }
            continue;
        }
        current.push(ch);
    }
    if escaped {
        current.push('\\');
    }
    if !current.is_empty() {
        args.push(current);
    }
    args
}

fn command_candidates(
    command: &str,
    parts: &[&str],
    trailing_space: bool,
) -> &'static [&'static str] {
    match command {
        "/collect" => collect_candidates(parts, trailing_space),
        "/data" => data_candidates(parts, trailing_space),
        "/download" => download_candidates(parts, trailing_space),
        "/analyze" => &[],
        "/research" => research_candidates(parts, trailing_space),
        "/skills" => &[],
        "/tools" => &["list", "run"],
        "/agent" => agent_candidates(parts, trailing_space),
        "/provider" => &["list", "--json"],
        "/session" => &["current", "list", "handoff", "--json"],
        "/idea" => one_level_candidates(
            parts,
            trailing_space,
            &["new", "list", "show", "add-symbol", "add-hypothesis", "status"],
        ),
        "/lab" => one_level_candidates(
            parts,
            trailing_space,
            &["workflow", "discuss", "verify", "backtest"],
        ),
        "/list" => &[],
        "/discover" => discover_candidates(parts, trailing_space),
        "/sources" => one_level_candidates(
            parts,
            trailing_space,
            &["list", "stooq", "tossctl", "yahoo", "nasdaq", "vendor"],
        ),
        "/symbol" => symbol_candidates(parts, trailing_space),
        "/stats" => &[],
        "/backtest" => backtest_candidates(parts, trailing_space),
        "/strategy" => one_level_candidates(parts, trailing_space, &["list"]),
        "/quote" => one_level_candidates(parts, trailing_space, &["fetch", "history"]),
        "/watchlist" => {
            one_level_candidates(parts, trailing_space, &["add", "fetch", "list", "remove"])
        }
        "/runtime" => one_level_candidates(parts, trailing_space, &["line", "snapshot"]),
        "/hud" => one_level_candidates(parts, trailing_space, &["tmux"]),
        "/portfolio" => one_level_candidates(parts, trailing_space, &["snapshot"]),
        "/order" => one_level_candidates(parts, trailing_space, &["preview"]),
        _ => &[],
    }
}

fn agent_candidates(parts: &[&str], trailing_space: bool) -> &'static [&'static str] {
    if parts.len() <= 1 || (parts.len() == 2 && !trailing_space) {
        return &["ko", "en", "auto", "--provider", "--download", "--json", "--session"];
    }
    if parts.get(1) == Some(&"lang") && (parts.len() <= 2 || (parts.len() == 3 && !trailing_space)) {
        return &["ko", "en", "auto"];
    }
    if trailing_space && parts.last() == Some(&"--lang") {
        return &["ko", "en", "auto"];
    }
    &["--provider", "--download", "--json", "--session"]
}

fn backtest_candidates(parts: &[&str], trailing_space: bool) -> &'static [&'static str] {
    if parts.len() <= 1 || (parts.len() == 2 && !trailing_space) {
        return &["run", "strategies", "list"];
    }
    if parts.get(1) == Some(&"run") {
        if parts.len() <= 2 || (parts.len() == 3 && !trailing_space) {
            return &["latest", "AAPL", "NVDA", "SPY"];
        }
        if trailing_space && parts.last() == Some(&"--strategy") {
            return &["buy-hold", "ma-cross", "momentum", "mean-reversion"];
        }
        if trailing_space && parts.last() == Some(&"--source") {
            return &["yahoo", "stooq"];
        }
        return &[
            "--strategy",
            "--fast",
            "--slow",
            "--lookback",
            "--threshold",
            "--source",
            "--interval",
            "--provider-symbol",
            "--no-save",
            "--json",
        ];
    }
    &[]
}

fn idea_reference_candidates(data_dir: Option<&str>) -> Vec<String> {
    let Some(data_dir) = data_dir else {
        return Vec::new();
    };
    let ideas_dir = Path::new(data_dir).join("ideas");
    let Ok(entries) = fs::read_dir(ideas_dir) else {
        return Vec::new();
    };
    let mut ids = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            (path.extension().and_then(|item| item.to_str()) == Some("json"))
                .then(|| path.file_stem()?.to_str().map(str::to_string))
                .flatten()
        })
        .collect::<Vec<_>>();
    ids.sort();
    ids.reverse();
    if ids.is_empty() {
        Vec::new()
    } else {
        let mut candidates = vec!["latest".to_string()];
        candidates.extend(ids);
        candidates
    }
}

fn idea_candidates(parts: &[&str], trailing_space: bool, data_dir: Option<&str>) -> Vec<String> {
    if parts.len() <= 1 || (parts.len() == 2 && !trailing_space) {
        return ["new", "list", "show", "add-symbol", "add-hypothesis", "status"]
            .iter()
            .map(|item| item.to_string())
            .collect();
    }
    let action = parts.get(1).copied().unwrap_or("");
    let needs_reference = matches!(action, "show" | "status" | "add-symbol" | "add-hypothesis");
    if needs_reference && (parts.len() <= 2 || (parts.len() == 3 && !trailing_space)) {
        return idea_reference_candidates(data_dir);
    }
    if matches!(action, "show" | "status")
        && ((trailing_space && parts.len() <= 3) || parts.len() == 4)
    {
        return vec!["--plain".to_string()];
    }
    Vec::new()
}

fn lab_candidates(parts: &[&str], trailing_space: bool, data_dir: Option<&str>) -> Vec<String> {
    if parts.len() <= 1 || (parts.len() == 2 && !trailing_space) {
        return ["workflow", "discuss", "verify", "backtest"]
            .iter()
            .map(|item| item.to_string())
            .collect();
    }
    let action = parts.get(1).copied().unwrap_or("");
    if matches!(action, "workflow" | "discuss" | "verify" | "backtest")
        && (parts.len() <= 2 || (parts.len() == 3 && !trailing_space))
    {
        return idea_reference_candidates(data_dir);
    }
    if matches!(action, "discuss" | "verify" | "backtest")
        && ((trailing_space && parts.len() <= 3) || parts.len() == 4)
    {
        return vec![
            "--codex".to_string(),
            "--prompt".to_string(),
            "--no-save".to_string(),
        ];
    }
    Vec::new()
}

fn quant_skills_dir() -> PathBuf {
    env::var("QUANTOPS_SKILLS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("quant-skills")
        })
}

fn skill_invocation_candidates() -> Vec<String> {
    skill_invocation_candidates_in(&quant_skills_dir())
}

fn skill_invocation_candidates_in(skills_dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    for root in [skills_dir.to_path_buf(), skills_dir.join(".system")] {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.join("SKILL.md").exists() {
                continue;
            }
            if let Some(name) = path.file_name().and_then(|item| item.to_str()) {
                if name != ".system" {
                    out.push(format!("${name}"));
                }
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

const DISCOVER_CATEGORIES: &[&str] = &[
    "trending",
    "most-active",
    "gainers",
    "losers",
    "etf",
    "semiconductor",
];

const DISCOVER_OPTIONS: &[&str] = &[
    "--source",
    "--limit",
    "--download",
    "--period",
    "--start",
    "--end",
];

const DISCOVER_SOURCES: &[&str] = &["local", "yahoo"];
const DISCOVER_LIMITS: &[&str] = &["10", "25", "50", "100"];
const DISCOVER_PERIODS: &[&str] = &["5d", "30d", "6mo", "1y", "ytd", "max"];

fn one_level_candidates(
    parts: &[&str],
    trailing_space: bool,
    candidates: &'static [&'static str],
) -> &'static [&'static str] {
    if parts.len() <= 1 || (parts.len() == 2 && !trailing_space) {
        candidates
    } else {
        &[]
    }
}

fn discover_candidates(parts: &[&str], trailing_space: bool) -> &'static [&'static str] {
    if parts.len() <= 1 || (parts.len() == 2 && !trailing_space) {
        return DISCOVER_CATEGORIES;
    }
    if let Some(previous) = parts.last().copied() {
        if trailing_space {
            match previous {
                "--source" => return DISCOVER_SOURCES,
                "--limit" => return DISCOVER_LIMITS,
                "--period" => return DISCOVER_PERIODS,
                "--start" | "--end" => return &[],
                _ => {}
            }
        }
    }
    if parts.len() >= 2 {
        return DISCOVER_OPTIONS;
    }
    DISCOVER_CATEGORIES
}

fn download_candidates(parts: &[&str], trailing_space: bool) -> &'static [&'static str] {
    if parts.len() >= 2 && trailing_space {
        return &["--period", "--start", "--end"];
    }
    &[]
}

fn research_candidates(parts: &[&str], trailing_space: bool) -> &'static [&'static str] {
    if parts.len() <= 1 || (parts.len() <= 2 && !trailing_space) {
        return &["AAPL", "NVDA", "TSM", "SPY"];
    }
    if trailing_space && parts.last().copied() == Some("--source") {
        return &["yahoo", "stooq"];
    }
    if trailing_space && parts.last().copied() == Some("--interval") {
        return &["d", "1d", "1wk", "1mo"];
    }
    if trailing_space && matches!(parts.last().copied(), Some("--topic" | "--provider-symbol")) {
        return &[];
    }
    if trailing_space || parts.last().is_some_and(|token| token.starts_with("--")) {
        return &[
            "--topic",
            "--source",
            "--interval",
            "--provider-symbol",
            "--no-save",
            "--codex",
        ];
    }
    &[]
}

fn symbol_candidates(parts: &[&str], trailing_space: bool) -> &'static [&'static str] {
    if parts.len() <= 1 || (parts.len() == 2 && !trailing_space) {
        return &["search", "info"];
    }
    if parts.get(1).copied() == Some("search") {
        if trailing_space && parts.last().copied() == Some("--source") {
            return &["local", "yahoo"];
        }
        if trailing_space && parts.last().copied() == Some("--limit") {
            return &["5", "10", "25", "50"];
        }
        return &["--source", "--limit"];
    }
    &[]
}

fn collect_candidates(parts: &[&str], trailing_space: bool) -> &'static [&'static str] {
    if parts.len() <= 1 {
        return &["plan", "quote", "watchlist"];
    }
    match parts.get(1).copied() {
        Some("plan") if parts.len() == 2 && trailing_space => &["--watchlist"],
        Some("plan") if parts.len() <= 2 => &["--watchlist"],
        None => &["plan", "quote", "watchlist"],
        _ if parts.len() <= 2 => &["plan", "quote", "watchlist"],
        _ => &[],
    }
}

fn data_candidates(parts: &[&str], trailing_space: bool) -> &'static [&'static str] {
    if parts.len() <= 1 {
        return &["download", "watchlist", "list", "info", "validate", "refresh"];
    }
    match parts.get(1).copied() {
        Some("list") => &[],
        Some("info") if parts.len() >= 3 && trailing_space => &["--json", "--source", "--interval"],
        Some("validate") if parts.len() >= 3 && trailing_space => &["--json", "--max-stale-days"],
        Some("download") if parts.len() >= 3 && trailing_space => &[
            "--period",
            "--start",
            "--end",
            "--interval",
            "--source",
            "--provider-symbol",
        ],
        Some("refresh") if parts.len() >= 3 && trailing_space => &[
            "--period",
            "--start",
            "--end",
            "--interval",
            "--source",
            "--provider-symbol",
        ],
        Some("download" | "refresh") if parts.len() <= 2 => &["download", "watchlist", "list", "info", "validate", "refresh"],
        Some("watchlist") if parts.len() <= 2 || (parts.len() <= 3 && !trailing_space) => {
            &["refresh", "--period", "--start", "--end", "--interval", "--source"]
        }
        Some("watchlist") if parts.get(2).copied() == Some("refresh") && trailing_space => {
            &["--period", "--start", "--end", "--interval", "--source"]
        }
        Some("watchlist") if parts.len() >= 2 && trailing_space => {
            &["refresh", "--period", "--start", "--end", "--interval", "--source"]
        }
        _ if parts.len() <= 2 => &["download", "watchlist", "list", "info", "validate", "refresh"],
        _ => &[],
    }
}

fn token_bounds(input: &str, cursor: usize) -> (usize, usize, String) {
    let start = input[..cursor]
        .char_indices()
        .rev()
        .find(|(_, ch)| ch.is_whitespace())
        .map(|(idx, ch)| idx + ch.len_utf8())
        .unwrap_or(0);
    let end = input[cursor..]
        .char_indices()
        .find(|(_, ch)| ch.is_whitespace())
        .map(|(idx, _)| cursor + idx)
        .unwrap_or(input.len());
    (start, end, input[start..end].to_string())
}

#[cfg(test)]
fn completion_matches(input: &str, mode: &str) -> Vec<String> {
    completion_matches_with_data_dir(input, mode, None)
}

fn completion_matches_with_data_dir(input: &str, mode: &str, data_dir: Option<&str>) -> Vec<String> {
    let trimmed = input.trim_start();
    if trimmed.starts_with('$') {
        let token = active_completion_token(trimmed);
        return skill_invocation_candidates()
            .into_iter()
            .filter(|candidate| token.is_empty() || candidate.starts_with(&token))
            .collect();
    }
    if mode == "codex" && !input.starts_with('/') {
        return ROOT_COMMANDS.iter().map(|item| item.to_string()).collect();
    }
    if trimmed.is_empty() {
        return ROOT_COMMANDS.iter().map(|item| item.to_string()).collect();
    }
    let cursor = input.len();
    let (_, _, token) = token_bounds(input, cursor);
    let parts = trimmed.split_whitespace().collect::<Vec<_>>();
    let candidates = if parts.len() <= 1 && !trimmed.ends_with(' ') {
        ROOT_COMMANDS.iter().map(|item| item.to_string()).collect()
    } else if parts.first().copied() == Some("/idea") {
        idea_candidates(&parts, trimmed.ends_with(' '), data_dir)
    } else if parts.first().copied() == Some("/lab") {
        lab_candidates(&parts, trimmed.ends_with(' '), data_dir)
    } else {
        let command = parts.first().copied().unwrap_or("");
        command_candidates(command, &parts, trimmed.ends_with(' '))
            .iter()
            .map(|item| item.to_string())
            .collect()
    };
    candidates
        .into_iter()
        .filter(|candidate| token.is_empty() || candidate.starts_with(&token))
        .collect()
}

fn display_width(text: &str) -> u16 {
    text.chars()
        .map(char_display_width)
        .sum::<usize>()
        .min(u16::MAX as usize) as u16
}

fn char_display_width(ch: char) -> usize {
    match ch {
        '\u{0000}'..='\u{001f}' | '\u{007f}'..='\u{009f}' => 0,
        '\u{1100}'..='\u{115f}'
        | '\u{2329}'..='\u{232a}'
        | '\u{2e80}'..='\u{a4cf}'
        | '\u{ac00}'..='\u{d7a3}'
        | '\u{f900}'..='\u{faff}'
        | '\u{fe10}'..='\u{fe19}'
        | '\u{fe30}'..='\u{fe6f}'
        | '\u{ff00}'..='\u{ff60}'
        | '\u{ffe0}'..='\u{ffe6}' => 2,
        _ => 1,
    }
}

#[cfg(test)]
fn input_cursor_column(input: &str, cursor: usize) -> u16 {
    display_width(&input[..cursor])
}

fn input_cursor_visual_position(input: &str, cursor: usize, width: u16) -> (u16, u16) {
    let width = usize::from(width.max(1));
    let mut row = 0usize;
    let mut col = usize::from(display_width(PROMPT_LABEL)).min(width.saturating_sub(1));
    for ch in input[..cursor].chars() {
        let ch_width = char_display_width(ch);
        if col > 0 && col + ch_width > width {
            row += 1;
            col = 0;
        }
        col += ch_width;
        if col >= width {
            row += col / width;
            col %= width;
        }
    }
    (col.min(width.saturating_sub(1)) as u16, row as u16)
}

fn input_visual_rows(input: &str, width: u16) -> u16 {
    let displayed = if input.is_empty() {
        INPUT_PLACEHOLDER
    } else {
        input
    };
    let (_, row) = input_cursor_visual_position(displayed, displayed.len(), width);
    row.saturating_add(1).max(1)
}

fn dynamic_input_height(input: &str, width: u16, frame_height: u16) -> u16 {
    let desired = input_visual_rows(input, width).saturating_add(1).max(3);
    let max_height = frame_height.saturating_sub(3).max(1);
    desired.min(max_height)
}

fn strip_ansi(text: &str) -> String {
    let mut out = String::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for code in chars.by_ref() {
                if ('@'..='~').contains(&code) {
                    break;
                }
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn main() -> io::Result<()> {
    let mut entry = PathBuf::from("src/cli.ts");
    let mut data_dir = "data".to_string();
    let mut node = "node".to_string();
    let mut mouse_capture = env::var("QUANTOPS_TUI_MOUSE")
        .map(|value| !matches!(value.as_str(), "0" | "false" | "off" | "no"))
        .unwrap_or(true);
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--entry" => {
                entry = PathBuf::from(args.next().unwrap_or_else(|| "src/cli.ts".to_string()))
            }
            "--data-dir" => data_dir = args.next().unwrap_or_else(|| "data".to_string()),
            "--node" => node = args.next().unwrap_or_else(|| "node".to_string()),
            "--mouse" => {
                let value = args.next().unwrap_or_else(|| "on".to_string());
                mouse_capture = !matches!(value.as_str(), "0" | "false" | "off" | "no");
            }
            _ => {}
        }
    }

    if !io::stdin().is_terminal() || !io::stdout().is_terminal() {
        return Ok(());
    }

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    if mouse_capture {
        execute!(stdout, EnableMouseCapture)?;
    }
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    let mut app = App::new(entry, data_dir, node);
    let result = run(&mut terminal, &mut app);
    disable_raw_mode()?;
    if mouse_capture {
        execute!(terminal.backend_mut(), DisableMouseCapture)?;
    }
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    result
}

fn run<B: ratatui::backend::Backend>(terminal: &mut Terminal<B>, app: &mut App) -> io::Result<()> {
    loop {
        app.poll_pending();
        terminal.draw(|frame| render(frame, app))?;
        if !event::poll(Duration::from_millis(250))? {
            continue;
        }
        match event::read()? {
            Event::Key(key) => {
                if handle_key(app, key) {
                    return Ok(());
                }
            }
            Event::Mouse(mouse) => handle_mouse(app, mouse),
            _ => {}
        }
    }
}

fn handle_mouse(app: &mut App, mouse: MouseEvent) {
    match mouse.kind {
        MouseEventKind::ScrollUp => app.scroll_up(3),
        MouseEventKind::ScrollDown => app.scroll_down(3),
        _ => {}
    }
}

fn handle_key(app: &mut App, key: KeyEvent) -> bool {
    match key.code {
        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            shutdown_managed_tmux_runtime();
            true
        }
        KeyCode::Char(ch) => {
            app.insert(ch);
            false
        }
        KeyCode::Backspace => {
            app.backspace();
            false
        }
        KeyCode::Delete => {
            app.delete();
            false
        }
        KeyCode::Left => {
            app.move_left();
            false
        }
        KeyCode::Right => {
            app.move_right();
            false
        }
        KeyCode::Up => {
            app.history_prev();
            false
        }
        KeyCode::Down => {
            app.history_next();
            false
        }
        KeyCode::Tab => {
            app.complete_current_token();
            false
        }
        KeyCode::Enter => app.submit(),
        _ => false,
    }
}

fn render(frame: &mut ratatui::Frame<'_>, app: &App) {
    let area = frame.area();
    let input_height = dynamic_input_height(&app.input, area.width, area.height);
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(1),
            Constraint::Length(input_height),
            Constraint::Length(2),
        ])
        .split(area);

    let visible_height = chunks[0].height as usize;
    let visual_lines = visual_transcript_lines(&app.transcript, chunks[0].width.saturating_sub(1));
    let visible_lines =
        visible_transcript_window(&visual_lines, visible_height.max(1), app.scroll_offset);
    let history = visible_lines
        .iter()
        .map(|line| transcript_line(line))
        .collect::<Vec<_>>();
    let history = Paragraph::new(history)
        .style(Style::default().fg(Color::Black))
        .wrap(Wrap { trim: false });
    frame.render_widget(history, chunks[0]);

    let input_text = if app.input.is_empty() {
        Span::styled(
            INPUT_PLACEHOLDER,
            Style::default().fg(Color::DarkGray).bg(CHAT_BG),
        )
    } else {
        Span::styled(
            app.input.as_str(),
            Style::default().fg(Color::Black).bg(CHAT_BG),
        )
    };
    let input = Line::from(vec![
        Span::styled(
            PROMPT_LABEL,
            Style::default()
                .fg(TOSS_BLUE)
                .bg(CHAT_BG)
                .add_modifier(Modifier::BOLD),
        ),
        input_text,
    ]);
    let input = Paragraph::new(input)
        .wrap(Wrap { trim: false })
        .block(
            Block::default()
                .borders(Borders::TOP)
                .border_style(Style::default().fg(TOSS_BLUE)),
        )
        .style(Style::default().bg(CHAT_BG));
    let inner_input_height = chunks[1].height.saturating_sub(1).max(1);
    let (cursor_col, cursor_row) =
        input_cursor_visual_position(&app.input, app.cursor, chunks[1].width);
    let input_scroll = cursor_row.saturating_add(1).saturating_sub(inner_input_height);
    let input = input.scroll((input_scroll, 0));
    frame.render_widget(input, chunks[1]);

    let suggestions = Paragraph::new(suggestion_line(app)).style(Style::default().bg(CHAT_BG));
    frame.render_widget(suggestions, chunks[2]);

    let cursor_x = chunks[1].x + cursor_col.min(chunks[1].width.saturating_sub(1));
    let cursor_y = chunks[1].y + 1 + cursor_row.saturating_sub(input_scroll);
    frame.set_cursor_position(Position::new(cursor_x, cursor_y));
}

fn shutdown_managed_tmux_runtime() {
    if env::var("QUANTOPS_TMUX_MANAGED").ok().as_deref() != Some("1") {
        return;
    }
    let Ok(session) = env::var("QUANTOPS_TMUX_SESSION") else {
        return;
    };
    if session.trim().is_empty() {
        return;
    }
    let _ = Command::new("tmux")
        .args(["kill-session", "-t", session.trim()])
        .output();
}

fn suggestion_line(app: &App) -> Line<'static> {
    if let Some(pending) = &app.pending {
        return loading_line(&pending.command, pending.started_at.elapsed());
    }
    let matches = app.completion_matches();
    let token = active_completion_token(&app.input);
    let mut spans = vec![Span::styled(
        "search ",
        Style::default().fg(TOSS_BLUE).add_modifier(Modifier::BOLD),
    )];
    if matches.is_empty() {
        spans.push(Span::styled(
            "Tab complete",
            Style::default().fg(Color::DarkGray),
        ));
        return Line::from(spans);
    }
    spans.push(Span::styled(
        "Tab complete  ",
        Style::default().fg(Color::DarkGray),
    ));
    for (index, candidate) in matches.iter().take(6).enumerate() {
        if index > 0 {
            spans.push(Span::raw("  "));
        }
        spans.extend(highlight_candidate(candidate, &token));
    }
    Line::from(spans)
}

fn loading_line(command: &str, elapsed: Duration) -> Line<'static> {
    const FRAMES: [&str; 8] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];
    let frame = FRAMES[((elapsed.as_millis() / 125) as usize) % FRAMES.len()];
    let seconds = elapsed.as_secs_f32();
    let command = if command.chars().count() > 72 {
        let mut shortened = command.chars().take(69).collect::<String>();
        shortened.push('…');
        shortened
    } else {
        command.to_string()
    };
    Line::from(vec![
        Span::styled(
            "running ",
            Style::default().fg(TOSS_BLUE).add_modifier(Modifier::BOLD),
        ),
        Span::styled(frame.to_string(), Style::default().fg(TOSS_BLUE)),
        Span::raw("  "),
        Span::styled(
            format!("{seconds:.1}s"),
            Style::default().fg(Color::DarkGray),
        ),
        Span::raw("  "),
        Span::styled(command, Style::default().fg(Color::Black)),
    ])
}

fn active_completion_token(input: &str) -> String {
    let cursor = input.len();
    let (_, _, token) = token_bounds(input, cursor);
    token
}

fn highlight_candidate(candidate: &str, token: &str) -> Vec<Span<'static>> {
    if token.is_empty() || !candidate.starts_with(token) {
        return vec![Span::styled(
            candidate.to_string(),
            Style::default().fg(Color::Black),
        )];
    }
    let rest = candidate[token.len()..].to_string();
    vec![
        Span::styled(
            token.to_string(),
            Style::default().fg(TOSS_BLUE).add_modifier(Modifier::BOLD),
        ),
        Span::styled(rest, Style::default().fg(Color::Black)),
    ]
}

fn transcript_line(line: &str) -> Line<'static> {
    if let Some((prefix, command)) = line.split_once('❯') {
        return Line::from(vec![
            Span::styled(
                format!(" {prefix}❯ "),
                Style::default()
                    .fg(Color::Black)
                    .bg(CHAT_BG)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                command.trim_start().to_string(),
                Style::default()
                    .fg(TOSS_BLUE)
                    .bg(CHAT_BG)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(" ", Style::default().bg(CHAT_BG)),
        ]);
    }
    if line.trim().is_empty() {
        return Line::from("");
    }
    let trimmed = line.trim_start();
    if trimmed.starts_with('"') && trimmed.contains(':') {
        let indent = line.len().saturating_sub(trimmed.len());
        let (key, rest) = trimmed.split_once(':').unwrap_or((trimmed, ""));
        return Line::from(vec![
            Span::raw(" ".repeat(indent)),
            Span::styled(key.to_string(), Style::default().fg(TOSS_BLUE)),
            Span::styled(":".to_string(), Style::default().fg(Color::DarkGray)),
            Span::styled(rest.to_string(), Style::default().fg(Color::Black)),
        ]);
    }
    if line.starts_with('{')
        || line.starts_with('}')
        || line.starts_with('[')
        || line.starts_with(']')
    {
        return Line::from(Span::styled(
            line.to_string(),
            Style::default().fg(Color::DarkGray),
        ));
    }
    if line.contains("ok") || line.contains("ready") {
        return Line::from(Span::styled(
            line.to_string(),
            Style::default().fg(Color::Green),
        ));
    }
    if line.contains("error") || line.contains("failed") || line.contains("unknown") {
        return Line::from(Span::styled(
            line.to_string(),
            Style::default().fg(Color::Red),
        ));
    }
    Line::from(Span::styled(
        line.to_string(),
        Style::default().fg(Color::Black),
    ))
}

fn visual_transcript_lines(lines: &[String], width: u16) -> Vec<String> {
    let width = usize::from(width.max(1));
    let mut out = Vec::new();
    for line in lines {
        let wrapped = wrap_visual_line(line, width);
        out.extend(wrapped);
    }
    out
}

fn visible_transcript_window(lines: &[String], height: usize, scroll_offset: usize) -> &[String] {
    if lines.is_empty() {
        return lines;
    }
    let height = height.max(1);
    let clamped_offset = scroll_offset.min(lines.len().saturating_sub(1));
    let end = lines.len().saturating_sub(clamped_offset);
    let start = end.saturating_sub(height);
    &lines[start..end]
}

fn wrap_visual_line(line: &str, width: usize) -> Vec<String> {
    if line.is_empty() {
        return vec![String::new()];
    }
    let mut out = Vec::new();
    let mut current = String::new();
    let mut current_width = 0usize;
    for ch in line.chars() {
        let ch_width = char_display_width(ch);
        if current_width > 0 && current_width + ch_width > width {
            out.push(current);
            current = String::new();
            current_width = 0;
        }
        current.push(ch);
        current_width += ch_width;
    }
    out.push(current);
    out
}

#[cfg(test)]
mod tests {
    use super::{
        active_completion_token, completion_matches, completion_matches_with_data_dir,
        display_width, dynamic_input_height, input_cursor_column, input_cursor_visual_position,
        input_visual_rows, loading_line, skill_invocation_candidates_in, suggestion_line,
        transcript_line, visible_transcript_window, visual_transcript_lines, welcome_lines, App,
        INPUT_PLACEHOLDER,
    };
    use std::{env, fs, time::Duration};

    #[test]
    fn cursor_column_uses_terminal_display_width_for_korean() {
        assert_eq!(display_width("abc"), 3);
        assert_eq!(display_width("한글"), 4);
        assert_eq!(input_cursor_column("a한글", "a한글".len()), 5);
    }

    #[test]
    fn cursor_byte_offset_stays_on_utf8_boundaries_for_korean_editing() {
        let mut app = App::new("src/cli.ts".into(), "data".to_string(), "node".to_string());
        app.insert('한');
        app.insert('글');
        assert_eq!(app.cursor, "한글".len());
        app.move_left();
        assert_eq!(app.cursor, "한".len());
        app.backspace();
        assert_eq!(app.input, "글");
        assert_eq!(app.cursor, 0);
    }

    #[test]
    fn slash_commands_are_forwarded_to_the_node_entrypoint() {
        let app = App::new("src/cli.ts".into(), "data".to_string(), "node".to_string());
        assert_eq!(
            app.command_args("/collect plan AAPL"),
            vec!["collect", "plan", "AAPL"]
        );
        assert_eq!(
            app.command_args("/data download AAPL"),
            vec!["data", "download", "AAPL"]
        );
        assert_eq!(
            app.command_args("/quote history AAPL"),
            vec!["quote", "history", "AAPL"]
        );
        assert_eq!(
            app.command_args("/research AAPL"),
            vec!["research", "AAPL"]
        );
        assert_eq!(
            app.command_args("/research NVDA --topic \"NVDA earnings momentum\""),
            vec!["research", "NVDA", "--topic", "NVDA earnings momentum"]
        );
        assert_eq!(
            app.command_args("$quantops-idea-coach --lang ko"),
            vec!["codex-prompt", "$quantops-idea-coach --lang ko"]
        );
        assert_eq!(app.command_args("collect plan AAPL"), vec!["agent", "collect plan AAPL"]);
    }

    #[test]
    fn only_slash_exit_closes_the_tui() {
        let mut app = App::new("src/cli.ts".into(), "data".to_string(), "node".to_string());

        app.set_input("exit".to_string());
        assert!(!app.submit());
        assert!(app.transcript.iter().any(|line| line.contains("Use /exit")));

        app.set_input("/exit".to_string());
        assert!(app.submit());
    }

    #[test]
    fn up_and_down_arrows_recall_command_history_without_losing_draft() {
        let mut app = App::new("src/cli.ts".into(), "data".to_string(), "node".to_string());
        app.history = vec!["/status".to_string(), "/collect plan AAPL".to_string()];
        app.set_input("/quote".to_string());

        app.history_prev();
        assert_eq!(app.input, "/collect plan AAPL");
        assert_eq!(app.cursor, app.input.len());

        app.history_prev();
        assert_eq!(app.input, "/status");

        app.history_next();
        assert_eq!(app.input, "/collect plan AAPL");

        app.history_next();
        assert_eq!(app.input, "/quote");
        assert_eq!(app.history_index, None);
    }

    #[test]
    fn completion_search_filters_candidates_and_tab_fills_the_first_match() {
        assert!(completion_matches("", "quant").contains(&"/collect".to_string()));
        assert!(completion_matches("", "quant").contains(&"/data".to_string()));
        assert!(completion_matches("", "quant").contains(&"/discover".to_string()));
        assert!(completion_matches("", "quant").contains(&"/start".to_string()));
        assert!(!completion_matches("", "quant").contains(&"/find".to_string()));
        assert!(completion_matches("", "quant").contains(&"/download".to_string()));
        assert!(!completion_matches("", "quant").contains(&"/analyze".to_string()));
        assert!(completion_matches("", "quant").contains(&"/research".to_string()));
        assert!(completion_matches("", "quant").contains(&"/idea".to_string()));
        assert!(completion_matches("", "quant").contains(&"/lab".to_string()));
        assert!(completion_matches("", "quant").contains(&"/tools".to_string()));
        assert!(!completion_matches("", "quant").contains(&"/agent".to_string()));
        assert!(completion_matches("", "quant").contains(&"/skills".to_string()));
        assert!(completion_matches("", "quant").contains(&"/list".to_string()));
        assert!(completion_matches("", "quant").contains(&"/sources".to_string()));
        assert!(completion_matches("", "quant").contains(&"/symbol".to_string()));
        assert!(completion_matches("", "quant").contains(&"/stats".to_string()));
        assert!(completion_matches("", "quant").contains(&"/backtest".to_string()));
        assert!(completion_matches("", "quant").contains(&"/strategy".to_string()));
        assert!(completion_matches("", "quant").contains(&"/research".to_string()));
        assert_eq!(
            completion_matches("/co", "quant"),
            vec!["/collect".to_string(), "/codex".to_string()]
        );
        assert_eq!(
            completion_matches("/collect p", "quant"),
            vec!["plan".to_string()]
        );
        assert_eq!(
            completion_matches("/collect plan ", "quant"),
            vec!["--watchlist".to_string()]
        );
        assert_eq!(
            completion_matches("/idea ", "quant"),
            vec![
                "new".to_string(),
                "list".to_string(),
                "show".to_string(),
                "add-symbol".to_string(),
                "add-hypothesis".to_string(),
                "status".to_string()
            ]
        );
        assert_eq!(
            completion_matches("/idea status latest ", "quant"),
            vec!["--plain".to_string()]
        );
        assert_eq!(
            completion_matches("/idea status latest --", "quant"),
            vec!["--plain".to_string()]
        );
        assert_eq!(
            completion_matches("/lab ", "quant"),
            vec![
                "workflow".to_string(),
                "discuss".to_string(),
                "verify".to_string(),
                "backtest".to_string()
            ]
        );
        assert_eq!(
            completion_matches("/lab verify latest --", "quant"),
            vec!["--codex".to_string(), "--prompt".to_string(), "--no-save".to_string()]
        );
        assert_eq!(
            completion_matches("/collect plan --watchlist ", "quant"),
            Vec::<String>::new()
        );
        assert_eq!(
            completion_matches("/collect quote AAPL ", "quant"),
            Vec::<String>::new()
        );
        assert_eq!(
            completion_matches("/data ", "quant"),
            vec![
                "download".to_string(),
                "watchlist".to_string(),
                "list".to_string(),
                "info".to_string(),
                "validate".to_string(),
                "refresh".to_string()
            ]
        );
        assert!(
            completion_matches("/data download AAPL ", "quant").contains(&"--period".to_string())
        );
        assert!(
            completion_matches("/data refresh AAPL ", "quant").contains(&"--period".to_string())
        );
        assert!(
            completion_matches("/data info AAPL ", "quant").contains(&"--json".to_string())
        );
        assert!(
            completion_matches("/data validate AAPL ", "quant").contains(&"--max-stale-days".to_string())
        );
        assert!(
            completion_matches("/data watchlist ", "quant").contains(&"refresh".to_string())
        );
        assert!(completion_matches("/download NVDA ", "quant").contains(&"--period".to_string()));
        assert_eq!(
            completion_matches("/analyze NVDA ", "quant"),
            Vec::<String>::new()
        );
        assert!(completion_matches("/agent ", "quant").contains(&"ko".to_string()));
        assert!(!completion_matches("/agent ", "quant").contains(&"lang".to_string()));
        assert_eq!(
            completion_matches("/agent lang ", "quant"),
            vec!["ko".to_string(), "en".to_string(), "auto".to_string()]
        );
        assert!(completion_matches("/backtest run NVDA ", "quant").contains(&"--strategy".to_string()));
        assert_eq!(
            completion_matches("/backtest run NVDA --strategy ", "quant"),
            vec![
                "buy-hold".to_string(),
                "ma-cross".to_string(),
                "momentum".to_string(),
                "mean-reversion".to_string()
            ]
        );
        assert!(completion_matches("/research NVDA ", "quant").contains(&"--source".to_string()));
        assert_eq!(
            completion_matches("/research NVDA --", "quant"),
            vec![
                "--topic".to_string(),
                "--source".to_string(),
                "--interval".to_string(),
                "--provider-symbol".to_string(),
                "--no-save".to_string(),
                "--codex".to_string()
            ]
        );
        assert_eq!(
            completion_matches("/research NVDA --source ", "quant"),
            vec!["yahoo".to_string(), "stooq".to_string()]
        );
        assert_eq!(
            completion_matches("/research NVDA --interval ", "quant"),
            vec!["d".to_string(), "1d".to_string(), "1wk".to_string(), "1mo".to_string()]
        );
        assert_eq!(
            completion_matches("/discover ", "quant"),
            vec![
                "trending".to_string(),
                "most-active".to_string(),
                "gainers".to_string(),
                "losers".to_string(),
                "etf".to_string(),
                "semiconductor".to_string()
            ]
        );
        assert!(completion_matches("/discover trending ", "quant")
            .contains(&"--source".to_string()));
        assert_eq!(
            completion_matches("/discover trending --source ", "quant"),
            vec!["local".to_string(), "yahoo".to_string()]
        );
        assert!(completion_matches("/discover trending --source yahoo ", "quant")
            .contains(&"--download".to_string()));
        assert_eq!(
            completion_matches("/discover trending --limit ", "quant"),
            vec![
                "10".to_string(),
                "25".to_string(),
                "50".to_string(),
                "100".to_string()
            ]
        );
        assert_eq!(
            completion_matches("/sources ", "quant"),
            vec![
                "list".to_string(),
                "stooq".to_string(),
                "tossctl".to_string(),
                "yahoo".to_string(),
                "nasdaq".to_string(),
                "vendor".to_string()
            ]
        );
        assert_eq!(
            completion_matches("/symbol ", "quant"),
            vec!["search".to_string(), "info".to_string()]
        );
        assert!(completion_matches("/symbol search TSM ", "quant")
            .contains(&"--source".to_string()));
        assert_eq!(
            completion_matches("/symbol search TSM --source ", "quant"),
            vec!["local".to_string(), "yahoo".to_string()]
        );
        assert_eq!(
            completion_matches("/symbol search TSM --limit ", "quant"),
            vec![
                "5".to_string(),
                "10".to_string(),
                "25".to_string(),
                "50".to_string()
            ]
        );
        assert!(completion_matches("/research ", "quant").contains(&"AAPL".to_string()));
        assert!(completion_matches("/research AAPL ", "quant").contains(&"--topic".to_string()));
        assert!(completion_matches("/research AAPL ", "quant").contains(&"--provider-symbol".to_string()));
        assert!(completion_matches("/research AAPL ", "quant").contains(&"--codex".to_string()));
        assert!(!completion_matches("/research AAPL ", "quant").contains(&"--no-codex".to_string()));
        assert_eq!(
            completion_matches("/data list ", "quant"),
            Vec::<String>::new()
        );
        assert_eq!(
            completion_matches("/stats AAPL ", "quant"),
            Vec::<String>::new()
        );

        let mut app = App::new("src/cli.ts".into(), "data".to_string(), "node".to_string());
        app.set_input("/collect p".to_string());
        app.complete_current_token();
        assert_eq!(app.input, "/collect plan ");
        assert_eq!(app.cursor, app.input.len());
    }

    #[test]
    fn idea_completion_reads_saved_ids_from_data_dir() {
        let root = env::temp_dir().join(format!(
            "tq-tui-idea-complete-{}",
            std::process::id()
        ));
        let ideas = root.join("ideas");
        fs::create_dir_all(&ideas).unwrap();
        fs::write(
            ideas.join("idea-20260505T031500-nvda-earnings-momentum.json"),
            "{}",
        )
        .unwrap();

        let matches =
            completion_matches_with_data_dir("/idea status ", "quant", root.to_str());

        assert!(matches.contains(&"latest".to_string()));
        assert!(matches.contains(
            &"idea-20260505T031500-nvda-earnings-momentum".to_string()
        ));
        let lab_matches = completion_matches_with_data_dir("/lab verify ", "quant", root.to_str());
        assert!(lab_matches.contains(&"latest".to_string()));
        assert!(lab_matches.contains(
            &"idea-20260505T031500-nvda-earnings-momentum".to_string()
        ));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn skill_invocation_completion_reads_quant_skill_dirs() {
        let root = env::temp_dir().join(format!(
            "tq-tui-skills-complete-{}",
            std::process::id()
        ));
        let skill = root.join("quantops-idea-coach");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "---\nname: quantops-idea-coach\n---\n").unwrap();

        let matches = skill_invocation_candidates_in(&root);

        assert_eq!(matches, vec!["$quantops-idea-coach".to_string()]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn suggestion_line_highlights_the_current_matching_token() {
        let mut app = App::new("src/cli.ts".into(), "data".to_string(), "node".to_string());
        app.set_input("/co".to_string());

        let line = suggestion_line(&app);
        let rendered = line
            .spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<Vec<_>>();

        assert_eq!(active_completion_token(&app.input), "/co");
        assert!(rendered.contains(&"/co"));
        assert!(rendered.contains(&("llect")));
        assert!(rendered.contains(&("dex")));
        assert_eq!(line.spans[2].style.bg, None);
    }

    #[test]
    fn loading_line_animates_running_commands_with_elapsed_time() {
        let line = loading_line(
            "/research NVDA --topic \"NVDA earnings momentum\"",
            Duration::from_millis(375),
        );
        let rendered = line
            .spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>();

        assert!(rendered.contains("running"));
        assert!(rendered.contains("0.4s"));
        assert!(rendered.contains("/research NVDA"));
        assert_ne!(line.spans[1].content.as_ref(), "");
    }

    #[test]
    fn command_transcript_line_uses_colored_command_span() {
        let line = transcript_line("QuantOps quant ❯ /status");

        assert!(line.spans.len() >= 2);
        assert_eq!(line.spans[1].content.as_ref(), "/status");
    }

    #[test]
    fn visual_transcript_lines_wraps_by_terminal_width_for_auto_scroll() {
        let lines = vec!["abcdef".to_string(), "한글abcd".to_string()];
        let visual = visual_transcript_lines(&lines, 4);

        assert_eq!(visual, vec!["abcd", "ef", "한글", "abcd"]);
    }

    #[test]
    fn long_input_expands_and_keeps_cursor_visible_after_wrapping() {
        let input = "/lab backtest latest --prompt ".repeat(4);

        assert!(input_visual_rows(&input, 24) > 3);
        assert!(dynamic_input_height(&input, 24, 20) > 3);

        let (col, row) = input_cursor_visual_position(&input, input.len(), 24);
        assert!(row > 0);
        assert!(col < 24);
    }

    #[test]
    fn dynamic_input_height_preserves_history_space_on_small_terminals() {
        let input = "x".repeat(500);

        assert_eq!(dynamic_input_height(&input, 10, 6), 3);
        assert_eq!(dynamic_input_height(&input, 10, 4), 1);
    }

    #[test]
    fn visible_transcript_window_respects_mouse_scroll_offset() {
        let lines = vec![
            "1".to_string(),
            "2".to_string(),
            "3".to_string(),
            "4".to_string(),
            "5".to_string(),
            "6".to_string(),
        ];

        assert_eq!(visible_transcript_window(&lines, 3, 0), &lines[3..6]);
        assert_eq!(visible_transcript_window(&lines, 3, 2), &lines[1..4]);
        assert_eq!(visible_transcript_window(&lines, 3, 99), &lines[0..1]);
    }

    #[test]
    fn mouse_scroll_offset_moves_history_and_new_output_returns_to_bottom() {
        let mut app = App::new("src/cli.ts".into(), "data".to_string(), "node".to_string());

        app.scroll_up(6);
        assert_eq!(app.scroll_offset, 6);

        app.scroll_down(3);
        assert_eq!(app.scroll_offset, 3);

        app.append_exchange("/status", "ok");
        assert_eq!(app.scroll_offset, 0);
    }

    #[test]
    fn empty_input_placeholder_is_display_only() {
        let app = App::new("src/cli.ts".into(), "data".to_string(), "node".to_string());

        assert!(app.input.is_empty());
        assert_eq!(INPUT_PLACEHOLDER, "자연어로 입력하세요. 예: NVDA 실적 모멘텀 검증");
        assert_eq!(input_cursor_column(&app.input, app.cursor), 0);
    }

    #[test]
    fn exchanges_keep_command_and_result_together_without_resetting_transcript() {
        let mut app = App::new("src/cli.ts".into(), "data".to_string(), "node".to_string());
        let original_len = app.transcript.len();

        app.append_exchange("/data list", "{\"ok\":true}");

        assert!(app.transcript.len() > original_len);
        assert!(app
            .transcript
            .contains(&"QuantOps quant ❯ /data list".to_string()));
        assert!(app.transcript.contains(&"{\"ok\":true}".to_string()));
    }

    #[test]
    fn welcome_explains_project_commands_flow_and_keys() {
        let lines = welcome_lines("quant");
        let text = lines.join("\n");
        assert!(text.contains("QuantOps-cli"));
        assert!(text.contains("/start"));
        assert!(text.contains("그냥 입력"));
        assert!(!text.contains("/find"));
        assert!(text.contains("/download <SYMBOL>"));
        assert!(text.contains("/stats <SYMBOL>"));
        assert!(text.contains("/backtest run latest"));
        assert!(text.contains("/research <SYMBOL>"));
        assert!(text.contains("/idea"));
        assert!(text.contains("Tab completes"));
        assert!(text.contains("/strategy list"));
    }
}
