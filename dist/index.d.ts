import { Plugin } from 'rollup';
declare type RealmOptions = {
    rootPath: string;
    functions?: string[] | string;
};
export default function realm(pluginOptions: RealmOptions): Plugin;
export {};
