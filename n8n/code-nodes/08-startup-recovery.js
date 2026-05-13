const openPositions = await db.query(
  "SELECT * FROM positions WHERE status = $1 ORDER BY created_at ASC",
  ["open"]
);

const recovered = [];
const expired = [];
const now = Date.now();

for (const position of openPositions.rows) {
  const createdAt = new Date(position.created_at).getTime();
  const ageMs = now - createdAt;

  if (ageMs > 45 * 60 * 1000) {
    await db.query(
      "UPDATE positions SET status = $1, closed_at = NOW(), exit_reason = $2 WHERE id = $3",
      ["timeout", "timeout_recovery", position.id]
    );
    expired.push(position.id);
    continue;
  }

  recovered.push(position.id);
}

await redis.set("trench:open_positions", String(recovered.length));

return [{
  json: {
    recovered: recovered.length,
    expired: expired.length,
    recoveredPositionIds: recovered,
    expiredPositionIds: expired
  }
}];
