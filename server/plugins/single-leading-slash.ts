/**
 * A path that starts with "//" reaches Nitro's static handler, which reads it as protocol-relative
 * and serves the prerendered home page without its security headers (commerce-storefront#2 D-29).
 * Such requests are redirected to the same path with one leading slash. Every leading slash and
 * backslash is stripped first, because browsers read a redirect to "//host" or "/\host" as another
 * site.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("request", async (event) => {
    if (!/^\/[/\\]/.test(event.path)) return;
    await sendRedirect(event, `/${event.path.replace(/^[/\\]+/, "")}`, 301);
  });
});
