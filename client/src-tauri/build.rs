fn main() {
  // keystore.rs reads this at compile time (option_env!) to decide whether the
  // plaintext key fallback may ever be dropped. Rebuild when it changes.
  println!("cargo:rerun-if-env-changed=WIRED_SIGNED_RELEASE");
  tauri_build::build()
}
