CREATE TABLE IF NOT EXISTS signals (
  id SERIAL PRIMARY KEY,
  token_address VARCHAR(44) NOT NULL,
  source_channel VARCHAR(100),
  raw_message TEXT,
  received_at TIMESTAMP DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'pending',
  security_scores JSONB,
  rejection_reason TEXT
);

CREATE TABLE IF NOT EXISTS positions (
  id SERIAL PRIMARY KEY,
  token_address VARCHAR(44) NOT NULL,
  entry_price DECIMAL(20, 10),
  entry_amount DECIMAL(30, 10),
  entry_tx_hash VARCHAR(128),
  highest_price DECIMAL(20, 10),
  status VARCHAR(20) DEFAULT 'open',
  created_at TIMESTAMP DEFAULT NOW(),
  closed_at TIMESTAMP,
  exit_price DECIMAL(20, 10),
  exit_tx_hash VARCHAR(128),
  exit_reason TEXT,
  pnl_usd DECIMAL(10, 2),
  multiplier DECIMAL(8, 2),
  partial_tp_taken BOOLEAN DEFAULT false,
  trailing_stop_percentage DECIMAL(5, 2),
  avg_volume DECIMAL(30, 10),
  peak_holders INTEGER,
  risk_confluences JSONB
);

CREATE TABLE IF NOT EXISTS decision_logs (
  id SERIAL PRIMARY KEY,
  position_id INTEGER REFERENCES positions(id),
  timestamp TIMESTAMP DEFAULT NOW(),
  decision_type VARCHAR(50),
  reason TEXT,
  metrics_snapshot JSONB,
  ai_analysis TEXT,
  source VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS system_state (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT NOW(),
  daily_pnl DECIMAL(10, 2),
  consecutive_losses INTEGER,
  open_positions_count INTEGER,
  circuit_breaker_active BOOLEAN DEFAULT false,
  api_failures_today INTEGER,
  trades_executed_today INTEGER
);

CREATE TABLE IF NOT EXISTS signal_queue (
  id SERIAL PRIMARY KEY,
  token_address VARCHAR(44) NOT NULL,
  source_channel VARCHAR(100),
  raw_message TEXT,
  priority INTEGER DEFAULT 100,
  status VARCHAR(20) DEFAULT 'queued',
  created_at TIMESTAMP DEFAULT NOW(),
  claimed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trade_features (
  id SERIAL PRIMARY KEY,
  position_id INTEGER REFERENCES positions(id),
  signal_id INTEGER REFERENCES signals(id),
  token_address VARCHAR(44) NOT NULL,
  captured_at TIMESTAMP DEFAULT NOW(),
  source_channel VARCHAR(100),
  feature_version VARCHAR(20) DEFAULT 'v1.1',
  security_score JSONB,
  market_snapshot JSONB,
  risk_snapshot JSONB,
  pattern_key VARCHAR(255),
  entry_decision VARCHAR(30),
  entry_reason TEXT
);

CREATE TABLE IF NOT EXISTS trade_outcomes (
  id SERIAL PRIMARY KEY,
  position_id INTEGER REFERENCES positions(id),
  token_address VARCHAR(44) NOT NULL,
  closed_at TIMESTAMP DEFAULT NOW(),
  hold_time_seconds INTEGER,
  entry_price DECIMAL(20, 10),
  exit_price DECIMAL(20, 10),
  max_multiplier DECIMAL(8, 2),
  final_multiplier DECIMAL(8, 2),
  pnl_usd DECIMAL(10, 2),
  exit_reason TEXT,
  was_winner BOOLEAN,
  outcome_label VARCHAR(30)
);

CREATE TABLE IF NOT EXISTS learning_patterns (
  pattern_key VARCHAR(255) PRIMARY KEY,
  feature_version VARCHAR(20) DEFAULT 'v1.1',
  sample_count INTEGER DEFAULT 0,
  win_count INTEGER DEFAULT 0,
  loss_count INTEGER DEFAULT 0,
  total_pnl_usd DECIMAL(12, 2) DEFAULT 0,
  avg_pnl_usd DECIMAL(12, 4) DEFAULT 0,
  avg_max_multiplier DECIMAL(8, 4) DEFAULT 0,
  last_outcome_label VARCHAR(30),
  confidence_score DECIMAL(8, 4) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE signals ADD COLUMN IF NOT EXISTS raw_message TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS avg_volume DECIMAL(30, 10);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS peak_holders INTEGER;

CREATE INDEX IF NOT EXISTS idx_signals_token ON signals(token_address);
CREATE INDEX IF NOT EXISTS idx_signals_received_at ON signals(received_at);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_token ON positions(token_address);
CREATE INDEX IF NOT EXISTS idx_positions_created_at ON positions(created_at);
CREATE INDEX IF NOT EXISTS idx_decision_logs_position ON decision_logs(position_id);
CREATE INDEX IF NOT EXISTS idx_signal_queue_status_created ON signal_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_trade_features_position ON trade_features(position_id);
CREATE INDEX IF NOT EXISTS idx_trade_features_pattern ON trade_features(pattern_key);
CREATE INDEX IF NOT EXISTS idx_trade_outcomes_position ON trade_outcomes(position_id);
CREATE INDEX IF NOT EXISTS idx_trade_outcomes_token ON trade_outcomes(token_address);
