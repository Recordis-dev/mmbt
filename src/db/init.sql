-- Trench Predator v1.1 Schema
CREATE TABLE IF NOT EXISTS signals (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(44) NOT NULL,
    source_channel VARCHAR(100),
    received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20),
    security_scores JSONB,
    raw_message TEXT
);

CREATE TABLE IF NOT EXISTS positions (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(44) NOT NULL,
    entry_price DECIMAL(36, 18),
    entry_amount_sol DECIMAL(20, 10),
    entry_tx_hash VARCHAR(88),
    status VARCHAR(20) DEFAULT 'open',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
