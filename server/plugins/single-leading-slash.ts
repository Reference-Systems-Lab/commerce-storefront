/**
 * A path that starts with "//" reaches Nitro's static handler, which reads it as protocol-relative
 * and serves the prerendered home page without its security headers (commerce-storefront#2 D-29).
 * A path with a dot segment ("/./products", "/%2e/products", "/x/../products") skips the route
 * rules, which match the clean path, and gets a 404 with only some of the headers (#19). Both are
 * redirected to the path a browser would resolve them to.
 *
 * The target is parsed the way a browser will parse the redirect, because browsers drop tabs and
 * newlines, read "\" as "/" and resolve "." and ".." segments, "%2e" included: "//%09/evil.example"
 * or "/x/..//evil.example" would otherwise send them to evil.example. Only a path on this site is
 * ever sent; anything else goes to "/".
 */
import { sendRedirect } from "h3";
import { defineNitroPlugin } from "nitropack/runtime";

const SITE = "http://storefront.invalid";
const LEADING_SLASHES = /^\/[/\\]/;
// A whole segment of ".", "..", or the same with "%2e" in any case. ".well-known" is not one.
const DOT_SEGMENT = /(?:^|[/\\])(?:\.|%2e){1,2}(?=[/\\]|$)/i;

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("request", async (event) => {
    const path = event.path.split("?", 1)[0] ?? "";
    if (!LEADING_SLASHES.test(path) && !DOT_SEGMENT.test(path)) return;
    const url = new URL(`/${event.path.replace(/^[/\\]+/, "")}`, SITE);
    const onSite = url.origin === SITE && !LEADING_SLASHES.test(url.pathname);
    await sendRedirect(event, onSite ? `${url.pathname}${url.search}` : "/", 301);
  });
});
