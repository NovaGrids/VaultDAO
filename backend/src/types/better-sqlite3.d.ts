declare module "better-sqlite3" {
  interface RunResult {
    lastInsertRowid: number | bigint;
  }

  interface Statement {
    run(params?: unknown): RunResult;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  }

  interface DatabaseInstance {
    pragma(command: string): void;
    exec(sql: string): void;
    prepare(sql: string): Statement;
    transaction<TArgs extends unknown[], TResult>(
      fn: (...args: TArgs) => TResult,
    ): (...args: TArgs) => TResult;
    close(): void;
  }

  interface DatabaseConstructor {
    new (path: string): DatabaseInstance;
  }

  const Database: DatabaseConstructor & {
    Database: DatabaseInstance;
    Statement: Statement;
  };

  export default Database;
}
