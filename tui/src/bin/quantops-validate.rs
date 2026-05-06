use quantops_core::data_validate::run;
use quantops_core::market_data::json_string;

fn main() {
    match run() {
        Ok(text) => println!("{text}"),
        Err(error) => {
            println!("{{\"ok\":false,\"error\":{}}}", json_string(&error));
            std::process::exit(1);
        }
    }
}
