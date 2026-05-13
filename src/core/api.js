export async function apiCallWithRetry(url, options = {}, settings = {}) {
  const maxRetries = settings.maxRetries ?? 3;
  const timeoutMs = settings.timeoutMs ?? 800;

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
      if (attempt === maxRetries - 1) {
        throw error;
      }

      await delay(2 ** attempt * 100);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
