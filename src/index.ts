import {Plugin, RollupOptions, SourceDescription} from 'rollup';

export default function realm(options: {} = {}): Plugin {
  return {
    name: 'mongodb-realm',
  };
}
