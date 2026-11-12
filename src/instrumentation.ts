/** Runs once when the server starts: begins the background alert watcher (Node runtime only). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWatcher } = await import("./lib/alerts");
    startWatcher();
  }
}
