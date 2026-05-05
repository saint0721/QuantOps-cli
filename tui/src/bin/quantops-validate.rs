use quantops_tui::data_validate::run;
use quantops_tui::market_data::json_string;

fn main() {
    match run() {
        Ok(text) => println!("{text}"),
        Err(error) => {
            println!("{{\"ok\":false,\"error\":{}}}", json_string(&error));
            std::process::exit(1);
        }
    }
}
