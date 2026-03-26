/**
 * Storage Adapter Interface
 *
 * Provides a persistence abstraction for indexed backend state.
 * Allows for swapping storage implementations (in-memory, SQLite, Postgres, etc)
 * without coupling business logic to a specific database.
 *
 * Design principles:
 * - Simple interface focused on core CRUD operations
 * - Async/await for future async storage implementations
 * - Support for filtering and pagination
 * - Clear contract for reads/writes
 */

/**
 * Generic storage adapter interface.
 * Implement this interface to add persistence to your backend.
 *
 * @template T The data type being stored
 */
export interface StorageAdapter<T> {
  /**
   * Retrieve all records, optionally filtered.
   */
  getAll(filter?: Record<string, any>): Promise<T[]>;

  /**
   * Retrieve a single record by ID.
   */
  getById(id: string): Promise<T | null>;

  /**
   * Save or update a record.
   */
  save(record: T): Promise<void>;

  /**
   * Save multiple records (batch operation).
   */
  saveMany(records: T[]): Promise<void>;

  /**
   * Delete a record by ID.
   */
  delete(id: string): Promise<void>;

  /**
   * Check if a record exists.
   */
  exists(id: string): Promise<boolean>;

  /**
   * Get the total count of records.
   */
  count(filter?: Record<string, any>): Promise<number>;

  /**
   * Clear all records (use with caution).
   */
  clear(): Promise<void>;
}

/**
 * In-memory storage adapter for development and testing.
 * 
 * This adapter stores everything in a Map. It's suitable for:
 * - Development and testing
 * - Small datasets that fit in memory
 * - Temporary state that doesn't need persistence
 *
 * Replace with a persistent adapter (SQLite, Postgres) in production.
 */
export class InMemoryStorageAdapter<T extends { id: string }>
  implements StorageAdapter<T>
{
  private records = new Map<string, T>();

  async getAll(filter?: Record<string, any>): Promise<T[]> {
    let results = Array.from(this.records.values());

    if (filter) {
      results = results.filter((record) =>
        Object.entries(filter).every(([key, value]) => {
          return (record as any)[key] === value;
        })
      );
    }

    return results;
  }

  async getById(id: string): Promise<T | null> {
    return this.records.get(id) ?? null;
  }

  async save(record: T): Promise<void> {
    this.records.set(record.id, record);
  }

  async saveMany(records: T[]): Promise<void> {
    for (const record of records) {
      this.records.set(record.id, record);
    }
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async exists(id: string): Promise<boolean> {
    return this.records.has(id);
  }

  async count(filter?: Record<string, any>): Promise<number> {
    if (!filter) {
      return this.records.size;
    }
    const filtered = await this.getAll(filter);
    return filtered.length;
  }

  async clear(): Promise<void> {
    this.records.clear();
  }
}
