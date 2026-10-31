// The image's health check. There's no shell, so Node asks for / itself. The home page is
// prerendered, so this never depends on the backend (D-11).
const port = process.env.NITRO_PORT ?? "3000";
try {
  const response = await fetch(`http://127.0.0.1:${port}/`, {
    redirect: "manual",
    signal: AbortSignal.timeout(3000),
  });
  process.exit(response.status === 200 ? 0 : 1);
} catch {
  process.exit(1);
}
