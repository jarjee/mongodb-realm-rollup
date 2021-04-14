import {Plugin} from 'rollup';

import fs from 'fs';
import path from 'path';

import walkdir from 'walkdir';
import picomatch from 'picomatch';
import {parse} from 'comment-parser';

import {
  FunctionSettings,
  validateFunctionSettings,
  parseFunctionJSDoc,
  functionSettingsToRealm,
} from './function-settings';
import {PLUGIN_NAME} from './constants';

type RealmOptions = {
  rootPath: string;
  functions?: string[] | string;
  httpServices?: string[] | string;
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
        const functionFiles = generateFunctionInputs(
          pluginOptions.functions,
          'functions',
          rootAbsolute,
          files
        );

        inputEntries.push(...functionFiles);
      }

      if (pluginOptions.httpServices !== undefined) {
        const httpServiceFiles = generateFunctionInputs(
          pluginOptions.httpServices,
          'services/main/incoming_webhooks',
          rootAbsolute,
          files
        );

        inputEntries.push(...httpServiceFiles);
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
      let httpService = false;

      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk') {
          const folder = path.join(
            options.dir || 'build',
            file.fileName.replace('/source.js', '')
          );
          const name = path.basename(folder);

          // Check if the config.json exists.
          // If it does, merge with what we've parsed
          // If it doesn't, create the config file
          const configFile = path.join(folder, 'config.json');

          const rawOriginalConfig =
            fs.existsSync(configFile) && fs.readFileSync(configFile, 'utf8');

          // If it's a function, use the default function config
          if (/\/functions\//.test(configFile)) {
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

          // Handling for the service config
          if (/\/services\//.test(configFile)) {
            httpService = true;
            if (!rawOriginalConfig) {
              fs.writeFileSync(
                configFile,
                JSON.stringify(
                  {
                    name,
                    run_as_authed_user: true,
                    run_as_user_id: '',
                    run_as_user_id_script_source: '',
                    options: {
                      httpMethod: 'POST',
                      validationMethod: 'NO_VALIDATION',
                    },
                    respond_result: true,
                    disable_arg_logs: true,
                    fetch_custom_user_data: false,
                    create_user_on_auth: false,
                  },
                  null,
                  4
                )
              );
            }
          }
        }
      }

      // If there was a 'service', generate the config if unavailable
      if (httpService) {
        const serviceConfig = path.join(
          options.dir || 'build',
          'services/main/config.json'
        );

        fs.existsSync(serviceConfig) ||
          fs.writeFileSync(
            serviceConfig,
            JSON.stringify(
              {
                name: 'main',
                type: 'http',
                config: {},
                version: 1,
              },
              null,
              4
            )
          );
      }
    },
  };
}
function generateFunctionInputs(
  fileFilters: string | string[],
  realmFolder: string,
  rootAbsolutePath: string,
  files: string[]
) {
  const functionFilters = multiMap(fileFilters, f =>
    path.join(rootAbsolutePath, f)
  );

  const functionFiles = files.filter(file =>
    picomatch.isMatch(file, functionFilters)
  );

  return functionFiles.map(
    fnSource =>
      [
        `${realmFolder}/${path
          .basename(fnSource)
          .replace(/\.[^/.]+$/, '')}/source`,
        fnSource,
      ] as [string, string]
  );
}
