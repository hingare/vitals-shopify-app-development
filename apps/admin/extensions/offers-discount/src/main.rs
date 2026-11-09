use std::process;
pub mod cart_lines_discounts_generate_run;
pub mod offers;

fn main() {
    eprintln!("Please invoke a named export.");
    process::exit(1);
}
