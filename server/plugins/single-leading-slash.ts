/**
 * A path that starts with "//" reaches Nitro's static handler, which reads it as protocol-relative
 * and serves the prerendered home page without its security headers (commerce-storefront#2 D-29).
 * Such requests are redirected to the same path with one leading slash.
 *
 * The target is parsed the way a browser will parse the redirect, because browsers drop tabs and
 * newlines and read "\" as "/": "//%09/evil.example" would otherwise send them to evil.example. Only
 * a path on this site is ever sent; anything else goes to "/".
 */
import { sendRedirect } from "h3";
import { defineNitroPlugin } from "nitropack/runtime";

const SITE = "http://storefront.invalid";

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("request", async (event) => {
    if (!/^\/[/\\]/.test(event.path)) return;
    const url = new URL(`/${event.path.replace(/^[/\\]+/, "")}`, SITE);
    const onSite = url.origin === SITE && !/^\/[/\\]/.test(url.pathname);
    await sendRedirect(event, onSite ? `${url.pathname}${url.search}` : "/", 301);
  });
});
