declare module 'sql.js' {
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  export interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }

  export type SqlValue = string | number | Uint8Array | null;

  export interface ParamsObject {
    [key: string]: SqlValue;
  }

  export interface Database {
    run(sql: string, params?: SqlValue[] | ParamsObject): Database;
    exec(sql: string, params?: SqlValue[]): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface Statement {
    bind(params?: SqlValue[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, SqlValue>;
    free(): boolean;
  }

  export interface SqlJsConfig {
    locateFile?: (filename: string) => string;
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}
