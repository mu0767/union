import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

// Keep the existing rounds/revisions JSON; version supports atomic compare-and-swap.
export const sharedBosses = sqliteTable('shared_bosses', {
  id: integer('id').primaryKey(),
  version: integer('version').notNull(),
  data: text('data').notNull(),
});
