package main

import (
	"context"
	"database/sql"
	"sync"
	"time"
)

// Sizes of the tenant MySQL databases for the admin databases page.
//
// Summing information_schema.tables used to open a new MySQL connection on every page load
// and walk every table, about 330 of them in MySQL's own system schemas. That took 0.2–0.8 s.
// Now the query skips the system schemas (0.04–0.08 s), shares one small connection pool,
// and the result is cached for a minute. When MySQL is slow or down, the page still loads
// with the last known sizes instead of waiting on it.

const tenantSizeCacheTTL = time.Minute

var (
	tenantPoolOnce sync.Once
	tenantPool     *sql.DB

	tenantSizeMu    sync.Mutex
	tenantSizeCache map[string]int64
	tenantSizeAt    time.Time
)

func (s *server) tenantMySQLPool() *sql.DB {
	tenantPoolOnce.Do(func() {
		pool, err := sql.Open("mysql", s.cfg.tenantMySQLDSN)
		if err != nil {
			return
		}
		pool.SetMaxOpenConns(4)
		pool.SetMaxIdleConns(2)
		pool.SetConnMaxIdleTime(5 * time.Minute)
		tenantPool = pool
	})
	return tenantPool
}

// tenantDatabaseSizes returns bytes used per database (data + indexes). The map it returns
// is shared with the cache and must not be modified.
func (s *server) tenantDatabaseSizes(ctx context.Context) map[string]int64 {
	tenantSizeMu.Lock()
	defer tenantSizeMu.Unlock()
	if tenantSizeCache != nil && time.Since(tenantSizeAt) < tenantSizeCacheTTL {
		return tenantSizeCache
	}
	pool := s.tenantMySQLPool()
	if pool == nil {
		return tenantSizeCache
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	rows, err := pool.QueryContext(ctx, `
		SELECT table_schema, COALESCE(SUM(data_length + index_length), 0)
		FROM information_schema.tables
		WHERE table_schema NOT IN ('mysql', 'sys', 'performance_schema', 'information_schema')
		GROUP BY table_schema
	`)
	if err != nil {
		return tenantSizeCache
	}
	defer rows.Close()
	sizes := map[string]int64{}
	for rows.Next() {
		var schema string
		var size int64
		if rows.Scan(&schema, &size) == nil {
			sizes[schema] = size
		}
	}
	if rows.Err() != nil {
		return tenantSizeCache
	}
	tenantSizeCache, tenantSizeAt = sizes, time.Now()
	return sizes
}

// forgetTenantDatabaseSizes drops the cache after a database is created or deleted, so the
// next page load shows the change straight away.
func forgetTenantDatabaseSizes() {
	tenantSizeMu.Lock()
	tenantSizeAt = time.Time{}
	tenantSizeMu.Unlock()
}
