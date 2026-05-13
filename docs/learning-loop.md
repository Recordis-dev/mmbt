# Learning Loop

The bot should learn by recording evidence, not by freely changing strategy after one trade.

## What Gets Saved

Before entry, save a row in `trade_features`:

- Token address and source channel.
- Security pass/fail snapshot.
- Market snapshot: liquidity, 5 minute volume, holder count, top 10 concentration, buy/sell pressure and token age.
- Risk snapshot from the local or Claude engine.
- `pattern_key`, a bucketed representation of the setup.
- Entry decision and reason.

After exit, save a row in `trade_outcomes`:

- Entry and exit price.
- Hold time.
- Max multiplier reached.
- Final multiplier.
- PnL.
- Exit reason.
- Outcome label: `moonshot`, `winner`, `loser`, `hard_loss` or `flat`.

Then update `learning_patterns`, which stores aggregate stats per `pattern_key`.

## How The Bot Uses Learning

Use `11-learning-admission-filter.js` after `09-capture-learning-features.js` and before `05-jupiter-buy.js`.

Recommended behavior:

- Fewer than 5 samples: do not trust the pattern yet.
- Negative confidence: reduce position size by 50%.
- Strong positive confidence: allow normal position size.
- Never increase max risk automatically.

## Safe Rule

The learning layer is allowed to say:

```text
trade smaller
skip
keep normal size
```

It should not be allowed to say:

```text
ignore circuit breaker
ignore security checks
increase max daily loss
increase wallet exposure
```

That keeps learning useful without letting it become reckless.
