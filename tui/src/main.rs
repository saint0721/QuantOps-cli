use std::env;
use std::io;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

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
const CHAT_BG: Color = Color::Rgb(250, 238, 238);
const PROMPT_LABEL: &str = " ❯ ";
const INPUT_PLACEHOLDER: &str = "명령어를 입력하세요. 예: /data list";
const ROOT_COMMANDS: &[&str] = &[
    "/status",
    "/collect",
    "/data",
    "/stats",
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
        if line == "/exit" {
            shutdown_managed_tmux_runtime();
            return true;
        }
        if matches!(line.as_str(), "exit" | "/quit" | "quit" | "/:q" | ":q") {
            self.append_exchange(
                &line,
                "Use /exit to close TossQuant and its managed tmux session.",
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
        let output = self.run_line(&line);
        self.append_exchange(&line, &output);
        false
    }

    fn scroll_up(&mut self, amount: usize) {
        self.scroll_offset = self.scroll_offset.saturating_add(amount);
    }

    fn scroll_down(&mut self, amount: usize) {
        self.scroll_offset = self.scroll_offset.saturating_sub(amount);
    }

    fn append_exchange(&mut self, command: &str, output: &str) {
        self.scroll_offset = 0;
        if self.transcript.last().is_some_and(|line| !line.is_empty()) {
            self.transcript.push(String::new());
        }
        self.transcript
            .push(format!("TossQuant {} ❯ {command}", self.mode));
        let cleaned = output.trim();
        if cleaned.is_empty() {
            self.transcript.push("done".to_string());
        } else {
            self.transcript
                .extend(cleaned.lines().map(|line| line.to_string()));
        }
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
        "flow     /watchlist add AAPL → /data download AAPL → /stats AAPL → /classify AAPL".to_string(),
        "commands /status · /collect plan|quote|watchlist · /data download|watchlist|list · /stats <SYMBOL>".to_string(),
        "tools    /runtime line · /hud · /ask <question> · /codex · /quant · /exit".to_string(),
        "keys     Tab completes from the search row · ↑/↓ history · ←/→ move cursor".to_string(),
        "".to_string(),
        "try      /collect plan AAPL".to_string(),
    ]
}

fn split_args(line: &str) -> Vec<String> {
    line.split_whitespace().map(str::to_string).collect()
}

fn command_candidates(
    command: &str,
    parts: &[&str],
    trailing_space: bool,
) -> &'static [&'static str] {
    match command {
        "/collect" => collect_candidates(parts, trailing_space),
        "/data" => one_level_candidates(parts, trailing_space, &["download", "watchlist", "list"]),
        "/stats" => &[],
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
        command_candidates(command, &parts, trimmed.ends_with(' '))
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
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    let mut app = App::new(entry, data_dir, node);
    let result = run(&mut terminal, &mut app);
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        DisableMouseCapture,
        LeaveAlternateScreen
    )?;
    terminal.show_cursor()?;
    result
}

fn run<B: ratatui::backend::Backend>(terminal: &mut Terminal<B>, app: &mut App) -> io::Result<()> {
    loop {
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
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(1),
            Constraint::Length(3),
            Constraint::Length(2),
        ])
        .split(frame.area());

    let visible_height = chunks[0].height.saturating_sub(1) as usize;
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
        .block(
            Block::default()
                .borders(Borders::TOP)
                .border_style(Style::default().fg(TOSS_BLUE)),
        )
        .style(Style::default().bg(CHAT_BG));
    frame.render_widget(input, chunks[1]);

    let suggestions = Paragraph::new(suggestion_line(app)).style(Style::default().bg(CHAT_BG));
    frame.render_widget(suggestions, chunks[2]);

    let cursor_x =
        chunks[1].x + display_width(PROMPT_LABEL) + input_cursor_column(&app.input, app.cursor);
    let cursor_y = chunks[1].y + 1;
    frame.set_cursor_position(Position::new(cursor_x, cursor_y));
}

fn shutdown_managed_tmux_runtime() {
    if env::var("TOSSQUANT_TMUX_MANAGED").ok().as_deref() != Some("1") {
        return;
    }
    let Ok(session) = env::var("TOSSQUANT_TMUX_SESSION") else {
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
        active_completion_token, completion_matches, display_width, input_cursor_column,
        suggestion_line, transcript_line, visible_transcript_window, visual_transcript_lines,
        welcome_lines, App, INPUT_PLACEHOLDER,
    };

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
        assert_eq!(app.command_args("collect plan AAPL"), Vec::<String>::new());
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
        assert!(completion_matches("", "quant").contains(&"/stats".to_string()));
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
                "list".to_string()
            ]
        );
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
    fn command_transcript_line_uses_colored_command_span() {
        let line = transcript_line("TossQuant quant ❯ /status");

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
        assert_eq!(INPUT_PLACEHOLDER, "명령어를 입력하세요. 예: /data list");
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
            .contains(&"TossQuant quant ❯ /data list".to_string()));
        assert!(app.transcript.contains(&"{\"ok\":true}".to_string()));
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
