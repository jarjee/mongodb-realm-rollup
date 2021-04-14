import {Plugin} from 'rollup';

import fs from 'fs';
import path from 'path';

import walkdir from 'walkdir';
import picomatch from 'picomatch';
import {parse} from 'comment-parser';
import type {Block} from 'comment-parser';

const PLUGIN_NAME = 'mongodb-realm';

type RealmOptions = {
  rootPath: string;
  functions?: string[] | string;
};

function isEmpty(x: unknown) {
  return x === undefined || x === '' || (Array.isArray(x) && x.length === 0);
}

function multiMap<T, V>(v: T | T[], fn: (x: T) => V) {
  if (Array.isArray(v)) {
    return v.map(fn);
  }
  return fn(v);
}

type FunctionSettings = {
  private?: true;
  public?: true;
  system?: true;
  userId?: string;
  disableArgumentLogging?: true;
};

type RealmFunctionSettings = {
  name: string;
  private: boolean;
  run_as_system?: true;
  run_as_user_id?: string;
  disable_arg_logs?: true;
};

function parseFunctionJSDoc(jsDoc: Block[]): FunctionSettings {
  const specs = jsDoc.flatMap(block => block.tags);

  const result = specs.reduce(
    (acc, spec) => {
      switch (spec.tag.toLowerCase()) {
        case 'public':
          acc.public = true;
          break;
        case 'private':
          acc.private = true;
          break;
        case 'system':
          acc.system = true;
          break;
        case 'user':
          acc.userId = spec.type;
          break;
        case 'logarguments':
          acc.disableArgumentLogging = ['', 'true'].includes(spec.type)
            ? undefined
            : true;
          break;
        default:
        // Deliberately do nothing
      }
      return acc;
    },
    {disableArgumentLogging: true} as FunctionSettings
  );

  return result;
}

function validateFunctionSettings(settings: FunctionSettings, id: string) {
  const result = {...settings};
  if (settings.private && settings.public) {
    console.log(
      `[${PLUGIN_NAME}]: Cannot have both private & public; setting as private in ${id}.`
    );

    delete result.public;
  }

  // TODO: Also handle script case when implemented
  if (settings.userId && settings.system) {
    console.log(
      `[${PLUGIN_NAME}]: Cannot have multiple authentications, setting as 'user' in ${id}.`
    );

    delete result.system;
  }

  return result;
}

function functionSettingsToRealm(
  name: string,
  settings: FunctionSettings
): RealmFunctionSettings {
  return {
    name,
    private: settings.private || settings.public === undefined ? true : false,
    run_as_system: settings.system,
    run_as_user_id: settings.userId,
    disable_arg_logs: settings.disableArgumentLogging,
  };
}

const functionSettingsCache = new Map<string, FunctionSettings>();

export default function realm(pluginOptions: RealmOptions): Plugin {
  return {
    name: PLUGIN_NAME,
    options: options => {
      const inputEntries: [string, string][] = [];

      if (!isEmpty(options.input)) {
        console.error(
          `[${PLUGIN_NAME}]: You cannot specify inputs since we add them for you.`
        );
        return null;
      }

      const rootAbsolute = path.resolve(pluginOptions.rootPath);
      const files = walkdir.sync(pluginOptions.rootPath);

      if (pluginOptions.functions !== undefined) {
        const functionFilters = multiMap(pluginOptions.functions, f =>
          path.join(rootAbsolute, f)
        );

        const functionFiles = files.filter(file =>
          picomatch.isMatch(file, functionFilters)
        );

        inputEntries.push(
          ...functionFiles.map(
            fnSource =>
              [
                `functions/${path
                  .basename(fnSource)
                  .replace(/\.[^/.]+$/, '')}/source`,
                fnSource,
              ] as [string, string]
          )
        );
      }

      const input = inputEntries.reduce((acc, [k, v]) => {
        acc[k] = v;
        return acc;
      }, {} as Record<string, string>);

      return {
        ...options,
        input,
      };
    },
    // Going to apply a very simple transform.
    // Could this be better? Definitely.
    transform: (code, id) => {
      // Test if the code has to be transformed
      if (!id.match(path.join(pluginOptions.rootPath, 'functions'))) {
        return null;
      }

      if (!/export default/.test(code)) {
        console.warn(`[${PLUGIN_NAME}]: We expect 'export default' in ${id}`);
        return null;
      }

      // Dodgy comment parsing
      const jsDocMatch = /(\/\*\*.+\*\/).*export default/gms.exec(code);

      // If we find a JSDoc above the default export
      // Note: We check for 2 as the matches are:
      // - The complete regex
      // - The comment group we're interested in
      if (jsDocMatch?.length === 2) {
        const functionSettings = validateFunctionSettings(
          parseFunctionJSDoc(parse(jsDocMatch[1])),
          id
        );
        functionSettingsCache.set(id, functionSettings);
      }

      return code.replace('export default', 'exports =');
    },
    // MongoDB Realm has a seperate dynamic import system
    resolveDynamicImport: () => false,

    // Adding all the extra metadata (config.json) if required
    writeBundle: (options, bundle) => {
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk') {
          const folder = path.join(
            options.dir || 'dir',
            file.fileName.replace('/source.js', '')
          );

          // Check if the config.json exists.
          // If it does, merge with what we've parsed
          // If it doesn't, create the config file
          const configFile = path.join(folder, 'config.json');

          const rawOriginalConfig =
            fs.existsSync(configFile) && fs.readFileSync(configFile, 'utf8');

          // If it's a function, use the default function config
          if (/\/functions\//.test(configFile)) {
            const name = path.basename(folder);
            const parsedConfig = functionSettingsCache.get(
              file.facadeModuleId || ''
            );

            const functionConfig = parsedConfig
              ? functionSettingsToRealm(name, parsedConfig)
              : {name, private: true, disable_arg_logs: true};

            fs.writeFileSync(
              configFile,
              JSON.stringify(
                rawOriginalConfig
                  ? {id: JSON.parse(rawOriginalConfig).id, ...functionConfig}
                  : functionConfig,
                null,
                4
              )
            );
          }
        }
      }
    },
  };
}
