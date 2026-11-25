// Sin consola en Windows en la versión final.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lafe_tool_lib::run()
}
