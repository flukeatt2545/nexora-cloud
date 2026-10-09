-- Add points column to users table if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS points NUMERIC(10, 2) NOT NULL DEFAULT 0;

-- Top-up transactions via SlipVerify
CREATE TABLE IF NOT EXISTS topup_transactions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) NOT NULL,
    slip_payload JSONB,
    status VARCHAR(50) NOT NULL DEFAULT 'completed', -- 'completed', 'failed', 'pending'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Product categories
CREATE TABLE IF NOT EXISTS product_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    is_visible BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Products linked to files
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES product_categories(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT -1, -- -1 for unlimited
    is_recommended BOOLEAN NOT NULL DEFAULT false,
    is_popular BOOLEAN NOT NULL DEFAULT false,
    is_sold_out BOOLEAN NOT NULL DEFAULT false,
    is_visible BOOLEAN NOT NULL DEFAULT true,
    cover_image_url TEXT,
    file_key TEXT NOT NULL, -- S3 object key or reference to uploaded file
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User purchases / entitlements
CREATE TABLE IF NOT EXISTS purchases (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    price_paid NUMERIC(10, 2) NOT NULL,
    purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchases_user_product ON purchases(user_id, product_id);
