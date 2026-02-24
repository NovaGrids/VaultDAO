declare module 'fuse.js' {
  interface IFuseOptions<T> {
    keys?: (keyof T | string)[];
    threshold?: number;
    includeScore?: boolean;
  }
  interface FuseResult<T> {
    item: T;
    refIndex?: number;
    score?: number;
  }
  export default class Fuse<T> {
    constructor(items: T[], options?: IFuseOptions<T>);
    search(query: string): FuseResult<T>[];
  }
}
