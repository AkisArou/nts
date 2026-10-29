//! Replay an explicit dependency build request without invoking the frontend.
fn main() -> anyhow::Result<()> {
    let request = std::env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("request JSON required"))?;
    let request = serde_json::from_slice(&std::fs::read(request)?)?;
    let artifacts = nts_build::node_deps::ensure(&request)?;
    println!("{}", serde_json::to_string_pretty(&artifacts)?);
    Ok(())
}
