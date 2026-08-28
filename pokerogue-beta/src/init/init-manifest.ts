import { initializeManifest } from "#app/global-manifest";

try {
  const response = await fetch("/manifest.json");
  if (!response.ok) {
    throw new Error(`Manifest request failed with ${response.status}`);
  }
  const manifest = await response.json();
  initializeManifest(manifest["manifest"]);
} catch (err) {
  // Manifest not found (likely local build or path error on live)
  // TODO: Do we want actual error handling here?
  console.log("Manifest not found:", err);
}
