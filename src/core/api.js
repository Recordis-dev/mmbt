export async function apiCallWithRetry(url, options = {}, settings = {}) {
  const maxRetries = Math.max(1, Number(settings.maxRetries ?? 3));
  const timeoutMs = Number(settings.timeoutMs ?? 800);
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        await delay(2 ** attempt * 100);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
