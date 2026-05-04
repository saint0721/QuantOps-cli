use std::env;
use std::io;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyModifiers};
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
const CHAT_BG: Color = Color::Rgb(245, 247, 250);
const PROMPT_LABEL: &str = " ❯ ";
const ROOT_COMMANDS: &[&str] = &[
    "/status",
    "/collect",
    "/quote",
    "/history",
    "/classify",
    "/portfolio",
    "/order",
    "/brief",
    "/watchlist",
    "/hud",
    "/runtime",
    "/ask",
    "/codex",
    "/quant",
    "/exit",
    "/quit",
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
        completion_matches(&self.input, &self.mode)
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
        if matches!(line.as_str(), "/exit" | "exit" | "/quit" | "quit" | "/:q" | ":q") {
            return true;
        }
        if line == "/codex" {
            self.mode = "codex".to_string();
            self.transcript.push("mode   codex".to_string());
            return false;
        }
        if line == "/quant" {
            self.mode = "quant".to_string();
            self.transcript = welcome_lines("quant");
            return false;
        }
        let output = self.run_line(&line);
        if output.trim().is_empty() {
            return false;
        }
        self.transcript
            .extend(output.lines().map(|line| line.to_string()));
        false
    }

    fn run_line(&self, line: &str) -> String {
        let args = self.command_args(line);
        if args.is_empty() {
            return "slash commands only: try /status, /watchlist add AAPL, /collect plan AAPL, /quote history AAPL, or /exit"
                .to_string();
        }
        let output = Command::new(&self.node)
            .arg(&self.entry)
            .arg("--no-tmux")
            .arg("--data-dir")
            .arg(&self.data_dir)
            .args(args)
            .output();
        match output {
            Ok(output) => {
                let mut text = String::new();
                text.push_str(&String::from_utf8_lossy(&output.stdout));
                text.push_str(&String::from_utf8_lossy(&output.stderr));
                let cleaned = strip_ansi(&text).trim().to_string();
                if output.status.code() == Some(2) && cleaned.contains("unknown command:") {
                    "unknown slash command: try /status, /watchlist add AAPL, /collect plan AAPL, /quote history AAPL, or /exit"
                        .to_string()
                } else {
                    cleaned
                }
            }
            Err(error) => format!("failed to run command: {error}"),
        }
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
        if let Some(prompt) = line.strip_prefix("/ask ") {
            return vec!["ask".to_string(), prompt.to_string()];
        }
        if let Some(command) = line.strip_prefix('/') {
            return split_args(command);
        }
        if self.mode == "codex" {
            return vec!["ask".to_string(), line.to_string()];
        }
        Vec::new()
    }
}

fn welcome_lines(mode: &str) -> Vec<String> {
    vec![
        " _____              ____                  _   ".to_string(),
        "|_   _|__  ___ ___ / ___| _   _  __ _ _ __ | |_ ".to_string(),
        "  | |/ _ \\/ __/ __| |  _| | | |/ _` | '_ \\| __|".to_string(),
        "  | | (_) \\__ \\__ \\ |_| | |_| | (_| | | | | |_ ".to_string(),
        "  |_|\\___/|___/___/\\____|\\__,_|\\__,_|_| |_|\\__|".to_string(),
        "".to_string(),
        format!("TossQuant@{mode}"),
        "project  TossQuant-cli — terminal-first quant runtime around tossctl".to_string(),
        "runtime  TypeScript CLI + Rust TUI + tmux HUD when available".to_string(),
        "safety   read-only data by default · trading mutations disabled".to_string(),
        "".to_string(),
        "flow     /watchlist add AAPL → /collect quote AAPL → /history AAPL → /classify AAPL".to_string(),
        "commands /status · /collect plan|quote|watchlist · /quote fetch|history · /watchlist list|fetch".to_string(),
        "tools    /runtime line · /hud · /ask <question> · /codex · /quant · /exit".to_string(),
        "keys     Tab completes from the search row · ↑/↓ history · ←/→ move cursor".to_string(),
        "".to_string(),
        "try      /collect plan AAPL".to_string(),
    ]
}

fn split_args(line: &str) -> Vec<String> {
    line.split_whitespace().map(str::to_string).collect()
}

fn command_candidates(command: &str, previous: Option<&str>) -> &'static [&'static str] {
    match command {
        "/collect" => {
            if previous == Some("plan") {
                &["--watchlist"]
            } else {
                &["plan", "quote", "watchlist"]
            }
        }
        "/quote" => &["fetch", "history"],
        "/watchlist" => &["add", "fetch", "list", "remove"],
        "/runtime" => &["line", "snapshot"],
        "/hud" => &["tmux"],
        "/portfolio" => &["snapshot"],
        "/order" => &["preview"],
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

fn completion_matches(input: &str, mode: &str) -> Vec<String> {
    if mode == "codex" && !input.starts_with('/') {
        return ROOT_COMMANDS.iter().map(|item| item.to_string()).collect();
    }
    let trimmed = input.trim_start();
    if trimmed.is_empty() {
        return ROOT_COMMANDS.iter().map(|item| item.to_string()).collect();
    }
    let cursor = input.len();
    let (_, _, token) = token_bounds(input, cursor);
    let parts = trimmed.split_whitespace().collect::<Vec<_>>();
    let candidates = if parts.len() <= 1 && !trimmed.ends_with(' ') {
        ROOT_COMMANDS
    } else {
        let command = parts.first().copied().unwrap_or("");
        let previous = if trimmed.ends_with(' ') {
            parts.last().copied()
        } else if parts.len() >= 2 {
            parts.get(parts.len() - 2).copied()
        } else {
            None
        };
        command_candidates(command, previous)
    };
    candidates
        .iter()
        .filter(|candidate| token.is_empty() || candidate.starts_with(&token))
        .map(|candidate| candidate.to_string())
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

fn input_cursor_column(input: &str, cursor: usize) -> u16 {
    display_width(&input[..cursor])
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
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--entry" => {
                entry = PathBuf::from(args.next().unwrap_or_else(|| "src/cli.ts".to_string()))
            }
            "--data-dir" => data_dir = args.next().unwrap_or_else(|| "data".to_string()),
            "--node" => node = args.next().unwrap_or_else(|| "node".to_string()),
            _ => {}
        }
    }

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    let mut app = App::new(entry, data_dir, node);
    let result = run(&mut terminal, &mut app);
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    result
}

fn run<B: ratatui::backend::Backend>(terminal: &mut Terminal<B>, app: &mut App) -> io::Result<()> {
    loop {
        terminal.draw(|frame| render(frame, app))?;
        if !event::poll(Duration::from_millis(250))? {
            continue;
        }
        if let Event::Key(key) = event::read()? {
            if handle_key(app, key) {
                return Ok(());
            }
        }
    }
}

fn handle_key(app: &mut App, key: KeyEvent) -> bool {
    match key.code {
        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => true,
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
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(1), Constraint::Length(3), Constraint::Length(2)])
        .split(frame.area());

    let history = app
        .transcript
        .iter()
        .map(|line| Line::from(line.clone()))
        .collect::<Vec<_>>();
    let history = Paragraph::new(history)
        .style(Style::default().fg(Color::Black))
        .wrap(Wrap { trim: false });
    frame.render_widget(history, chunks[0]);

    let input = Line::from(vec![
        Span::styled(
            PROMPT_LABEL,
            Style::default()
                .fg(TOSS_BLUE)
                .bg(CHAT_BG)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            app.input.as_str(),
            Style::default().fg(Color::Black).bg(CHAT_BG),
        ),
    ]);
    let input = Paragraph::new(input)
        .block(
            Block::default()
                .borders(Borders::TOP)
                .border_style(Style::default().fg(TOSS_BLUE)),
        )
        .style(Style::default().bg(CHAT_BG));
    frame.render_widget(input, chunks[1]);

    let matches = app.completion_matches();
    let suggestion_text = if matches.is_empty() {
        "Tab complete".to_string()
    } else {
        format!(
            "Tab complete  {}",
            matches
                .iter()
                .take(6)
                .map(String::as_str)
                .collect::<Vec<_>>()
                .join("  ")
        )
    };
    let suggestions = Paragraph::new(Line::from(vec![
        Span::styled("search ", Style::default().fg(TOSS_BLUE).add_modifier(Modifier::BOLD)),
        Span::styled(suggestion_text, Style::default().fg(Color::Black)),
    ]))
    .style(Style::default().bg(CHAT_BG));
    frame.render_widget(suggestions, chunks[2]);

    let cursor_x = chunks[1].x + display_width(PROMPT_LABEL) + input_cursor_column(&app.input, app.cursor);
    let cursor_y = chunks[1].y + 1;
    frame.set_cursor_position(Position::new(cursor_x, cursor_y));
}

#[cfg(test)]
mod tests {
    use super::{completion_matches, display_width, input_cursor_column, welcome_lines, App};

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
        assert_eq!(app.command_args("/collect plan AAPL"), vec!["collect", "plan", "AAPL"]);
        assert_eq!(app.command_args("/quote history AAPL"), vec!["quote", "history", "AAPL"]);
        assert_eq!(app.command_args("collect plan AAPL"), Vec::<String>::new());
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
        assert_eq!(completion_matches("/co", "quant"), vec!["/collect".to_string(), "/codex".to_string()]);
        assert_eq!(completion_matches("/collect p", "quant"), vec!["plan".to_string()]);
        assert_eq!(completion_matches("/collect plan ", "quant"), vec!["--watchlist".to_string()]);

        let mut app = App::new("src/cli.ts".into(), "data".to_string(), "node".to_string());
        app.set_input("/collect p".to_string());
        app.complete_current_token();
        assert_eq!(app.input, "/collect plan ");
        assert_eq!(app.cursor, app.input.len());
    }

    #[test]
    fn welcome_explains_project_commands_flow_and_keys() {
        let lines = welcome_lines("quant");
        let text = lines.join("\n");
        assert!(text.contains("TossQuant-cli"));
        assert!(text.contains("/collect plan|quote|watchlist"));
        assert!(text.contains("Tab completes"));
        assert!(text.contains("/collect plan AAPL"));
    }
}
