/**
 * Early boot: enforce HTTPS / secure context for mic+camera tunnels (ngrok).
 */
import NetworkClient from "./utilities/NetworkClient.js";

NetworkClient.checkHardwareSecurity();

// Soft hint on ngrok free hosts — first navigation may still show interstitial once
if (NetworkClient.isNgrokHost() && window.location.protocol === "http:") {
  const httpsUrl = `https://${window.location.host}${window.location.pathname}${window.location.search}`;
  NetworkClient.showHardwareSecurityBanner(
    `Switch to the HTTPS tunnel: <a href="${httpsUrl}">${httpsUrl}</a>`
  );
}
